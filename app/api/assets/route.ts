import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const BUCKET = "brand-assets";

function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, key);
}

// Creates the bucket if it doesn't exist yet
async function ensureBucket(sb: ReturnType<typeof getClient>) {
  const { data: buckets } = await sb.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error) console.error("[Assets] Failed to create bucket:", error.message);
  }
}

export async function GET() {
  const sb = getClient();
  await ensureBucket(sb);

  const { data, error } = await sb.storage
    .from(BUCKET)
    .list("", { sortBy: { column: "created_at", order: "desc" } });

  if (error) {
    console.error("[Assets GET]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const assets = (data ?? [])
    .filter(f => f.name !== ".emptyFolderPlaceholder")
    .map(f => ({
      name:       f.name,
      size:       f.metadata?.size ?? 0,
      type:       f.metadata?.mimetype ?? "application/octet-stream",
      url:        sb.storage.from(BUCKET).getPublicUrl(f.name).data.publicUrl,
      created_at: f.created_at,
    }));

  return NextResponse.json({ assets });
}

export async function POST(req: Request) {
  const sb = getClient();
  await ensureBucket(sb);

  const form = await req.formData();
  const file = form.get("file") as File | null;

  if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${Date.now()}_${safeName}`;

  const bytes  = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const { error } = await sb.storage.from(BUCKET).upload(fileName, buffer, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    console.error("[Assets POST]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(fileName);

  return NextResponse.json({
    name: fileName,
    url:  publicUrl,
    size: file.size,
    type: file.type,
  });
}

export async function DELETE(req: Request) {
  const sb = getClient();
  const { name } = (await req.json()) as { name: string };

  if (!name) return NextResponse.json({ error: "No filename provided." }, { status: 400 });

  const { error } = await sb.storage.from(BUCKET).remove([name]);
  if (error) {
    console.error("[Assets DELETE]", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
