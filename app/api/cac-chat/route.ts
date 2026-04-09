import { NextResponse } from "next/server";
import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

const FB_BASE = "https://graph.facebook.com/v21.0";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

function dateFilter(range: string): string | null {
  const days: Record<string, number> = { "7d": 7, "14d": 14, "30d": 30 };
  if (!days[range]) return null;
  const d = new Date();
  d.setDate(d.getDate() - days[range]);
  return d.toISOString();
}

function fbDatePreset(range: string): string {
  const map: Record<string, string> = {
    "7d": "last_7d", "14d": "last_14d", "30d": "last_30_days", "all": "maximum",
  };
  return map[range] || "last_30_days";
}

async function queryData(range: string) {
  const sb   = getSupabase();
  const from = dateFilter(range);

  // Leads
  let leadsQ = sb.from("leads").select("id,email,ad_name,created_at");
  if (from) leadsQ = leadsQ.gte("created_at", from);
  const { data: leadsRaw } = await leadsQ;
  const leads = leadsRaw ?? [];

  // Sales — all time so we can match by email
  const { data: allSalesRaw } = await sb.from("sales").select("id,email,created_at");
  const allSales = allSalesRaw ?? [];

  // Sales within the range
  let salesQ = sb.from("sales").select("id,email,created_at");
  if (from) salesQ = salesQ.gte("created_at", from);
  const { data: salesRaw } = await salesQ;
  const sales = salesRaw ?? [];

  // Ad spends from Supabase (last FB sync)
  const { data: spendRowsRaw } = await sb.from("ad_spends").select("ad_name,spend");
  const spendRows = spendRowsRaw ?? [];

  // Build sold-email set for range
  const soldEmails = new Set((sales as { email: string }[]).map(s => s.email));

  // Build spend map
  const spendMap: Record<string, number> = {};
  for (const row of spendRows as { ad_name: string; spend: number }[]) {
    spendMap[row.ad_name] = row.spend;
  }

  // Per-ad aggregation
  const byAd: Record<string, { leads: number; sales: number; spend: number }> = {};
  for (const l of leads as { ad_name: string; email: string }[]) {
    const ad = l.ad_name || "Unknown";
    if (!byAd[ad]) byAd[ad] = { leads: 0, sales: 0, spend: spendMap[ad] ?? 0 };
    byAd[ad].leads++;
    if (soldEmails.has(l.email)) byAd[ad].sales++;
  }

  return { leads, sales, allSales, soldEmails, byAd, spendMap };
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function toolGetOverview(range: string): Promise<string> {
  const { leads, sales, byAd } = await queryData(range);
  const totalLeads = leads.length;
  const totalSales = sales.length;
  const totalSpend = Object.values(byAd).reduce((s, a) => s + a.spend, 0);
  const cac  = totalSales > 0 ? totalSpend / totalSales : null;
  const conv = totalLeads > 0 ? (totalSales / totalLeads) * 100 : null;

  const rangeLabel = { "7d": "last 7 days", "14d": "last 14 days", "30d": "last 30 days", "all": "all time" }[range] || range;

  return [
    `Overview for ${rangeLabel}:`,
    `Total leads: ${totalLeads}`,
    `Total sales (closed): ${totalSales}`,
    `Total ad spend on record: $${totalSpend.toFixed(2)}`,
    `Average CAC (spend / sales): ${cac !== null ? "$" + cac.toFixed(2) : "N/A — no sales yet"}`,
    `Conversion rate (leads → sales): ${conv !== null ? conv.toFixed(1) + "%" : "N/A"}`,
  ].join("\n");
}

async function toolGetAdBreakdown(range: string): Promise<string> {
  const { byAd } = await queryData(range);
  const rows = Object.entries(byAd).sort((a, b) => b[1].sales - a[1].sales);
  if (!rows.length) return "No lead data found for this period.";

  const lines = rows.map(([ad, d]) => {
    const cac  = d.sales > 0 ? `$${(d.spend / d.sales).toFixed(0)}` : "no sales";
    const conv = d.leads > 0 ? `${((d.sales / d.leads) * 100).toFixed(1)}%` : "0%";
    return `${ad}: ${d.leads} leads, ${d.sales} sales, $${d.spend.toFixed(0)} spend, CAC ${cac}, conv ${conv}`;
  });

  return `Ad performance (${range}):\n` + lines.join("\n");
}

async function toolGetAdDetails(adName: string, range: string): Promise<string> {
  const { byAd, spendMap } = await queryData(range);

  // Find closest match (case-insensitive)
  const key = Object.keys(byAd).find(k => k.toLowerCase().includes(adName.toLowerCase())) || adName;
  const d   = byAd[key];

  if (!d) return `No data found for ad matching "${adName}" in the ${range} period. Try get_ad_breakdown to see all ad names.`;

  const cac  = d.sales > 0 ? `$${(d.spend / d.sales).toFixed(2)}` : "N/A (no sales)";
  const conv = d.leads > 0 ? `${((d.sales / d.leads) * 100).toFixed(1)}%` : "0%";
  const cpl  = d.leads > 0 ? `$${(d.spend / d.leads).toFixed(2)}` : "N/A";

  return [
    `Ad: ${key} (${range})`,
    `Leads: ${d.leads}`,
    `Sales closed: ${d.sales}`,
    `Spend: $${d.spend.toFixed(2)}`,
    `Cost per lead: ${cpl}`,
    `CAC (spend / sales): ${cac}`,
    `Conversion rate: ${conv}`,
  ].join("\n");
}

async function toolGetFbInsights(adName: string, range: string): Promise<string> {
  const accessToken   = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;
  if (!accessToken || !accountIdsRaw) return "Facebook API not connected.";

  const accountIds = accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const preset = fbDatePreset(range);
  const fields = "ad_name,spend,impressions,clicks,ctr,cpc,reach";

  const results = await Promise.all(
    accountIds.map(async id => {
      const url = `${FB_BASE}/act_${id}/insights?fields=${fields}&level=ad&date_preset=${preset}&access_token=${accessToken}`;
      const res  = await fetch(url);
      const json = await res.json();
      return (json.data ?? []) as { ad_name: string; spend: string; impressions: string; clicks: string; ctr: string; cpc: string }[];
    })
  );

  const all = results.flat();
  const match = adName === "all"
    ? all
    : all.filter(r => r.ad_name?.toLowerCase().includes(adName.toLowerCase()));

  if (!match.length) return `No Facebook data found for "${adName}" in ${preset}.`;

  if (adName === "all") {
    const totalSpend = match.reduce((s, r) => s + parseFloat(r.spend || "0"), 0);
    const totalClicks = match.reduce((s, r) => s + parseFloat(r.clicks || "0"), 0);
    const totalImpressions = match.reduce((s, r) => s + parseFloat(r.impressions || "0"), 0);
    const ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) : "0";
    const topAds = [...match].sort((a, b) => parseFloat(b.spend) - parseFloat(a.spend)).slice(0, 5);
    const topLines = topAds.map(r => `  ${r.ad_name}: $${parseFloat(r.spend).toFixed(0)} spend, ${r.clicks} clicks`);
    return [
      `Facebook summary (${preset}): Total spend $${totalSpend.toFixed(2)}, ${totalClicks} clicks, CTR ${ctr}%`,
      "Top 5 by spend:",
      ...topLines,
    ].join("\n");
  }

  const r = match[0];
  return `Facebook: "${r.ad_name}" (${preset}): Spend $${parseFloat(r.spend).toFixed(2)}, Clicks ${r.clicks}, CTR ${parseFloat(r.ctr).toFixed(2)}%, CPC $${parseFloat(r.cpc).toFixed(2)}`;
}

// ─── Tools definition ─────────────────────────────────────────────────────────

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_overview",
      description: "Get overall CAC dashboard stats: total leads, sales, spend, CAC, and conversion rate for a time period",
      parameters: {
        type: "object",
        properties: {
          date_range: { type: "string", enum: ["7d", "14d", "30d", "all"], description: "Time range" },
        },
        required: ["date_range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ad_breakdown",
      description: "Get per-ad performance breakdown: leads, sales, spend, CAC, and conversion rate for every ad",
      parameters: {
        type: "object",
        properties: {
          date_range: { type: "string", enum: ["7d", "14d", "30d", "all"], description: "Time range" },
        },
        required: ["date_range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ad_details",
      description: "Get detailed stats for a specific ad by name",
      parameters: {
        type: "object",
        properties: {
          ad_name:    { type: "string", description: "Ad name or partial name to search for" },
          date_range: { type: "string", enum: ["7d", "14d", "30d", "all"], description: "Time range" },
        },
        required: ["ad_name", "date_range"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fb_insights",
      description: "Get live Facebook Ads API data: spend, clicks, CTR, CPC for ads. Use ad_name='all' for overall summary",
      parameters: {
        type: "object",
        properties: {
          ad_name:    { type: "string", description: "Ad name or 'all' for totals" },
          date_range: { type: "string", enum: ["7d", "14d", "30d", "all"], description: "Time range" },
        },
        required: ["ad_name", "date_range"],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, string>): Promise<string> {
  if (name === "get_overview")     return toolGetOverview(args.date_range || "30d");
  if (name === "get_ad_breakdown") return toolGetAdBreakdown(args.date_range || "30d");
  if (name === "get_ad_details")   return toolGetAdDetails(args.ad_name || "", args.date_range || "30d");
  if (name === "get_fb_insights")  return toolGetFbInsights(args.ad_name || "all", args.date_range || "30d");
  return "Unknown tool.";
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 400 });

  const { messages, dateRange = "30d" } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    dateRange?: string;
  };

  const openai = new OpenAI({ apiKey: openaiKey });

  const systemPrompt = [
    "You are a growth analyst for Liquid Lawn, a lawn care company running Facebook ads.",
    "You have full access to their CAC (Customer Acquisition Cost) dashboard data via function calling.",
    `The user's currently selected date range filter is ${dateRange === "7d" ? "last 7 days" : dateRange === "14d" ? "last 14 days" : dateRange === "30d" ? "last 30 days" : "all time"} — use this as the default date_range in all tool calls unless the user specifies otherwise.`,
    "Data sources: leads come from GoHighLevel (CRM), sales come from Slack (when the team marks a deal closed), ad spend comes from Facebook Ads API.",
    "CAC = total ad spend / number of sales. CPL = spend / leads. Conversion rate = sales / leads.",
    "When asked about best performing ads, call get_ad_breakdown and rank by lowest CAC (or most sales). When asked about a specific ad, call get_ad_details.",
    "For questions about spend, clicks, impressions or Facebook-specific data, use get_fb_insights.",
    "Always call the relevant tool(s) before answering — never guess numbers.",
    "Talk like a sharp analyst giving a briefing: lead with the headline number, then context, then 1-2 recommendations. Be direct and specific.",
    "IMPORTANT: Never use markdown formatting. No **bold**, no ### headers, no dashes for bullets. Use plain sentences and newlines only.",
  ].join(" ");

  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  for (let i = 0; i < 8; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: thread,
      tools: TOOLS,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    thread.push(msg);

    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return NextResponse.json({ reply: msg.content ?? "" });
    }

    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const args   = JSON.parse(tc.function.arguments) as Record<string, string>;
      const result = await runTool(tc.function.name, args);
      thread.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return NextResponse.json({ reply: "Analysis complete. Let me know if you have more questions." });
}
