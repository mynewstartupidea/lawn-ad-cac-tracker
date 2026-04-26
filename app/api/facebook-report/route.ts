import { NextResponse } from "next/server";

interface FbInsightItem {
  ad_id: string;
  ad_name: string;
  spend: string;
  impressions: string;
  clicks: string;
  ctr: string;
  reach: string;
  cpm: string;
}

interface FbAd {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  creative?: { thumbnail_url?: string };
}

export interface AdReportItem {
  adId: string;
  adName: string;
  status: string;
  effectiveStatus: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  reach: number;
  cpm: number;
  thumbnailUrl?: string;
  accountId: string;
}

async function paginatedFetch<T>(startUrl: string): Promise<T[]> {
  const all: T[] = [];
  let url: string | null = startUrl;
  while (url) {
    const fetchUrl: string = url;
    const res  = await fetch(fetchUrl);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message ?? "Facebook API error");
    all.push(...(data.data ?? []));
    url = data.paging?.next ?? null;
  }
  return all;
}

export async function GET(req: Request) {
  const token         = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!token || !accountIdsRaw) {
    return NextResponse.json({ error: "Facebook credentials not configured." }, { status: 400 });
  }

  const allIds     = accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const { searchParams } = new URL(req.url);
  const accountParam = searchParams.get("account")      || "all";
  const datePreset   = searchParams.get("date_preset")  || "last_7d";

  const accountIds = accountParam === "all"
    ? allIds
    : allIds.filter(id => id === accountParam);

  try {
    const allAds = (await Promise.all(
      accountIds.map(async (accountId) => {
        const insightsUrl =
          `https://graph.facebook.com/v21.0/act_${accountId}/insights` +
          `?fields=ad_id,ad_name,spend,impressions,clicks,ctr,reach,cpm` +
          `&level=ad&date_preset=${datePreset}&limit=500&access_token=${token}`;

        const adsUrl =
          `https://graph.facebook.com/v21.0/act_${accountId}/ads` +
          `?fields=id,name,status,effective_status,creative{thumbnail_url}` +
          `&limit=500&access_token=${token}`;

        const [insights, ads] = await Promise.all([
          paginatedFetch<FbInsightItem>(insightsUrl),
          paginatedFetch<FbAd>(adsUrl),
        ]);

        const adMap = new Map(ads.map(a => [a.id, a]));

        return insights.map((item): AdReportItem => {
          const ad = adMap.get(item.ad_id);
          return {
            adId:            item.ad_id,
            adName:          item.ad_name || "Unknown Ad",
            status:          ad?.status         ?? "UNKNOWN",
            effectiveStatus: ad?.effective_status ?? "UNKNOWN",
            spend:           parseFloat(item.spend       || "0"),
            impressions:     parseInt(item.impressions   || "0"),
            clicks:          parseInt(item.clicks        || "0"),
            ctr:             parseFloat(item.ctr         || "0"),
            reach:           parseInt(item.reach         || "0"),
            cpm:             parseFloat(item.cpm         || "0"),
            thumbnailUrl:    ad?.creative?.thumbnail_url,
            accountId,
          };
        });
      })
    )).flat().sort((a, b) => b.spend - a.spend);

    const activeCount = allAds.filter(a => a.effectiveStatus === "ACTIVE").length;

    return NextResponse.json({
      ads: allAds,
      summary: {
        total:      allAds.length,
        active:     activeCount,
        inactive:   allAds.length - activeCount,
        totalSpend: Math.round(allAds.reduce((s, a) => s + a.spend, 0) * 100) / 100,
        avgCtr:     allAds.length > 0
          ? Math.round((allAds.reduce((s, a) => s + a.ctr, 0) / allAds.length) * 100) / 100
          : 0,
      },
    });
  } catch (err) {
    console.error("[fb-report]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
