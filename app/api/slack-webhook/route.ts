import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabase } from "../../lib/supabase";
import { extractSoldEmail } from "../../lib/extractSoldEmail";
import { isFbSource, sendPurchaseEvent } from "../../lib/metaCapi";


async function handleSoldMessage(text: string) {
  const email = extractSoldEmail(text);
  if (!email) return;

  console.log("[Slack] sold message detected, email:", email);

  // Upsert with ignoreDuplicates prevents the TOCTOU race where two simultaneous
  // Slack events (message + message_changed) both pass a select-then-insert check.
  // Requires UNIQUE constraint on sales.email (see sql/add_sales_email_unique.sql).
  const { data: inserted, error } = await supabase
    .from("sales")
    .upsert([{ email, status: "sold" }], { onConflict: "email", ignoreDuplicates: true })
    .select("id");

  if (error) {
    console.error("[Slack] insert error for", email, error);
    return;
  }

  // With ignoreDuplicates, an already-recorded sale comes back empty — don't send Purchase twice
  if (!inserted?.length) {
    console.log("[Slack] sale already recorded:", email);
    return;
  }

  console.log("[Slack] sale recorded:", email);

  const { data: lead } = await supabase
    .from("leads")
    .select("phone, first_name, postal_code, source")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { phone?: string; first_name?: string; postal_code?: string; source?: string } | null };

  if (!isFbSource(lead?.source)) {
    console.log("[Slack] no Purchase event — lead source is", lead?.source ?? "unknown");
    return;
  }

  await sendPurchaseEvent(lead.source, {
    email,
    phone:     lead.phone,
    firstName: lead.first_name,
    zip:       lead.postal_code,
  });
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
      // Respond to Slack immediately — must reply within 3s or Slack disables the subscription
      waitUntil(handleSoldMessage(text));
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Slack] error:", err);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
