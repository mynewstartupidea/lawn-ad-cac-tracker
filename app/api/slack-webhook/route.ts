import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    if (body.type === "url_verification") {
      return NextResponse.json({ challenge: body.challenge });
    }

    const event = body.event;

    if (event?.type === "message" && event?.text) {
      const text = event.text.trim();

      if (text.toUpperCase().startsWith("SOLD:")) {
        let email = text.replace(/SOLD:/i, "").trim();

        // Clean Slack mailto format
        if (email.includes("mailto:")) {
          const parts = email.split("|");
          if (parts[1]) {
            email = parts[1].replace(">", "").trim();
          }
        }

        email = email.toLowerCase();

        if (email) {
          const { data: existingSale } = await supabase
            .from("sales")
            .select("id")
            .eq("email", email)
            .maybeSingle();

          if (!existingSale) {
            const { error } = await supabase.from("sales").insert([
              {
                email,
                status: "sold",
              },
            ]);

            if (error) {
              console.error("Supabase insert error:", error);
            } else {
              console.log("Sale saved for:", email);
            }
          } else {
            console.log("Sale already exists for:", email);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}