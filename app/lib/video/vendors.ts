const ASSEMBLYAI_BASE = "https://api.assemblyai.com/v2";
const SHOTSTACK_BASE = `https://api.shotstack.io/edit/${process.env.SHOTSTACK_ENV === "production" ? "v1" : "stage"}`;

export interface AssemblyAIWord {
  text: string;
  start: number; // ms
  end: number; // ms
  confidence: number;
}

export interface AssemblyAITranscript {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text: string | null;
  words: AssemblyAIWord[] | null;
  audio_duration: number | null; // seconds
  language_code: string | null;
  error?: string;
}

export async function submitTranscription(params: {
  audioUrl: string;
  webhookUrl: string;
  languageCode?: string;
}): Promise<{ id: string; status: string }> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY not configured");

  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: params.audioUrl,
      webhook_url: params.webhookUrl,
      punctuate: true,
      format_text: true,
      disfluencies: true,
      language_code: params.languageCode || "en_us",
    }),
  });

  if (!res.ok) {
    throw new Error(`AssemblyAI submit failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getTranscript(id: string): Promise<AssemblyAITranscript> {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY not configured");

  const res = await fetch(`${ASSEMBLYAI_BASE}/transcript/${id}`, {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI fetch failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export interface RenderSegment {
  startMs: number;
  endMs: number;
}

export async function submitRender(params: {
  videoUrl: string;
  clips: RenderSegment[];
  callbackUrl: string;
}): Promise<{ id: string }> {
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) throw new Error("SHOTSTACK_API_KEY not configured");

  let cursor = 0;
  const clips = params.clips.map(seg => {
    const trim = seg.startMs / 1000;
    const length = (seg.endMs - seg.startMs) / 1000;
    const clip = {
      asset: { type: "video", src: params.videoUrl, trim },
      start: cursor,
      length,
    };
    cursor += length;
    return clip;
  });

  const res = await fetch(`${SHOTSTACK_BASE}/render`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      timeline: { tracks: [{ clips }] },
      output: { format: "mp4", resolution: "hd" },
      callback: params.callbackUrl,
    }),
  });

  if (!res.ok) {
    throw new Error(`Shotstack submit failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return { id: json.response.id };
}

export async function getRender(id: string): Promise<{ id: string; status: string; url?: string }> {
  const apiKey = process.env.SHOTSTACK_API_KEY;
  if (!apiKey) throw new Error("SHOTSTACK_API_KEY not configured");

  const res = await fetch(`${SHOTSTACK_BASE}/render/${id}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!res.ok) {
    throw new Error(`Shotstack fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  return json.response;
}
