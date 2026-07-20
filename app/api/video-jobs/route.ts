import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "video-uploads";
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB cap
const ALLOWED_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

async function ensureBucket(sb: ReturnType<typeof getClient>) {
  const { data: buckets } = await sb.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: false });
    if (error) console.error("[VideoJobs] Failed to create bucket:", error.message);
  }
}

export async function POST(req: Request) {
  try {
    const { filename, sizeBytes, mimeType } = (await req.json()) as {
      filename?: string;
      sizeBytes?: number;
      mimeType?: string;
    };

    if (!filename || !sizeBytes || !mimeType) {
      return NextResponse.json({ error: "filename, sizeBytes, and mimeType are required." }, { status: 400 });
    }
    if (sizeBytes > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max size is ${Math.round(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB.` },
        { status: 400 }
      );
    }
    if (!ALLOWED_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
    }

    const sb = getClient();
    await ensureBucket(sb);

    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${Date.now()}_${safeName}`;

    const { data: signed, error: signedError } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
    if (signedError || !signed) {
      console.error("[VideoJobs POST] signed url error:", signedError?.message);
      return NextResponse.json({ error: signedError?.message || "Failed to create upload URL." }, { status: 500 });
    }

    const { data: job, error: dbError } = await sb
      .from("video_jobs")
      .insert({
        status: "uploaded",
        original_filename: filename,
        file_size_bytes: sizeBytes,
        mime_type: mimeType,
        source_video_path: path,
      })
      .select()
      .single();

    if (dbError) {
      console.error("[VideoJobs POST] db error:", dbError.message);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      uploadUrl: signed.signedUrl,
      uploadToken: signed.token,
      path,
    });
  } catch (err) {
    console.error("[VideoJobs POST]", err);
    return NextResponse.json({ error: "Failed to create video job." }, { status: 500 });
  }
}

export async function GET() {
  try {
    const sb = getClient();
    const { data, error } = await sb
      .from("video_jobs")
      .select("id, created_at, status, original_filename, duration_seconds, output_video_url, error_message")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("[VideoJobs GET]", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ jobs: data });
  } catch (err) {
    console.error("[VideoJobs GET]", err);
    return NextResponse.json({ error: "Failed to list video jobs." }, { status: 500 });
  }
}
