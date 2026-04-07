import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";
import { extractSoldEmail } from "../../lib/extractSoldEmail";

interface SlackMessage {
  type: string;
  text?: string;
  subtype?: string;
  ts: string;
}

interface SlackHistoryResponse {
  ok: boolean;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

async function fetchAllMessages(token: string, channelId: string): Promise<SlackMessage[]> {
  const all: SlackMessage[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({
      channel: channelId,
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });

    const res = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data: SlackHistoryResponse = await res.json();

    if (!data.ok) {
      console.error("[Backfill] Slack API error:", data.error);
      break;
    }

    all.push(...(data.messages ?? []));
    cursor = data.has_more ? data.response_metadata?.next_cursor : undefined;
  } while (cursor);

  return all;
}

export async function POST() {
  const token     = process.env.SLACK_BOT_TOKEN;
  const channelId = process.env.SLACK_CHANNEL_ID;

  if (!token || !channelId) {
    return NextResponse.json(
      { error: "SLACK_BOT_TOKEN and SLACK_CHANNEL_ID env vars required" },
      { status: 400 }
    );
  }

  // Fetch all existing sale emails so we can skip duplicates in bulk
  const { data: existingSales } = await supabase.from("sales").select("email");
  const existing = new Set((existingSales ?? []).map((s: { email: string }) => s.email));

  const messages = await fetchAllMessages(token, channelId);
  console.log(`[Backfill] fetched ${messages.length} messages from Slack`);

  const toInsert: { email: string; status: string }[] = [];

  for (const msg of messages) {
    // Only process regular user messages (skip bot messages, channel joins, etc.)
    if (msg.subtype) continue;
    const text = msg.text;
    if (!text) continue;

    const email = extractSoldEmail(text);
    if (!email) continue;
    if (existing.has(email)) continue;

    toInsert.push({ email, status: "sold" });
    existing.add(email); // prevent duplicates within this batch
  }

  if (toInsert.length === 0) {
    return NextResponse.json({ inserted: 0, message: "All sold messages already in database." });
  }

  const { error } = await supabase.from("sales").insert(toInsert);
  if (error) {
    console.error("[Backfill] insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  console.log(`[Backfill] inserted ${toInsert.length} sales:`, toInsert.map(s => s.email));

  return NextResponse.json({
    inserted: toInsert.length,
    emails: toInsert.map(s => s.email),
  });
}
