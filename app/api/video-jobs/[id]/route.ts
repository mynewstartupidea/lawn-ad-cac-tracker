import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "video-uploads";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sb = getClient();
    const { data, error } = await sb.from("video_jobs").select("*").eq("id", id).single();

    if (error) {
      console.error("[VideoJob GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json({ job: data });
  } catch (err) {
    console.error("[VideoJob GET]", err);
    return NextResponse.json({ error: "Failed to fetch video job." }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sb = getClient();

    const { data: job } = await sb.from("video_jobs").select("source_video_path").eq("id", id).single();
    if (job?.source_video_path) {
      await sb.storage.from(BUCKET).remove([job.source_video_path]);
    }

    const { error } = await sb.from("video_jobs").delete().eq("id", id);
    if (error) {
      console.error("[VideoJob DELETE]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[VideoJob DELETE]", err);
    return NextResponse.json({ error: "Failed to delete video job." }, { status: 500 });
  }
}
