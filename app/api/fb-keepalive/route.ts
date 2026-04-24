import { NextResponse } from "next/server";

// Vercel cron job — runs every 3 hours.
// Rotates through different FB API calls each run to simulate genuine usage
// and keep the app active so Meta doesn't revoke access due to inactivity.

const BASE = "https://graph.facebook.com/v21.0";

type FbError = { message: string };

// Different queries rotated each call so Meta sees varied, realistic usage
const QUERIES = [
  // 1. Spend + impressions last 7 days
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/insights?fields=spend,impressions,clicks&date_preset=last_7_days&access_token=${token}`,
  // 2. Spend last 30 days
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/insights?fields=spend,reach,ctr&date_preset=last_30_days&access_token=${token}`,
  // 3. Campaign list
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/campaigns?fields=name,status,objective&access_token=${token}`,
  // 4. Ad set list
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/adsets?fields=name,status,daily_budget&access_token=${token}`,
  // 5. Account info
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}?fields=name,account_status,currency,spend_cap&access_token=${token}`,
  // 6. Today's spend
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/insights?fields=spend,impressions&date_preset=today&access_token=${token}`,
  // 7. This week spend by ad
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/insights?fields=ad_name,spend&level=ad&date_preset=this_week_sun_today&access_token=${token}`,
  // 8. Yesterday's performance
  (accountId: string, token: string) =>
    `${BASE}/act_${accountId}/insights?fields=spend,clicks,impressions,cpm&date_preset=yesterday&access_token=${token}`,
];

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken   = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!accessToken || !accountIdsRaw) {
    return NextResponse.json({ error: "Facebook credentials not configured." }, { status: 400 });
  }

  const accountIds = accountIds_parsed(accountIdsRaw);

  // Pick query based on current hour so each 3-hour window uses a different endpoint
  const queryIndex = Math.floor(new Date().getUTCHours() / 3) % QUERIES.length;
  const buildUrl   = QUERIES[queryIndex];

  const results: { accountId: string; query: number; status: string; error?: string }[] = [];

  for (const accountId of accountIds) {
    try {
      const url  = buildUrl(accountId, accessToken);
      const res  = await fetch(url);
      const data = await res.json() as { error?: FbError };

      if (data.error) {
        results.push({ accountId, query: queryIndex, status: "error", error: data.error.message });
      } else {
        results.push({ accountId, query: queryIndex, status: "ok" });
      }
    } catch (err) {
      results.push({ accountId, query: queryIndex, status: "error", error: String(err) });
    }
  }

  console.log("[FB keepalive]", new Date().toISOString(), `query#${queryIndex}`, results);
  return NextResponse.json({ ok: true, query: queryIndex, results });
}

function accountIds_parsed(raw: string): string[] {
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}
