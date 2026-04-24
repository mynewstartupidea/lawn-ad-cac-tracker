import { NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabase } from "../../lib/supabase";
import { extractSoldEmail } from "../../lib/extractSoldEmail";
import { sendSoldConversion } from "../../lib/metaCapi";
import { AD_ACCOUNTS } from "../../lib/adAccounts";

// Determine sale value + pixel based on which account the lead came from.
// Florida ads contain "FI" or "Fl", Georgia ads contain "GA".
// If unknown, fire to both pixels.
function resolveAccount(adName: string | null): { pixelId: string; value: number }[] {
  const name = (adName ?? "").toUpperCase();
  if (name.includes(" GA ") || name.startsWith("GA")) {
    return [{ pixelId: AD_ACCOUNTS.georgia.pixelId, value: 19 }];
  }
  if (name.startsWith("FL") || name.startsWith("FI") || name.includes(" FL") || name.includes(" FI")) {
    return [{ pixelId: AD_ACCOUNTS.florida.pixelId, value: 99 }];
  }
  // Unknown — fire to both
  return [
    { pixelId: AD_ACCOUNTS.florida.pixelId, value: 99 },
    { pixelId: AD_ACCOUNTS.georgia.pixelId, value: 19 },
  ];
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

  // Look up lead to get phone + ad_name for pixel routing
  const { data: lead } = await supabase
    .from("leads")
    .select("phone, ad_name")
    .eq("email", email)
    .maybeSingle() as { data: { phone?: string; ad_name?: string } | null };

  const { error } = await supabase
    .from("sales")
    .insert([{ email, status: "sold" }]);

  if (error) {
    console.error("[Slack] insert error for", email, error);
    return;
  }

  console.log("[Slack] sale recorded:", email);

  // Fire conversion event(s) to Meta CAPI
  const targets = resolveAccount(lead?.ad_name ?? null);
  await Promise.all(
    targets.map(t =>
      sendSoldConversion({
        pixelId: t.pixelId,
        email,
        phone:   lead?.phone,
        value:   t.value,
      })
    )
  );
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
