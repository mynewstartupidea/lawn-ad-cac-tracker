import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Slack URL verification challenge (required on first setup)
    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;

    if (event?.type === "message" && event?.text) {
      const text = event.text.trim();

      if (text.toUpperCase().startsWith("SOLD:")) {
        let email = text.replace(/SOLD:/i, "").trim();

        // Handle Slack's mailto link format: <mailto:user@example.com|user@example.com>
        if (email.includes("mailto:")) {
          const parts = email.split("|");
          if (parts[1]) {
            email = parts[1].replace(">", "").trim();
          }
        }

        // Remove any remaining angle brackets
        email = email.replace(/[<>]/g, "").trim().toLowerCase();

        if (!email || !email.includes("@")) {
          console.warn("Slack webhook: invalid email extracted from message:", text);
          return NextResponse.json({ ok: true });
        }

        const { data: existingSale } = await supabase
          .from("sales")
          .select("id")
          .eq("email", email)
          .maybeSingle();

        if (!existingSale) {
          const { error } = await supabase.from("sales").insert([
            { email, status: "sold" },
          ]);

          if (error) {
            console.error("Slack webhook: error saving sale for", email, error);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Slack webhook error:", error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
