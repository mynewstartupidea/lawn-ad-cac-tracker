import { NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[]; // base64 data URLs — supports multiple screenshots per message
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
    `  • "${f.flyerName}" — tracking: ${f.trackingNumber} (${f.totalCalls} calls, ${f.conversions} clients)`
  ).join("\n");

  const systemPrompt = [
    "You are the EDDM spend assistant for Liquid Lawn, a lawn care company.",
    "Your job is to help fill in ad spend amounts — both at the total flyer level AND at the zip-code level.",
    "",
    "Current flyers loaded in the dashboard:",
    flyerList || "  (no flyers loaded yet)",
    "",
    "═══ THREE INPUT TYPES YOU HANDLE ═══",
    "",
    "TYPE A — Direct total spend entry:",
    "  User pastes a table or describes total spend per flyer/tracking number.",
    "  Example: '4782177161 = $15,000' or a screenshot of a billing summary.",
    "  → Return spendUpdates with the total per tracking number.",
    "  → ALWAYS update spend even if the flyer has 0 clients or 0 conversions.",
    "",
    "TYPE B — Zip cost snapshot (Snapshot 1):",
    "  User shares a table/screenshot listing zip codes and their cost per mailing.",
    "  Example: '32601 → $450 | 32602 → $380 | 32603 → $520'",
    "  → Extract every zip → cost_per_mailing pair.",
    "  → Store them mentally. You CANNOT compute final zip spend yet (you need repetition counts too).",
    "  → Reply listing the zip costs you extracted and ask for Snapshot 2 (the drop/reps table).",
    "  → Return empty spendUpdates and zipSpendUpdates until you have both datasets.",
    "",
    "TYPE C — Drop/Repetition snapshot (Snapshot 2) + computation:",
    "  User shares a table/screenshot with:",
    "    - Tracking number (which flyer this is)",
    "    - Drop name (Drop 1, Drop 2, Drop 2.5, etc.)",
    "    - Zip codes covered by that drop",
    "    - How many times that drop was mailed (repetitions)",
    "  Example row: 'Tracking 4782177161 | Drop 1 | Zips: 32601, 32602 | Mailed 3 times'",
    "",
    "  COMPUTATION RULES when you have BOTH zip costs (from history or same message) AND drop/reps data:",
    "  1. For each tracking number and each zip in its drop(s):",
    "       actual_zip_spend = cost_per_zip × times_drop_was_mailed",
    "  2. Total flyer spend = SUM of actual_zip_spend across all zips in that flyer's drop(s).",
    "  3. A tracking number may appear in MULTIPLE drops — sum across all its drops.",
    "  4. A zip may appear in the same drop multiple times if listed separately — sum those too.",
    "  5. Return BOTH spendUpdates (total) AND zipSpendUpdates (per zip breakdown).",
    "",
    "  If you do NOT have zip cost data yet in the conversation:",
    "  → Acknowledge the drop/reps data. Ask user to share Snapshot 1 (zip costs).",
    "",
    "═══ AGGREGATION RULE (applies to all types) ═══",
    "  The same tracking number may appear in MULTIPLE rows. ALWAYS SUM all rows.",
    "  Never take just the first or last value. Sum every occurrence.",
    "",
    "═══ RESPONSE FORMAT ═══",
    "Always respond with ONLY valid JSON — no markdown, no code fences, no extra text:",
    '{',
    '  "reply": "Human-readable summary of what you extracted and computed.",',
    '  "spendUpdates": { "TRACKING_DIGITS_ONLY": TOTAL_AMOUNT_AS_NUMBER },',
    '  "zipSpendUpdates": { "TRACKING_DIGITS_ONLY": { "ZIPCODE_5DIGITS": AMOUNT_AS_NUMBER } }',
    '}',
    "",
    "RULES:",
    "• trackingNumber keys = digits only (strip dashes, spaces, parentheses).",
    "• Zip code keys = 5-digit strings with leading zeros ('32601', '01010'). Never integers.",
    "• Strip all currency symbols ($, commas) before parsing amounts.",
    "• NEVER invent or round amounts — use exact numbers from the data.",
    "• In the reply, explicitly list each tracking number, each zip (if computed), and the final totals.",
    "• If you're missing data to compute zip spend, say exactly what you have and what you still need.",
    "• CRITICAL: Update spend for ANY tracking number regardless of how many clients/conversions it has.",
    "  A flyer with 0 clients can still have spend — always update it.",
    "• Example reply: 'Drop 1 (4782177161) — 3 zips × 3 mailings: 32601=$1350, 32602=$1140, 32603=$1560. Total: $4,050.'",
  ].join("\n");

  // ── Convert messages to OpenAI format (with vision support) ─────────────
  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => {
      if (m.role === "assistant") {
        return { role: "assistant" as const, content: m.content };
      }
      // User message — may include one or more screenshots
      if (m.images && m.images.length > 0) {
        return {
          role: "user" as const,
          content: [
            { type: "text" as const, text: m.content || `Here are ${m.images.length} screenshot${m.images.length > 1 ? "s" : ""}, please extract the data.` },
            ...m.images.map(img => ({ type: "image_url" as const, image_url: { url: img, detail: "high" as const } })),
          ],
        };
      }
      return { role: "user" as const, content: m.content };
    }),
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: thread,
    max_tokens: 1200,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "{}";

  let parsed: {
    reply?: string;
    spendUpdates?: Record<string, number>;
    zipSpendUpdates?: Record<string, Record<string, number>>;
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw, spendUpdates: {}, zipSpendUpdates: {} };
  }

  return NextResponse.json({
    reply:           parsed.reply           ?? "Done.",
    spendUpdates:    parsed.spendUpdates    ?? {},
    zipSpendUpdates: parsed.zipSpendUpdates ?? {},
  });
}
