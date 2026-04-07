import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

// Email regex — matches standard email addresses
const EMAIL_RE = /[\w._%+\-]+@[\w.\-]+\.[a-zA-Z]{2,}/;

// Extracts an email from any message that starts with "sold" (case-insensitive),
// regardless of spacing, punctuation, or formatting between "sold" and the address.
//
// Examples that all work:
//   sold: john@gmail.com
//   SOLD john@gmail.com
//   sold.   john@gmail.com
//   sold! - john@gmail.com
//   sold <mailto:john@gmail.com|john@gmail.com>   ← Slack auto-linkify format
//   Sold - paid - john@gmail.com
function extractSoldEmail(text: string): string | null {
  if (!text.toLowerCase().trimStart().startsWith("sold")) return null;

  // Strip Slack's mailto wrapper before matching: <mailto:email|email> → email
  const cleaned = text.replace(/<mailto:[^|>]*\|([^>]+)>/g, "$1")
                      .replace(/<mailto:([^>]+)>/g, "$1");

  const match = cleaned.match(EMAIL_RE);
  if (!match) return null;

  return match[0].toLowerCase();
}

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
