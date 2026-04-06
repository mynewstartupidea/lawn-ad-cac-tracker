import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

// Robustly extract ad_name from the many ways GHL can send it.
// GHL sends custom fields differently depending on the workflow/version:
//   - top-level: body.ad_name or body.adName
//   - custom_fields array: [{ key: "ad_name", field_value: "..." }]
//   - attribution: body.attributionSource.utmCampaign (Facebook UTM)
function extractAdName(body: Record<string, unknown>): string {
  // 1. Top-level direct fields
  if (typeof body.ad_name === "string" && body.ad_name.trim()) return body.ad_name.trim();
  if (typeof body.adName === "string" && body.adName.trim()) return body.adName.trim();
  if (typeof body.campaign_name === "string" && body.campaign_name.trim()) return body.campaign_name.trim();

  // 2. custom_fields array: [{ key, field_value }] or [{ key, value }]
  if (Array.isArray(body.custom_fields)) {
    for (const field of body.custom_fields as Record<string, unknown>[]) {
      const key = String(field.key || field.name || "").toLowerCase();
      if (key === "ad_name" || key === "adname" || key === "campaign_name" || key === "ad name") {
        const val = field.field_value ?? field.value ?? field.fieldValue;
        if (val && String(val).trim()) return String(val).trim();
      }
    }
  }

  // 3. attributionSource from GHL's Facebook Lead Ad integration
  const attr = body.attributionSource as Record<string, unknown> | undefined;
  if (attr) {
    if (typeof attr.utmCampaign === "string" && attr.utmCampaign.trim()) return attr.utmCampaign.trim();
    if (typeof attr.campaignName === "string" && attr.campaignName.trim()) return attr.campaignName.trim();
    if (typeof attr.utmContent === "string" && attr.utmContent.trim()) return attr.utmContent.trim();
  }

  // 4. Any nested customData object
  const customData = body.customData as Record<string, unknown> | undefined;
  if (customData) {
    const val = customData.ad_name ?? customData.adName ?? customData.campaign_name;
    if (val && String(val).trim()) return String(val).trim();
  }

  return "Unknown Ad";
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // Log the full payload in dev so you can see exactly what GHL sends.
    // Check your server logs if ad_name is still showing as "Unknown Ad".
    if (process.env.NODE_ENV !== "production") {
      console.log("[GHL webhook] Full payload:", JSON.stringify(body, null, 2));
    }

    const email = String(body.email || "").toLowerCase().trim();
    const firstName = String(body.first_name || body.name || body.full_name || "Unknown").trim();
    const phone = String(body.phone || "").trim();
    const adName = extractAdName(body);

    console.log(`[GHL webhook] email=${email} ad_name=${adName}`);

    if (!email || !email.includes("@")) {
      return NextResponse.json({ success: false, error: "Valid email is required" }, { status: 400 });
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
      { first_name: firstName, email, phone, ad_name: adName, source: "ghl" },
    ]);

    if (error) {
      console.error("[GHL webhook] insert error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, ad_name: adName });
  } catch (err) {
    console.error("[GHL webhook] parse error:", err);
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }
}
