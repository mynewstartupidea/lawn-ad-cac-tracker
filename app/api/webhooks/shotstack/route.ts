import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRender } from "../../../lib/video/vendors";

export const maxDuration = 30;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const jobId = url.searchParams.get("job");
    const token = url.searchParams.get("token");
    if (!jobId || !token) {
      return NextResponse.json({ error: "Missing job or token." }, { status: 400 });
    }

    const sb = getClient();
    const { data: job, error: fetchError } = await sb.from("video_jobs").select("*").eq("id", jobId).single();
    if (fetchError || !job || job.webhook_token !== token) {
      return NextResponse.json({ error: "Invalid job or token." }, { status: 403 });
    }

    if (job.render_status === "done" || job.render_status === "failed") {
      return NextResponse.json({ success: true });
    }
    if (!job.render_job_id) {
      return NextResponse.json({ error: "No render job recorded." }, { status: 400 });
    }

    const render = await getRender(job.render_job_id);

    if (render.status === "done" && render.url) {
      await sb
        .from("video_jobs")
        .update({
          render_status: "done",
          status: "done",
          output_video_url: render.url,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } else if (render.status === "failed") {
      await sb
        .from("video_jobs")
        .update({
          render_status: "failed",
          status: "failed",
          error_message: "Video rendering failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    }
    // Otherwise the render isn't actually finished yet — ignore, a later callback will follow.

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Webhook Shotstack]", err);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
