import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function GET(req: Request) {
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  const adAccountId = process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!accessToken || !adAccountId) {
    return NextResponse.json(
      { error: "Facebook credentials not configured. Add FACEBOOK_ACCESS_TOKEN and FACEBOOK_AD_ACCOUNT_ID to .env.local" },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(req.url);
  const datePreset = searchParams.get("date_preset") || "this_month";

  try {
    const fields = "ad_name,campaign_name,spend";
    const allData: { ad_name: string; spend: string }[] = [];
    let url: string | null =
      `https://graph.facebook.com/v21.0/act_${adAccountId}/insights` +
      `?fields=${fields}&level=ad&date_preset=${datePreset}&access_token=${accessToken}`;

    // Paginate through all results
    while (url) {
      const response = await fetch(url);
      const fbData = await response.json();

      if (fbData.error) {
        return NextResponse.json({ error: fbData.error.message }, { status: 400 });
      }

      allData.push(...(fbData.data || []));
      url = fbData.paging?.next ?? null;
    }

    // Group by ad_name and sum spend
    const spendByAd: Record<string, number> = {};
    for (const item of allData) {
      const adName = item.ad_name || "Unknown Ad";
      spendByAd[adName] = (spendByAd[adName] || 0) + parseFloat(item.spend || "0");
    }

    // Upsert to Supabase so spend is persisted
    const upsertData = Object.entries(spendByAd).map(([ad_name, spend]) => ({
      ad_name,
      spend: Math.round(spend * 100) / 100,
      source: "facebook",
      updated_at: new Date().toISOString(),
    }));

    if (upsertData.length > 0) {
      const { error } = await supabase
        .from("ad_spends")
        .upsert(upsertData, { onConflict: "ad_name" });

      if (error) {
        console.error("Error persisting Facebook spend:", error);
      }
    }

    return NextResponse.json({ spends: spendByAd, count: upsertData.length });
  } catch (err) {
    console.error("Facebook API error:", err);
    return NextResponse.json({ error: "Failed to fetch Facebook ad data" }, { status: 500 });
  }
}
