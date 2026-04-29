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
const SOURCE_TAG_PATTERNS: [RegExp, string][] = [
  [/^FB[\s_-]?FL$/i,   "FBFL"],   // fb fl, FBFL, fb-fl, fb_fl → Florida
  [/^FB[\s_-]?GA$/i,   "FBGA"],   // fb ga, FBGA → Georgia
  [/^FB[\s_-]?FL/i,    "FBFL"],   // anything starting with fb fl
  [/^FB[\s_-]?GA/i,    "FBGA"],   // anything starting with fb ga
  [/^google$/i,        "Google"],
  [/^gg$/i,            "Google"],
  [/^ig$/i,            "Instagram"],
  [/^organic$/i,       "Organic"],
  [/^eddm$/i,          "EDDM"],
];

function normalizeTags(raw: unknown): string[] {
  if (!raw) return [];
  let str = typeof raw === "string" ? raw : JSON.stringify(raw);
  // Strip JSON array brackets if GHL sends ["tag1","tag2"]
  str = str.replace(/^\[|\]$/g, "").replace(/"/g, "");
  return str.split(",").map(t => t.trim()).filter(Boolean);
}

function extractSourceFromTags(tags: unknown): string {
  const tagStrings = normalizeTags(tags);
  if (!tagStrings.length) return "ghl";

  for (const [pattern, label] of SOURCE_TAG_PATTERNS) {
    if (tagStrings.find(t => pattern.test(t))) return label;
  }

  // Fall back to first short tag
  const shortTag = tagStrings.find(t => t.length <= 12);
  return shortTag ? shortTag.toUpperCase() : "ghl";
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

// Parse GHL's dateAdded field into an ISO string.
// GHL sends it as Unix ms, Unix seconds, or ISO string.
function parseGhlDate(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    // ISO string or date string
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === "number") {
    // Unix ms (13 digits) or Unix seconds (10 digits)
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    const email = String(body.email ?? "").toLowerCase().trim();
    const firstName = String(body.first_name ?? body.name ?? body.full_name ?? "Unknown").trim();
    const phone = String(body.phone ?? "").trim();
    const adName = extractAdName(body);
    const source = extractSourceFromTags(isReal(body.source) ? body.source : body.tags);

    // Original GHL contact creation date — used as created_at so re-enrolled
    // old contacts get their real signup date instead of today's date.
    const ghlDate = parseGhlDate(body.dateAdded ?? body.date_added ?? body.contactDateAdded);

    const attr = body.attributionSource as Record<string, unknown> | undefined;
    console.log("[GHL] received →", {
      email,
      tags: body.tags,
      source_field: body.source,
      resolved_source: source,
      raw_ad_name: body.ad_name,
      utm_content: attr?.utmContent ?? null,
      utm_campaign: attr?.utmCampaign ?? null,
      utm_medium: attr?.utmMedium ?? null,
      utm_source: attr?.utmSource ?? null,
      attr_raw: attr ?? null,
      date_added: body.dateAdded ?? body.date_added ?? null,
      resolved_ad_name: adName,
      ghl_date: ghlDate,
    });

    if (!email || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "Valid email required" }, { status: 400 });
    }

    // Check if lead exists — update ad_name/source if so, insert if not
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("leads")
        .update({ ad_name: adName, source, first_name: firstName, phone })
        .eq("email", email);
      if (error) {
        console.error("[GHL] update error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
    } else {
      const row: Record<string, unknown> = { first_name: firstName, email, phone, ad_name: adName, source };
      if (ghlDate) row.created_at = ghlDate;
      const { error } = await supabase.from("leads").insert([row]);
      if (error) {
        console.error("[GHL] insert error:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
      }
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
