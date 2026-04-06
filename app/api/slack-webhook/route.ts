import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    console.log("Slack event:", body);

    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;

    if (!event || !event.text) {
      return NextResponse.json({ ok: true });
    }

    const text = event.text.trim();

    if (text.toLowerCase().startsWith("sold:")) {
      const email = text.replace(/^sold:/i, "").trim().toLowerCase();

      const { error } = await supabase.from("sales").insert([
        {
          email,
          status: "sold",
        },
      ]);

      if (error) {
        console.log("Supabase sales insert error:", error);
        return NextResponse.json({ ok: false }, { status: 500 });
      }

      console.log("Saved sold email:", email);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.log("Slack webhook error:", error);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}