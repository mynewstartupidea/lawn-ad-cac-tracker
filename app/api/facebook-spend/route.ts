import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

interface FbInsight {
  ad_name: string;
  spend: string;
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
  const fields = "ad_name,spend";
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
  // Support multiple comma-separated account IDs: "435459903489885,1467364857363196"
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!accessToken || !accountIdsRaw) {
    return NextResponse.json(
      { error: "Facebook credentials not configured. Add FACEBOOK_ACCESS_TOKEN and FACEBOOK_AD_ACCOUNT_IDS to Vercel env vars." },
      { status: 400 }
    );
  }

  const accountIds = accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("date_preset") || "last_30_days";

  try {
    // Fetch all accounts in parallel
    const results = await Promise.all(
      accountIds.map(id => fetchAllInsightsForAccount(id, accessToken, datePreset))
    );

    const allData = results.flat();

    // Group by ad_name and sum spend across both accounts
    const spendByAd: Record<string, number> = {};
    for (const item of allData) {
      const adName = item.ad_name?.trim() || "Unknown Ad";
      spendByAd[adName] = (spendByAd[adName] || 0) + parseFloat(item.spend || "0");
    }

    // Round to 2 decimal places
    for (const key in spendByAd) {
      spendByAd[key] = Math.round(spendByAd[key] * 100) / 100;
    }

    // Persist to Supabase
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

      if (error) {
        console.error("[FB] Error persisting spend to Supabase:", error);
      }
    }

    console.log(`[FB] Synced ${upsertData.length} ads across ${accountIds.length} accounts (${accountIds.join(", ")})`);

    return NextResponse.json({
      spends: spendByAd,
      count: upsertData.length,
      accounts: accountIds.length,
    });
  } catch (err) {
    console.error("[FB] Unexpected error:", err);
    return NextResponse.json({ error: "Failed to fetch Facebook ad data" }, { status: 500 });
  }
}
