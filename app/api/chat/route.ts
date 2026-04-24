import { NextResponse } from "next/server";
import OpenAI from "openai";
import { AD_ACCOUNTS, AdAccount } from "../../lib/adAccounts";

const FB_BASE = "https://graph.facebook.com/v21.0";

// Extract lead count from FB actions array — mirrors what Ads Manager shows as "Results"
function extractLeads(actions: { action_type: string; value: string }[]): number {
  const LEAD_TYPES = ["lead", "onsite_web_lead", "offsite_conversion.fb_pixel_lead"];
  for (const t of LEAD_TYPES) {
    const match = actions.find(a => a.action_type === t);
    if (match) return parseInt(match.value);
  }
  return 0;
}

function extractCPL(cpaList: { action_type: string; value: string }[]): number | null {
  const LEAD_TYPES = ["lead", "onsite_web_lead", "offsite_conversion.fb_pixel_lead"];
  for (const t of LEAD_TYPES) {
    const match = cpaList.find(a => a.action_type === t);
    if (match) return parseFloat(match.value);
  }
  return null;
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_performance_summary",
      description: "Get account-level performance: total spend, leads, CPL, clicks from Meta Ads. Use for any 'how are my ads doing' question.",
      parameters: {
        type: "object",
        properties: {
          date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30_days", "maximum"], description: "Time range" },
        },
        required: ["date_preset"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description: "List all campaigns with spend, leads, CPL, and status. Use to rank campaigns and find winners/losers.",
      parameters: {
        type: "object",
        properties: {
          date_preset: { type: "string", enum: ["last_7d", "last_14d", "last_30_days", "maximum"], description: "Time range" },
        },
        required: ["date_preset"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "pause_campaign",
      description: "Pause an active Facebook ad campaign",
      parameters: {
        type: "object",
        properties: {
          campaign_id:   { type: "string", description: "The Facebook campaign ID" },
          campaign_name: { type: "string", description: "The campaign name (for confirmation)" },
        },
        required: ["campaign_id", "campaign_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "resume_campaign",
      description: "Resume (activate) a paused Facebook ad campaign",
      parameters: {
        type: "object",
        properties: {
          campaign_id:   { type: "string", description: "The Facebook campaign ID" },
          campaign_name: { type: "string", description: "The campaign name (for confirmation)" },
        },
        required: ["campaign_id", "campaign_name"],
      },
    },
  },
];

type FbAction = { action_type: string; value: string };
type FbInsight = {
  spend: string;
  clicks: string;
  impressions: string;
  actions?: FbAction[];
  cost_per_action_type?: FbAction[];
};

async function runTool(
  name: string,
  args: Record<string, string>,
  accessToken: string,
  accountIds: string[]
): Promise<string> {

  // ── get_performance_summary ───────────────────────────────────────────────
  if (name === "get_performance_summary") {
    const preset = args.date_preset || "last_30_days";
    const fields = "spend,clicks,impressions,actions,cost_per_action_type";

    const results = await Promise.all(
      accountIds.map(async id => {
        const url  = `${FB_BASE}/act_${id}/insights?fields=${fields}&date_preset=${preset}&access_token=${accessToken}`;
        const res  = await fetch(url);
        const json = await res.json() as { data?: FbInsight[]; error?: { message: string } };
        if (json.error) return { error: json.error.message, spend: 0, leads: 0, clicks: 0, impressions: 0, cpl: null as number | null };
        const d = json.data?.[0];
        if (!d) return { error: null, spend: 0, leads: 0, clicks: 0, impressions: 0, cpl: null as number | null };
        const leads = extractLeads(d.actions ?? []);
        const cpl   = extractCPL(d.cost_per_action_type ?? []);
        return {
          error:       null,
          spend:       parseFloat(d.spend || "0"),
          leads,
          clicks:      parseFloat(d.clicks || "0"),
          impressions: parseFloat(d.impressions || "0"),
          cpl,
        };
      })
    );

    const totalSpend       = results.reduce((s, r) => s + r.spend, 0);
    const totalLeads       = results.reduce((s, r) => s + r.leads, 0);
    const totalClicks      = results.reduce((s, r) => s + r.clicks, 0);
    const totalImpressions = results.reduce((s, r) => s + r.impressions, 0);
    const blendedCPL       = totalLeads > 0 ? totalSpend / totalLeads : null;
    const ctr              = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const errors           = results.filter(r => r.error).map(r => r.error).join(", ");

    return [
      `Period: ${preset}`,
      `Total leads (Website Leads from Meta): ${totalLeads}`,
      `Total spend: $${totalSpend.toFixed(2)}`,
      `Blended CPL: ${blendedCPL !== null ? "$" + blendedCPL.toFixed(2) : "N/A — no leads tracked"}`,
      `Total clicks: ${totalClicks} | Impressions: ${totalImpressions.toLocaleString()} | CTR: ${ctr.toFixed(2)}%`,
      errors ? `Errors: ${errors}` : "",
    ].filter(Boolean).join("\n");
  }

  // ── list_campaigns ────────────────────────────────────────────────────────
  if (name === "list_campaigns") {
    const preset = args.date_preset || "last_30_days";
    const fields = "spend,clicks,impressions,actions,cost_per_action_type";

    const rows: { name: string; id: string; status: string; budget: string; spend: number; leads: number; cpl: number | null; clicks: number }[] = [];

    await Promise.all(
      accountIds.map(async id => {
        const campsRes  = await fetch(`${FB_BASE}/act_${id}/campaigns?fields=id,name,status,daily_budget&access_token=${accessToken}`);
        const campsData = await campsRes.json() as { data?: { id: string; name: string; status: string; daily_budget?: string }[] };
        const campaigns = campsData.data ?? [];

        await Promise.all(
          campaigns.map(async c => {
            const iRes  = await fetch(`${FB_BASE}/${c.id}/insights?fields=${fields}&date_preset=${preset}&access_token=${accessToken}`);
            const iData = await iRes.json() as { data?: FbInsight[] };
            const ins   = iData.data?.[0];
            const spend  = parseFloat(ins?.spend  || "0");
            const clicks = parseFloat(ins?.clicks || "0");
            const leads  = extractLeads(ins?.actions ?? []);
            const cpl    = leads > 0 ? spend / leads : extractCPL(ins?.cost_per_action_type ?? []);
            rows.push({
              name:   c.name,
              id:     c.id,
              status: c.status,
              budget: c.daily_budget ? `$${(parseInt(c.daily_budget) / 100).toFixed(0)}/day` : "—",
              spend, leads, cpl, clicks,
            });
          })
        );
      })
    );

    if (!rows.length) return "No campaigns found.";

    // Sort: leads desc, then spend desc for zero-lead campaigns
    rows.sort((a, b) => b.leads - a.leads || b.spend - a.spend);

    // Deduplicate names — if multiple campaigns share a name, append #1, #2, etc.
    const nameCounts: Record<string, number> = {};
    const nameIndex:  Record<string, number> = {};
    for (const r of rows) nameCounts[r.name] = (nameCounts[r.name] || 0) + 1;

    const lines = rows.map(c => {
      let displayName = c.name;
      if (nameCounts[c.name] > 1) {
        nameIndex[c.name] = (nameIndex[c.name] || 0) + 1;
        displayName = `${c.name} #${nameIndex[c.name]}`;
      }
      const cplStr = c.cpl !== null ? `$${c.cpl.toFixed(2)} CPL` : "0 leads";
      // ID kept at end in angle brackets so model can use it for pause/resume but knows not to show it
      return `${displayName} — ${c.status} — ${c.budget} — Spend: $${c.spend.toFixed(2)} — Leads: ${c.leads} — ${cplStr} — Clicks: ${c.clicks} <id:${c.id}>`;
    });

    return `Campaigns (${preset}), sorted best to worst:\n` + lines.join("\n");
  }

  // ── pause / resume ────────────────────────────────────────────────────────
  if (name === "pause_campaign" || name === "resume_campaign") {
    const newStatus = name === "pause_campaign" ? "PAUSED" : "ACTIVE";
    const res = await fetch(`${FB_BASE}/${args.campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: newStatus, access_token: accessToken }).toString(),
    });
    const data = await res.json() as { error?: { message: string } };
    if (data.error) return `Error: ${data.error.message}`;
    return `Done — "${args.campaign_name}" is now ${newStatus === "PAUSED" ? "paused" : "active"}.`;
  }

  return "Unknown tool.";
}

export async function POST(req: Request) {
  const openaiKey     = process.env.OPENAI_API_KEY;
  const accessToken   = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!openaiKey) {
    return NextResponse.json({ error: "OpenAI API key not configured." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: openaiKey });

  const { messages, assets, account = "florida" } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    assets?: { name: string }[];
    account?: AdAccount | "all";
  };

  const allAccountIds = accountIdsRaw ? accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  const accountIds = account === "all"
    ? allAccountIds
    : [AD_ACCOUNTS[account as AdAccount]?.accountId].filter(Boolean) as string[];

  const accountCtx = account === "all"
    ? "Both Florida ($99 offer) and Georgia ($19 offer) accounts."
    : account === "florida"
    ? `Florida account only. Offer: ${AD_ACCOUNTS.florida.offer}.`
    : `Georgia account only. Offer: ${AD_ACCOUNTS.georgia.offer}.`;

  const systemPrompt = [
    "You are a seasoned Facebook media buyer managing lawn care ad accounts. Talk like a performance marketer, not an analyst.",
    `Account in scope: ${accountCtx}`,
    "All data comes directly from Meta Ads API — same numbers you see in Ads Manager. Leads = 'Website Leads' from Meta (pixel-tracked lead events).",
    "For any performance question: call get_performance_summary first. For campaign-level breakdown: call list_campaigns.",
    "Benchmarks for lawn care: CPL under $20 = great, under $35 = acceptable, over $50 = bleeding money. Campaign spent $100+ with 0 leads = dead weight.",
    "Response format: Start with total leads and blended CPL. Rank campaigns best to worst by CPL. Call out winners and dead weight bluntly. End with ONE recommendation — the single most important action right now.",
    "Sound like a media buyer texting their boss a morning report. Short. Direct. Real numbers. Opinions.",
    "Never pause or resume campaigns unless explicitly told to.",
    "CRITICAL: Never show campaign IDs, ad IDs, or ad set IDs to the user. Always use the campaign name (with #1/#2 suffix if duplicates). IDs in <id:...> tags are for your internal use only — extract them silently for pause/resume calls.",
    assets?.length ? `Brand assets: ${assets.map(a => a.name).join(", ")}.` : "",
    "No markdown. No bold, no headers. Plain text only.",
  ].filter(Boolean).join(" ");

  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  for (let i = 0; i < 10; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: thread,
      tools: accessToken ? TOOLS : undefined,
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
      const result = accessToken
        ? await runTool(tc.function.name, args, accessToken, accountIds)
        : "Facebook Ads API not connected.";
      thread.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return NextResponse.json({ reply: "Analysis complete. Ask me anything else." });
}
