import { NextResponse } from "next/server";
import OpenAI from "openai";
import { AD_ACCOUNTS, AdAccount } from "../../lib/adAccounts";

const FB_BASE = "https://graph.facebook.com/v21.0";

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_campaigns",
      description: "List all Facebook ad campaigns with their current status and budget",
      parameters: { type: "object", properties: {}, required: [] },
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
          campaign_name: { type: "string", description: "The campaign name (for user-facing confirmation)" },
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
          campaign_name: { type: "string", description: "The campaign name (for user-facing confirmation)" },
        },
        required: ["campaign_id", "campaign_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_campaign_insights",
      description: "Get spend, impressions, clicks and CTR for a specific campaign",
      parameters: {
        type: "object",
        properties: {
          campaign_id:   { type: "string", description: "The Facebook campaign ID" },
          campaign_name: { type: "string", description: "The campaign name" },
          date_preset:   { type: "string", enum: ["last_7d","last_14d","last_30_days","maximum"], description: "Time range for insights" },
        },
        required: ["campaign_id", "campaign_name"],
      },
    },
  },
];

async function runTool(
  name: string,
  args: Record<string, string>,
  accessToken: string,
  accountIds: string[]
): Promise<string> {
  if (name === "list_campaigns") {
    const results = await Promise.all(
      accountIds.map(async id => {
        const fields = "id,name,status,daily_budget,lifetime_budget";
        const res  = await fetch(`${FB_BASE}/act_${id}/campaigns?fields=${fields}&access_token=${accessToken}`);
        const data = await res.json();
        return (data.data ?? []) as { id: string; name: string; status: string; daily_budget?: string }[];
      })
    );
    const campaigns = results.flat();
    if (!campaigns.length) return "No campaigns found.";
    return campaigns
      .map(c => {
        const budget = c.daily_budget ? `$${(parseInt(c.daily_budget) / 100).toFixed(2)}/day` : "lifetime budget";
        return `• ${c.name} [ID: ${c.id}] — ${c.status} — ${budget}`;
      })
      .join("\n");
  }

  if (name === "pause_campaign" || name === "resume_campaign") {
    const newStatus = name === "pause_campaign" ? "PAUSED" : "ACTIVE";
    const res = await fetch(`${FB_BASE}/${args.campaign_id}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status: newStatus, access_token: accessToken }).toString(),
    });
    const data = await res.json();
    if (data.error) return `Error: ${data.error.message}`;
    return `Done — "${args.campaign_name}" is now ${newStatus === "PAUSED" ? "paused" : "active"}.`;
  }

  if (name === "get_campaign_insights") {
    const preset = args.date_preset || "last_30_days";
    const fields = "spend,impressions,clicks,ctr,cpm,cpc,reach";
    const res = await fetch(
      `${FB_BASE}/${args.campaign_id}/insights?fields=${fields}&date_preset=${preset}&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.error) return `Error: ${data.error.message}`;
    const ins = data.data?.[0];
    if (!ins) return `No insights data found for "${args.campaign_name}".`;
    return `"${args.campaign_name}" (${preset}): Spend=$${ins.spend}, Impressions=${ins.impressions}, Clicks=${ins.clicks}, CTR=${ins.ctr}%, CPM=$${ins.cpm}, CPC=$${ins.cpc}`;
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

  const openai     = new OpenAI({ apiKey: openaiKey });

  const { messages, assets, account = "all" } = (await req.json()) as {
    messages: { role: "user" | "assistant"; content: string }[];
    assets?: { name: string }[];
    account?: AdAccount | "all";
  };

  // Filter account IDs based on selected account
  const allAccountIds = accountIdsRaw ? accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean) : [];
  const accountIds = account === "all"
    ? allAccountIds
    : [AD_ACCOUNTS[account as AdAccount]?.accountId].filter(Boolean) as string[];

  // Build account-aware context for the system prompt
  const accountCtx = account === "all"
    ? "You are managing both Florida ($99 offer) and Georgia ($19 offer) accounts."
    : account === "florida"
    ? `You are managing the Florida account only. Current offer: ${AD_ACCOUNTS.florida.offer}. Landing page: ${AD_ACCOUNTS.florida.landingUrl}`
    : `You are managing the Georgia account only. Current offer: ${AD_ACCOUNTS.georgia.offer}. Landing page: ${AD_ACCOUNTS.georgia.landingUrl}`;

  const systemPrompt = [
    "You are an AI assistant for Liquid Lawn's Facebook Ads management dashboard.",
    accountCtx,
    "You help the team manage campaigns — pausing, resuming, checking performance, and launching new ads.",
    accessToken
      ? "You have live access to Facebook Ads via function calling. Always confirm before taking destructive actions."
      : "The Facebook Ads API is not connected (missing FACEBOOK_ACCESS_TOKEN). Provide advice only.",
    assets?.length
      ? `Available brand assets: ${assets.map(a => a.name).join(", ")}.`
      : "No brand assets uploaded yet.",
    "Be concise and action-oriented. When the user asks to pause or resume campaigns, do it directly using functions.",
    "IMPORTANT: Never use markdown formatting. No **bold**, no ### headers, no bullet dashes. Use plain sentences and newlines only.",
  ].join(" ");

  const thread: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...messages,
  ];

  // Agentic loop — model calls tools, we execute them, repeat up to 4 rounds
  for (let i = 0; i < 4; i++) {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: thread,
      tools: accessToken ? TOOLS : undefined,
      tool_choice: "auto",
    });

    const msg = response.choices[0].message;
    thread.push(msg);

    // No tool calls → final answer
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return NextResponse.json({ reply: msg.content ?? "" });
    }

    // Execute each tool call
    for (const tc of msg.tool_calls) {
      if (tc.type !== "function") continue;
      const args   = JSON.parse(tc.function.arguments) as Record<string, string>;
      const result = accessToken
        ? await runTool(tc.function.name, args, accessToken, accountIds)
        : "Facebook Ads API not connected.";
      thread.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }

  return NextResponse.json({ reply: "Actions completed. Let me know if you need anything else." });
}
