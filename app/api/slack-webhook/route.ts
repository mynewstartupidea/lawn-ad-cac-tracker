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

  // Strip the "sold" prefix and optional colon
  let rest = text.slice(4).trim();
  if (rest.startsWith(":")) rest = rest.slice(1).trim();

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

  // Remove any leftover angle brackets or whitespace
  const email = rest.replace(/[<>\s]/g, "").toLowerCase();

  if (!email || !email.includes("@") || !email.includes(".")) return null;
  return email;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Slack URL verification (required on first webhook setup)
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;

    if (event?.type === "message" && event?.text) {
      const text: string = event.text.trim();
      const email = extractSoldEmail(text);

      if (email) {
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
            console.error("[Slack webhook] error saving sale for", email, error);
          } else {
            console.log("[Slack webhook] sale recorded for:", email);
          }
        } else {
          console.log("[Slack webhook] sale already exists for:", email);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Slack webhook] error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
