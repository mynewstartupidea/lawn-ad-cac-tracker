import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const email = (body.email || "").toLowerCase().trim();
    const firstName = body.first_name || body.name || "Unknown";
    const phone = body.phone || "";
    const adName = body.ad_name || body.adName || "Unknown Ad";

    if (!email) {
      return NextResponse.json({ success: false, error: "Email is required" }, { status: 400 });
    }

    // Deduplicate: skip if lead with this email already exists
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ success: true, message: "Lead already exists" });
    }

    const { error } = await supabase.from("leads").insert([
      {
        first_name: firstName,
        email,
        phone,
        ad_name: adName,
        source: "ghl",
      },
    ]);

    if (error) {
      console.error("GHL webhook insert error:", error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("GHL webhook error:", err);
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
}
