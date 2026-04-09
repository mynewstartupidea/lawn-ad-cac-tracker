import { NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  image?: string; // base64 data URL, e.g. "data:image/png;base64,..."
}

interface Flyer {
  flyerName: string;
  trackingNumber: string;
  totalCalls: number;
  conversions: number;
}

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 400 });

  const { messages, flyers } = (await req.json()) as {
    messages: IncomingMessage[];
    flyers: Flyer[];
  };

  const openai = new OpenAI({ apiKey: openaiKey });

  // ── Build flyer context for the system prompt ────────────────────────────
  const flyerList = flyers.map(f =>
    `  • "${f.flyerName}" — tracking number: ${f.trackingNumber} (${f.totalCalls} calls, ${f.conversions} conversions)`
  ).join("\n");

  const systemPrompt = [
    "You are a spend-entry assistant for an EDDM (Every Door Direct Mail) CAC tracker at Liquid Lawn, a lawn care company.",
    "Your only job is to help the user fill in ad spend amounts for their flyer campaigns.",
    "",
    "Current flyers loaded in the dashboard:",
    flyerList || "  (no flyers loaded yet)",
    "",
    "INSTRUCTIONS:",
    "1. The user may paste raw text (e.g. a table of flyer costs) or describe spend amounts verbally, or share a screenshot.",
    "2. Parse EVERY row of data — do not stop at the first match.",
    "3. Match each row to a tracking number (exact digit match) or flyer name (fuzzy/partial).",
    "4. *** CRITICAL — AGGREGATION RULE ***:",
    "   The same tracking number can appear in MULTIPLE rows with DIFFERENT amounts (e.g. monthly billing split into several rows).",
    "   You MUST sum ALL amounts for the same tracking number together before writing the final value.",
    "   Example: tracking 4782177161 appears 3 times with $27,000 + $8,500 + $11,000 → spendUpdates value must be 46500, NOT 27000.",
    "   NEVER take just the first or last occurrence. Always SUM every occurrence.",
    "5. Strip all currency symbols ($, commas, spaces) before parsing amounts — '$ 27,000.00' → 27000.",
    "6. The user can also say things like 'remove spend for 478-217-7161' (set to 0) or 'add $500 to the Georgia flyer'.",
    "7. Always respond with ONLY valid JSON — no markdown, no code fences, no extra text:",
    '   { "reply": "...", "spendUpdates": { "TRACKING_NUMBER_DIGITS_ONLY": SUMMED_AMOUNT_AS_NUMBER } }',
    "   Example: { \"reply\": \"Set 3 flyers. Summed 3 rows for 4782177161 → $46,500 total.\", \"spendUpdates\": { \"4782177161\": 46500, \"9044201511\": 3200 } }",
    "8. trackingNumber keys must be digits only (strip all dashes, spaces, parentheses).",
    "9. In your reply, explicitly state what you summed — list each tracking number and how many rows you combined and the final total.",
    "10. If you cannot find any spend data, return valid JSON with empty spendUpdates and explain in reply.",
    "11. NEVER make up or round amounts. Use the exact numbers visible in the data.",
  ].join("\n");

  // ── Convert messages to OpenAI format (with vision support) ─────────────
  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => {
      if (m.role === "assistant") {
        return { role: "assistant" as const, content: m.content };
      }
      // User message — may include an image
      if (m.image) {
        return {
          role: "user" as const,
          content: [
            { type: "text" as const,      text: m.content || "Here is the screenshot, please extract the spend data." },
            { type: "image_url" as const, image_url: { url: m.image, detail: "high" as const } },
          ],
        };
      }
      return { role: "user" as const, content: m.content };
    }),
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: thread,
    max_tokens: 800,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "{}";

  let parsed: { reply?: string; spendUpdates?: Record<string, number> } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw, spendUpdates: {} };
  }

  return NextResponse.json({
    reply:        parsed.reply        ?? "Done.",
    spendUpdates: parsed.spendUpdates ?? {},
  });
}
