import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";
import { sendLeadEvent } from "../../lib/metaCapi";
import { AD_ACCOUNTS } from "../../lib/adAccounts";

// Checks whether a value is a real non-empty string.
// Filters out:
//   - empty / whitespace
//   - unresolved GHL template variables like {{contact.ad_name}}
function isReal(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const t = val.trim();
  if (!t) return false;
  if (t.startsWith("{{") && t.endsWith("}}")) return false; // unresolved GHL variable
  return true;
}

// Extract source tag from GHL tags array.
// Looks for known source tags: FBFL, FBGA, Google, etc.
// Falls back to first tag found, then "ghl".
const SOURCE_TAG_PATTERNS = [
  /^FB[-_]?FL$/i,   // FBFL, FB-FL, FB_FL → FB Florida
  /^FB[-_]?GA$/i,   // FBGA, FB-GA → FB Georgia
  /^FB[-_]?FL/i,    // any tag starting with FBFL
  /^FB[-_]?GA/i,    // any tag starting with FBGA
  /^google$/i,      // Google
  /^gg$/i,          // GG shorthand
  /^ig$/i,          // Instagram
  /^organic$/i,     // Organic
  /^eddm$/i,        // EDDM mailer
];

function extractSourceFromTags(tags: unknown): string {
  if (!Array.isArray(tags) || tags.length === 0) return "ghl";
  const tagStrings = tags.map(t => String(t).trim()).filter(Boolean);

  // Check for known source tag patterns first
  for (const pattern of SOURCE_TAG_PATTERNS) {
    const match = tagStrings.find(t => pattern.test(t));
    if (match) return match.toUpperCase();
  }

  // Fall back to first tag that looks like a source (short, uppercase-ish)
  const shortTag = tagStrings.find(t => t.length <= 10);
  if (shortTag) return shortTag.toUpperCase();

  return "ghl";
}

// Extract ad name from the GHL webhook payload.
// GHL can deliver it in several different places depending on the workflow setup.
function extractAdName(body: Record<string, unknown>): string {
  // 1. Top-level "ad_name" — exactly what the user's GHL webhook sends
  if (isReal(body.ad_name)) return (body.ad_name as string).trim();
  if (isReal(body.adName)) return (body.adName as string).trim();
  if (isReal(body.campaign_name)) return (body.campaign_name as string).trim();

  // 2. GHL attributionSource — auto-populated from UTM params on the landing page URL.
  //    The ad URL uses utm_content={{ad.name}}, so Facebook injects the real ad name
  //    into utm_content on every click. Check utmContent FIRST.
  const attr = body.attributionSource as Record<string, unknown> | undefined;
  if (attr) {
    if (isReal(attr.utmContent)) return (attr.utmContent as string).trim();   // utm_content={{ad.name}} ← this one
    if (isReal(attr.utmAdName)) return (attr.utmAdName as string).trim();
    if (isReal(attr.campaignName)) return (attr.campaignName as string).trim();
    if (isReal(attr.utmCampaign)) return (attr.utmCampaign as string).trim();
  }

  // 2b. Some GHL versions hoist UTM params to the top level
  if (isReal(body.utm_content)) return (body.utm_content as string).trim();
  if (isReal(body.utmContent)) return (body.utmContent as string).trim();

  // 3. custom_fields array: [{ key: "ad_name", field_value: "..." }]
  if (Array.isArray(body.custom_fields)) {
    for (const f of body.custom_fields as Record<string, unknown>[]) {
      const key = String(f.key ?? f.name ?? "").toLowerCase().replace(/\s/g, "_");
      if (["ad_name", "adname", "campaign_name", "ad_name_field"].includes(key)) {
        const val = f.field_value ?? f.value ?? f.fieldValue;
        if (isReal(val)) return String(val).trim();
      }
    }
  }

  // 4. Any nested customData object
  const cd = body.customData as Record<string, unknown> | undefined;
  if (cd) {
    const val = cd.ad_name ?? cd.adName ?? cd.campaign_name;
    if (isReal(val)) return String(val).trim();
  }

  return "Unknown Ad";
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // Always log key fields — check Vercel function logs if ad_name is wrong
    const email = String(body.email ?? "").toLowerCase().trim();
    const firstName = String(body.first_name ?? body.name ?? body.full_name ?? "Unknown").trim();
    const phone = String(body.phone ?? "").trim();
    const adName = extractAdName(body);
    // Source priority: explicit source field > tags array > fallback
    const source = isReal(body.source)
      ? (body.source as string).trim().toUpperCase()
      : extractSourceFromTags(body.tags);

    // Log everything — check Vercel function logs to debug missing leads
    const attr = body.attributionSource as Record<string, unknown> | undefined;
    console.log("[GHL] received →", {
      email,
      tags: body.tags,
      resolved_source: source,
      raw_ad_name: body.ad_name,
      utm_content: attr?.utmContent ?? null,
      utm_campaign: attr?.utmCampaign ?? null,
      resolved_ad_name: adName,
    });

    if (!email || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "Valid email required" }, { status: 400 });
    }

    // Deduplicate by email
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, message: "Lead already exists" });
    }

    const { error } = await supabase.from("leads").insert([
      { first_name: firstName, email, phone, ad_name: adName, source },
    ]);

    if (error) {
      console.error("[GHL] insert error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Fire server-side Lead event to Meta CAPI — improves match quality from
    // ~3/10 (browser pixel alone) to 8-9/10 by sending email + phone + name
    sendLeadEvent({
      pixelId:         AD_ACCOUNTS.florida.pixelId,
      email,
      phone:           phone || undefined,
      firstName:       firstName !== "Unknown" ? firstName : undefined,
      eventSourceUrl:  AD_ACCOUNTS.florida.landingUrl.split("?")[0],
    }).catch(err => console.error("[GHL] CAPI lead error:", err));

    return NextResponse.json({ success: true, ad_name: adName });
  } catch (err) {
    console.error("[GHL] parse error:", err);
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }
}
