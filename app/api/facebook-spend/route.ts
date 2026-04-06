import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

interface FbInsight {
  ad_name: string;
  spend: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  ctr?: string;
  cpm?: string;
  cpp?: string;
}

interface FbResponse {
  data?: FbInsight[];
  paging?: { next?: string };
  error?: { message: string };
}

async function fetchAllInsightsForAccount(
  accountId: string,
  accessToken: string,
  datePreset: string
): Promise<FbInsight[]> {
  const fields = "ad_name,spend,impressions,clicks,reach,ctr,cpm,cpp";
  const allData: FbInsight[] = [];
  let nextUrl: string | null =
    `https://graph.facebook.com/v21.0/act_${accountId}/insights` +
    `?fields=${fields}&level=ad&date_preset=${datePreset}&access_token=${accessToken}`;

  while (nextUrl) {
    const res = await fetch(nextUrl);
    const fbData: FbResponse = await res.json();

    if (fbData.error) {
      console.error(`[FB] Error fetching act_${accountId}:`, fbData.error.message);
      break;
    }

    allData.push(...(fbData.data ?? []));
    nextUrl = fbData.paging?.next ?? null;
  }

  return allData;
}

export async function GET(req: Request) {
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!accessToken || !accountIdsRaw) {
    return NextResponse.json(
      { error: "Facebook credentials not configured." },
      { status: 400 }
    );
  }

  const allAccountIds = accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const { searchParams } = new URL(req.url);
  const datePreset   = searchParams.get("date_preset") || "last_30_days";
  const accountParam = searchParams.get("account") || "all"; // "all" | specific account id

  const accountIds = accountParam === "all"
    ? allAccountIds
    : allAccountIds.filter(id => id === accountParam);

  try {
    const results = await Promise.all(
      accountIds.map(id => fetchAllInsightsForAccount(id, accessToken, datePreset))
    );

    const allData = results.flat();

    // Aggregate totals across all ads
    let totalSpend = 0;
    let totalImpressions = 0;
    let totalClicks = 0;
    let totalReach = 0;

    // Group by ad_name
    const byAd: Record<string, {
      spend: number; impressions: number; clicks: number; reach: number;
    }> = {};

    for (const item of allData) {
      const adName = item.ad_name?.trim() || "Unknown Ad";
      const spend       = parseFloat(item.spend        || "0");
      const impressions = parseFloat(item.impressions   || "0");
      const clicks      = parseFloat(item.clicks        || "0");
      const reach       = parseFloat(item.reach         || "0");

      totalSpend       += spend;
      totalImpressions += impressions;
      totalClicks      += clicks;
      totalReach       += reach;

      if (!byAd[adName]) byAd[adName] = { spend: 0, impressions: 0, clicks: 0, reach: 0 };
      byAd[adName].spend       += spend;
      byAd[adName].impressions += impressions;
      byAd[adName].clicks      += clicks;
      byAd[adName].reach       += reach;
    }

    // Round spend per ad
    const spendByAd: Record<string, number> = {};
    for (const [ad, d] of Object.entries(byAd)) {
      spendByAd[ad] = Math.round(d.spend * 100) / 100;
    }

    // Derived metrics
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;

    // Persist spend to Supabase
    const upsertData = Object.entries(spendByAd).map(([ad_name, spend]) => ({
      ad_name,
      spend,
      source: "facebook",
      updated_at: new Date().toISOString(),
    }));

    if (upsertData.length > 0) {
      const { error } = await supabase
        .from("ad_spends")
        .upsert(upsertData, { onConflict: "ad_name" });
      if (error) console.error("[FB] Supabase upsert error:", error);
    }

    console.log(`[FB] Synced ${upsertData.length} ads | spend=$${totalSpend.toFixed(2)} | impressions=${totalImpressions}`);

    return NextResponse.json({
      spends: spendByAd,
      count: upsertData.length,
      accounts: accountIds.length,
      metrics: {
        spend:       Math.round(totalSpend * 100) / 100,
        impressions: Math.round(totalImpressions),
        clicks:      Math.round(totalClicks),
        reach:       Math.round(totalReach),
        ctr:         Math.round(ctr * 100) / 100,
        cpm:         Math.round(cpm * 100) / 100,
        cpc:         Math.round(cpc * 100) / 100,
      },
    });
  } catch (err) {
    console.error("[FB] Unexpected error:", err);
    return NextResponse.json({ error: "Failed to fetch Facebook ad data" }, { status: 500 });
  }
}
