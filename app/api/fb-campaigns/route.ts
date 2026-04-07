import { NextResponse } from "next/server";

const FB_BASE = "https://graph.facebook.com/v21.0";

export async function GET(req: Request) {
  const accessToken   = process.env.FACEBOOK_ACCESS_TOKEN;
  const accountIdsRaw = process.env.FACEBOOK_AD_ACCOUNT_IDS || process.env.FACEBOOK_AD_ACCOUNT_ID;

  if (!accessToken || !accountIdsRaw) {
    return NextResponse.json({ error: "Facebook credentials not configured." }, { status: 400 });
  }

  const allIds = accountIdsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const { searchParams } = new URL(req.url);
  const accountParam = searchParams.get("account") || "all";
  const ids = accountParam === "all" ? allIds : allIds.filter(id => id === accountParam);

  try {
    const results = await Promise.all(ids.map(async (id) => {
      const fields = "id,name,status,daily_budget,lifetime_budget,objective,account_id";
      const url = `${FB_BASE}/act_${id}/campaigns?fields=${fields}&access_token=${accessToken}`;
      const res  = await fetch(url);
      const data = await res.json();
      if (data.error) {
        console.error(`[FB Campaigns] act_${id}:`, data.error.message);
        return [];
      }
      return data.data ?? [];
    }));
    return NextResponse.json({ campaigns: results.flat() });
  } catch (err) {
    console.error("[FB Campaigns GET] Error:", err);
    return NextResponse.json({ error: "Failed to fetch campaigns." }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const accessToken = process.env.FACEBOOK_ACCESS_TOKEN;
  if (!accessToken) {
    return NextResponse.json({ error: "Facebook credentials not configured." }, { status: 400 });
  }

  const { campaignId, status } = await req.json();
  if (!campaignId || !["ACTIVE", "PAUSED"].includes(status)) {
    return NextResponse.json({ error: "Invalid campaignId or status." }, { status: 400 });
  }

  try {
    const res = await fetch(`${FB_BASE}/${campaignId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ status, access_token: accessToken }).toString(),
    });
    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ error: data.error.message }, { status: 400 });
    }
    return NextResponse.json({ success: true, campaignId, status });
  } catch (err) {
    console.error("[FB Campaigns PATCH] Error:", err);
    return NextResponse.json({ error: "Failed to update campaign." }, { status: 500 });
  }
}
