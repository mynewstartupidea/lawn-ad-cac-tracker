import { NextResponse } from "next/server";
import { supabase } from "../../lib/supabase";

export async function GET() {
  const { data, error } = await supabase
    .from("ad_spends")
    .select("*")
    .order("ad_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ spends: data || [] });
}

export async function PUT(req: Request) {
  const { ad_name, spend } = await req.json();

  if (!ad_name || typeof spend !== "number") {
    return NextResponse.json({ error: "ad_name and spend are required" }, { status: 400 });
  }

  const { error } = await supabase.from("ad_spends").upsert(
    {
      ad_name,
      spend,
      source: "manual",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "ad_name" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
