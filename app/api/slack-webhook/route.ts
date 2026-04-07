import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";
import { extractSoldEmail } from "../../lib/extractSoldEmail";

async function handleSoldMessage(text: string) {
  const email = extractSoldEmail(text);
  if (!email) return;

  console.log("[Slack] sold message detected, email:", email);

  // Deduplicate — don't insert if sale already recorded
  const { data: existing } = await supabase
    .from("sales")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existing) {
    console.log("[Slack] sale already exists:", email);
    return;
  }

  const { error } = await supabase
    .from("sales")
    .insert([{ email, status: "sold" }]);

  if (error) {
    console.error("[Slack] insert error for", email, error);
  } else {
    console.log("[Slack] sale recorded:", email);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Slack URL verification challenge
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;
    if (!event || event.type !== "message") {
      return NextResponse.json({ ok: true });
    }

    let text: string | undefined;

    if (!event.subtype) {
      // Normal user message
      text = event.text;
    } else if (event.subtype === "message_changed") {
      // Slack fires this after linkifying emails/URLs in the message.
      // The reformatted text is at event.message.text, not event.text.
      text = event.message?.text;
    }
    // Intentionally ignore: message_deleted, bot_message, message_replied, etc.

    if (text) {
      console.log("[Slack] raw text:", JSON.stringify(text));
      await handleSoldMessage(text);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Slack] error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
