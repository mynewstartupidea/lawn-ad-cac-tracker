import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { error } = await supabase.from("leads").insert([
      {
        first_name: body.first_name || body.name || "Webhook",
        email: body.email || "webhook@test.com",
        phone: body.phone || "0000000000",
        ad_name: body.ad_name || body.adName || "Unknown Ad",
        source: "ghl",
      },
    ]);

    if (error) {
      console.log(error);
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.log(err);
    return NextResponse.json({ success: false }, { status: 400 });
  }
}