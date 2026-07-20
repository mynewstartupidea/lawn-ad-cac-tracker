import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTranscript, submitRender } from "../../../lib/video/vendors";
import { computeCutList } from "../../../lib/video/cutlist";

export const maxDuration = 60;

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
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

    // Vendors redeliver webhooks — don't redo work if this stage already finished.
    if (job.transcript_status === "done" || job.transcript_status === "failed") {
      return NextResponse.json({ success: true });
    }

    const transcript = await getTranscript(job.transcript_job_id);

    if (transcript.status === "error") {
      await sb
        .from("video_jobs")
        .update({
          transcript_status: "failed",
          status: "failed",
          error_message: transcript.error || "Transcription failed.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      return NextResponse.json({ success: true });
    }

    if (transcript.status !== "completed") {
      // Not actually finished yet — ignore, the real completion webhook will follow.
      return NextResponse.json({ success: true });
    }

    const durationMs = Math.round((transcript.audio_duration || 0) * 1000);
    const words = (transcript.words || []).map(w => ({ text: w.text, start: w.start, end: w.end }));
    const cutList = computeCutList(words, durationMs, {
      openingTrim: job.options?.openingTrim ?? true,
      removeSilence: job.options?.removeSilence ?? false,
      removeFillers: job.options?.removeFillers ?? false,
    });

    await sb
      .from("video_jobs")
      .update({
        transcript_status: "done",
        transcript: { words, language_code: transcript.language_code },
        duration_seconds: transcript.audio_duration,
        cut_list: cutList,
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);

    // Phase 3 will add a parallel Cleanvoice enhancement step here — when enabled,
    // wait for its webhook too before rendering instead of proceeding immediately.
    const needsAudio = job.options?.audioEnhance ?? false;
    if (needsAudio && job.audio_status !== "done") {
      return NextResponse.json({ success: true });
    }

    // Atomic gate: only the webhook that actually flips render_triggered_at proceeds.
    const { data: gated } = await sb
      .from("video_jobs")
      .update({ render_triggered_at: new Date().toISOString(), status: "rendering", render_status: "processing" })
      .eq("id", jobId)
      .is("render_triggered_at", null)
      .select()
      .single();

    if (!gated) {
      return NextResponse.json({ success: true });
    }

    const renderJob = await submitRender({
      videoUrl: job.source_video_url,
      clips: cutList.segments.map((s: { startMs: number; endMs: number }) => ({ startMs: s.startMs, endMs: s.endMs })),
      callbackUrl: `${getSiteUrl()}/api/webhooks/shotstack?job=${jobId}&token=${job.webhook_token}`,
    });

    await sb
      .from("video_jobs")
      .update({ render_job_id: renderJob.id, updated_at: new Date().toISOString() })
      .eq("id", jobId);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Webhook AssemblyAI]", err);
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
