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
    "Your job is to fill in ad spend amounts — both total per flyer AND per zip code.",
    "",
    "Current flyers loaded in the dashboard:",
    flyerList || "  (no flyers loaded yet)",
    "",
    "═══ ACTUAL DATA FORMAT ═══",
    "",
    "FILE 1 — Flat spend table (columns: Amount Spent | Tracking Number | Drop)",
    "  Each row = one mailing event for a tracking number in a given drop.",
    "  The SAME tracking number may appear multiple times across multiple drops.",
    "  Example rows:",
    "    $48,524.16 | 9046592008 | Drop 1",
    "    $27,148.16 | 9046592008 | Drop 2   ← same tracking, different drop",
    "    $48,524.16 | 9044201511 | Drop 1",
    "    $27,148.16 | 9044201511 | Drop 2",
    "    $27,208.00 | 3862703350 | Drop 2.5",
    "    $27,208.00 | 3862703350 | Drop 2.5  ← same tracking+drop twice = mailed twice",
    "  TOTAL spend per tracking = SUM of ALL Amount Spent rows for that tracking number.",
    "  REP COUNT for (tracking, drop) = number of rows with that exact tracking+drop combination.",
    "",
    "FILE 2 — Sectioned zip cost file",
    "  Organized in sections. Each section header looks like: 'Drop 1 Zipcode', 'Drop 2 zipcodes', 'Drop 2.5 - zipcodes'",
    "  Under each header: rows of Zip | Pieces | Amount",
    "  The Amount column = cost for that zip for ONE mailing of that drop. Pieces is irrelevant.",
    "  Example:",
    "    Drop 1 Zipcode",
    "    Zip   | Pieces | Amount",
    "    32259 | 28569  | $9,142.08",
    "    32258 | 16159  | $5,170.88",
    "    Drop 2 zipcodes",
    "    32092 | 19979  | $6,393.28",
    "",
    "═══ COMPUTATION RULES ═══",
    "",
    "When you have BOTH files (or data shared via text/screenshots in this conversation):",
    "  1. For each tracking number, identify which drops it appears in (from File 1).",
    "  2. Rep count for (tracking, drop) = number of File 1 rows with that tracking+drop combo.",
    "  3. For each drop this tracking is in, look up that drop's zip costs from File 2.",
    "  4. zip_spend = zip_amount_from_file2 × rep_count_for_that_drop",
    "  5. Total zip spend per tracking = sum of zip_spend across ALL drops for that tracking.",
    "  6. Total flyer spend = sum of ALL Amount Spent rows for that tracking in File 1.",
    "     (Both methods should give the same total — use File 1 total as authoritative.)",
    "",
    "═══ THREE INPUT TYPES YOU HANDLE ═══",
    "",
    "TYPE A — Direct total spend entry (user pastes amounts or a billing summary):",
    "  → Extract total spend per tracking number. Return in spendUpdates.",
    "  → Always update spend even if flyer has 0 clients or 0 conversions.",
    "",
    "TYPE B — File 2 only (sectioned zip costs):",
    "  → Parse each section header to identify the drop name.",
    "  → Extract zip → cost_per_mailing for each section.",
    "  → Store mentally. Cannot compute final zip spend yet (need File 1 rep counts).",
    "  → Reply with what you extracted, ask for File 1 (flat spend table).",
    "  → Return empty spendUpdates and zipSpendUpdates.",
    "",
    "TYPE C — File 1 only (flat spend table):",
    "  → Sum Amount Spent per tracking for spendUpdates.",
    "  → Count rep count per (tracking, drop) — store mentally.",
    "  → Cannot compute zip breakdown yet (need File 2 zip costs).",
    "  → Reply with totals and rep counts found, ask for File 2 (sectioned zip costs).",
    "",
    "TYPE D — BOTH files provided (in same message or from conversation history):",
    "  → Apply computation rules above.",
    "  → Return BOTH spendUpdates (total per tracking) AND zipSpendUpdates (per zip breakdown).",
    "",
    "═══ AGGREGATION RULE ═══",
    "  ALWAYS SUM all rows for the same tracking number. Never take just first or last.",
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
    "• In reply, list each tracking number, total spend, rep counts, and zip breakdown if computed.",
    "• If missing data, say exactly what you have and what you still need.",
    "• CRITICAL: Update spend for ANY tracking number regardless of client/conversion count.",
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
