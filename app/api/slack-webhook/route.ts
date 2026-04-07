import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

// Extracts an email from a Slack message that starts with "sold".
// Handles all variants:
//   sold: email@example.com
//   sold email@example.com
//   SOLD: email@example.com
//   SOLD <mailto:email@example.com|email@example.com>
function extractSoldEmail(text: string): string | null {
  const lower = text.toLowerCase().trim();
  if (!lower.startsWith("sold")) return null;

  // Strip the "sold" prefix and optional colon/punctuation
  let rest = text.slice(4).trim();
  if (rest.startsWith(":") || rest.startsWith("-") || rest.startsWith("!")) {
    rest = rest.slice(1).trim();
  }

  // Handle Slack's mailto link: <mailto:user@example.com|user@example.com>
  if (rest.includes("mailto:")) {
    // Prefer the display part after "|" — it's the clean email
    const pipeIdx = rest.indexOf("|");
    if (pipeIdx !== -1) {
      rest = rest.slice(pipeIdx + 1).replace(">", "").trim();
    } else {
      rest = rest.replace(/<mailto:/i, "").replace(">", "").trim();
    }
  }

  // Remove any leftover angle brackets or whitespace, take first token only
  const email = rest.replace(/[<>]/g, "").trim().split(/\s+/)[0].toLowerCase();

  if (!email || !email.includes("@") || !email.includes(".")) return null;
  return email;
}

async function handleSoldMessage(text: string) {
  const email = extractSoldEmail(text.trim());
  if (!email) return;

  const { data: existingSale } = await supabase
    .from("sales")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (!existingSale) {
    const { error } = await supabase
      .from("sales")
      .insert([{ email, status: "sold" }]);

    if (error) {
      console.error("[Slack] insert error for", email, error);
    } else {
      console.log("[Slack] sale recorded:", email);
    }
  } else {
    console.log("[Slack] sale already exists:", email);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Slack URL verification
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;
    if (!event || event.type !== "message") {
      return NextResponse.json({ ok: true });
    }

    let text: string | undefined;

    if (!event.subtype) {
      // Regular user message
      text = event.text;
    } else if (event.subtype === "message_changed") {
      // Slack re-sends the message after linkifying emails/URLs.
      // The updated text lives at event.message.text, not event.text.
      text = event.message?.text;
    }
    // Ignore message_deleted, bot_message, etc.

    if (text) {
      console.log("[Slack] message received:", JSON.stringify(text));
      await handleSoldMessage(text);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Slack] error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
