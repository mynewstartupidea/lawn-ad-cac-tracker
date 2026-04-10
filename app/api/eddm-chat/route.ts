import { NextResponse } from "next/server";
import OpenAI from "openai";

export const maxDuration = 60;

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
  images?: string[];
}

interface Flyer {
  flyerName: string;
  trackingNumber: string;
  totalCalls: number;
  conversions: number;
}

// ── Same math logic as eddm-zip-spend route ───────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function normalizeDrop(raw: string): string {
  const match = String(raw).match(/drop\s*(\d+(?:\.\d+)?)/i);
  return match ? `drop${match[1]}` : "";
}

function normalizeTracking(raw: string): string {
  return String(raw).replace(/\D/g, "");
}

function normalizeZip(raw: string): string {
  const digits = String(raw).replace(/\D/g, "").slice(0, 5);
  return digits.length >= 3 ? digits.padStart(5, "0") : "";
}

interface RawSpendRow { tracking: string; drop: string; amount: number; }
interface RawZipRow   { drop: string; zip: string; amountPerMailing: number; }

function computeFromRawData(
  spendRows: RawSpendRow[],
  zipRows:   RawZipRow[],
): {
  spendUpdates:    Record<string, number>;
  zipSpendUpdates: Record<string, Record<string, number>>;
  summary: string;
} {
  // Build drop → zip → cost map
  const dropZipCost = new Map<string, Map<string, number>>();
  for (const r of zipRows) {
    const dropKey = normalizeDrop(r.drop);
    const zip     = normalizeZip(String(r.zip));
    if (!dropKey || !zip || r.amountPerMailing <= 0) continue;
    if (!dropZipCost.has(dropKey)) dropZipCost.set(dropKey, new Map());
    dropZipCost.get(dropKey)!.set(zip, r.amountPerMailing);
  }

  // Build tracking → { totalSpend, drops: Map<dropKey, repCount> }
  const trackingMap = new Map<string, { totalSpend: number; drops: Map<string, number> }>();
  for (const r of spendRows) {
    const tracking = normalizeTracking(r.tracking);
    const dropKey  = normalizeDrop(r.drop);
    if (!tracking || !dropKey) continue;
    if (!trackingMap.has(tracking)) trackingMap.set(tracking, { totalSpend: 0, drops: new Map() });
    const entry = trackingMap.get(tracking)!;
    entry.totalSpend += r.amount;
    entry.drops.set(dropKey, (entry.drops.get(dropKey) ?? 0) + 1);
  }

  const spendUpdates:    Record<string, number>                 = {};
  const zipSpendUpdates: Record<string, Record<string, number>> = {};
  const lines: string[] = [];

  for (const [tracking, { totalSpend, drops }] of trackingMap.entries()) {
    spendUpdates[tracking] = round2(totalSpend);

    const zipSpend: Record<string, number> = {};
    for (const [dropKey, repCount] of drops.entries()) {
      const zipCosts = dropZipCost.get(dropKey);
      if (!zipCosts) continue;
      for (const [zip, costPerMailing] of zipCosts.entries()) {
        zipSpend[zip] = round2((zipSpend[zip] ?? 0) + costPerMailing * repCount);
      }
    }
    if (Object.keys(zipSpend).length > 0) zipSpendUpdates[tracking] = zipSpend;

    const fmt = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    lines.push(`${tracking}: total ${fmt(totalSpend)}, ${Object.keys(zipSpend).length} zips`);
  }

  return { spendUpdates, zipSpendUpdates, summary: lines.join(" | ") };
}

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 400 });

  const { messages, flyers } = (await req.json()) as {
    messages: IncomingMessage[];
    flyers: Flyer[];
  };

  const openai = new OpenAI({ apiKey: openaiKey });

  const flyerList = flyers.map(f =>
    `  • "${f.flyerName}" — tracking: ${f.trackingNumber}`
  ).join("\n");

  const systemPrompt = [
    "You are an EDDM spend data extractor for Liquid Lawn.",
    "Your ONLY job is to READ data from screenshots/text and return it as structured JSON.",
    "You do NOT calculate totals or zip spend — the server does all math. Just extract raw rows.",
    "",
    "Flyers in the dashboard (for reference):",
    flyerList || "  (none loaded)",
    "",
    "═══ TWO FILE TYPES ═══",
    "",
    "FILE 1 — Flat spend table",
    "  Columns: Amount Spent | Tracking Number | Drop",
    "  Each row is ONE mailing event. Extract EVERY row individually — do NOT sum, do NOT aggregate.",
    "  Example screenshot rows:",
    "    $48,524.16 | 9046592008 | Drop 1   → extract as-is",
    "    $27,148.16 | 9046592008 | Drop 2   → extract as-is (same tracking, different drop)",
    "    $27,208.00 | 3862703350 | Drop 2.5 → extract as-is",
    "    $27,208.00 | 3862703350 | Drop 2.5 → extract as-is (same tracking+drop again = mailed twice)",
    "",
    "FILE 2 — Sectioned zip cost file",
    "  Has section headers like 'Drop 1 Zipcode', 'Drop 2 zipcodes', 'Drop 2.5 - zipcodes'",
    "  Under each header: rows of Zip | Pieces | Amount (Pieces is irrelevant, skip it)",
    "  Amount = cost for that zip for ONE mailing of that drop.",
    "  Extract each zip row with its drop section name.",
    "",
    "TYPE A — User pastes direct spend totals (no screenshots, just text like '9046592008 = $75,000'):",
    "  → Put directly in spendUpdates. This is the final total, not a raw row.",
    "",
    "═══ RESPONSE FORMAT — ALWAYS valid JSON only, no markdown ═══",
    '{',
    '  "reply": "Brief description of what you found in the screenshots.",',
    '  "spendUpdates": {},',
    '  "zipSpendUpdates": {},',
    '  "rawSpendRows": [',
    '    { "tracking": "9046592008", "drop": "Drop 1", "amount": 48524.16 },',
    '    { "tracking": "9046592008", "drop": "Drop 2", "amount": 27148.16 }',
    '  ],',
    '  "rawZipRows": [',
    '    { "drop": "Drop 1", "zip": "32259", "amountPerMailing": 9142.08 },',
    '    { "drop": "Drop 2", "zip": "32092", "amountPerMailing": 6393.28 }',
    '  ]',
    '}',
    "",
    "RULES:",
    "• rawSpendRows: extract EVERY individual row — never sum, never skip duplicates.",
    "• rawZipRows: extract every zip under every drop section.",
    "• Strip $ and commas from amounts — return as plain numbers.",
    "• Tracking numbers: digits only, strip spaces/dashes.",
    "• Zip codes: 5-digit strings ('32601'). Never integers.",
    "• spendUpdates and zipSpendUpdates should be empty {} unless TYPE A (direct text entry).",
    "• If only File 1 visible: fill rawSpendRows, leave rawZipRows empty, ask for File 2.",
    "• If only File 2 visible: fill rawZipRows, leave rawSpendRows empty, ask for File 1.",
    "• If both visible: fill both arrays. Server will compute everything.",
    "• NEVER calculate totals yourself. Extract raw rows only.",
  ].join("\n");

  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => {
      if (m.role === "assistant") {
        return { role: "assistant" as const, content: m.content };
      }
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
    max_tokens: 4000,
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0].message.content ?? "{}";

  let parsed: {
    reply?: string;
    spendUpdates?: Record<string, number>;
    zipSpendUpdates?: Record<string, Record<string, number>>;
    rawSpendRows?: RawSpendRow[];
    rawZipRows?: RawZipRow[];
  } = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = { reply: raw };
  }

  // ── Server-side math if we have raw rows ─────────────────────────────────
  let spendUpdates    = parsed.spendUpdates    ?? {};
  let zipSpendUpdates = parsed.zipSpendUpdates ?? {};
  let reply           = parsed.reply           ?? "Done.";

  const spendRows = parsed.rawSpendRows ?? [];
  const zipRows   = parsed.rawZipRows   ?? [];

  if (spendRows.length > 0 && zipRows.length > 0) {
    // Both files — compute everything server-side
    const computed = computeFromRawData(spendRows, zipRows);
    spendUpdates    = { ...spendUpdates, ...computed.spendUpdates };
    zipSpendUpdates = { ...zipSpendUpdates, ...computed.zipSpendUpdates };

    // Show exactly what was extracted so user can verify GPT read correctly
    const spendRowsSummary = spendRows.map(r => `  ${r.tracking} | ${r.drop} | $${r.amount}`).join("\n");
    const spendTotals = Object.entries(computed.spendUpdates).map(([t, v]) => `  ${t} → $${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join("\n");
    reply = `Extracted ${spendRows.length} spend rows and ${zipRows.length} zip rows.\n\nSpend rows I read:\n${spendRowsSummary}\n\nCalculated totals:\n${spendTotals}\n\nIf any row looks wrong, let me know — the numbers above are exactly what I read from your screenshot.`;

  } else if (spendRows.length > 0) {
    // File 1 only — sum spend per tracking, no zip breakdown yet
    const trackingTotals = new Map<string, number>();
    for (const r of spendRows) {
      const t = normalizeTracking(r.tracking);
      if (!t) continue;
      trackingTotals.set(t, round2((trackingTotals.get(t) ?? 0) + r.amount));
    }
    for (const [t, total] of trackingTotals.entries()) {
      spendUpdates[t] = total;
    }
    const spendRowsSummary = spendRows.map(r => `  ${r.tracking} | ${r.drop} | $${r.amount}`).join("\n");
    const totalsSummary = Array.from(trackingTotals.entries()).map(([t, v]) => `  ${t} → $${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join("\n");
    reply = (parsed.reply ?? "") + `\n\nSpend rows I read:\n${spendRowsSummary}\n\nTotals:\n${totalsSummary}\n\nNow share the zip cost file (sectioned by Drop) to get zip-level breakdown.`;
  }

  return NextResponse.json({ reply, spendUpdates, zipSpendUpdates });
}
