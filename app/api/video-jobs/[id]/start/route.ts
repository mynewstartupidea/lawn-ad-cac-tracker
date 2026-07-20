import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { submitTranscription } from "../../../../lib/video/vendors";

export const maxDuration = 60;

const BUCKET = "video-uploads";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

function getSiteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sb = getClient();

    const { data: job, error: fetchError } = await sb.from("video_jobs").select("*").eq("id", id).single();
    if (fetchError || !job) {
      return NextResponse.json({ error: "Job not found." }, { status: 404 });
    }
    if (job.status !== "uploaded") {
      return NextResponse.json({ error: `Job is already ${job.status}.` }, { status: 400 });
    }

    const { data: signed, error: signedError } = await sb.storage
      .from(BUCKET)
      .createSignedUrl(job.source_video_path, 60 * 60 * 6); // 6 hours — enough for transcription + render

    if (signedError || !signed) {
      console.error("[VideoJob start] signed read url error:", signedError?.message);
      return NextResponse.json({ error: "Failed to generate video access URL." }, { status: 500 });
    }

    const webhookUrl = `${getSiteUrl()}/api/webhooks/assemblyai?job=${job.id}&token=${job.webhook_token}`;

    const transcriptJob = await submitTranscription({
      audioUrl: signed.signedUrl,
      webhookUrl,
      languageCode: job.options?.language,
    });

    const { error: updateError } = await sb
      .from("video_jobs")
      .update({
        status: "analyzing",
        transcript_status: "processing",
        transcript_job_id: transcriptJob.id,
        source_video_url: signed.signedUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateError) {
      console.error("[VideoJob start] update error:", updateError.message);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, transcriptJobId: transcriptJob.id });
  } catch (err) {
    console.error("[VideoJob start]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to start processing." },
      { status: 500 }
    );
  }
}
