"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

type Theme = Record<string, string>;

type JobStatus = "idle" | "uploading" | "uploaded" | "analyzing" | "rendering" | "done" | "failed";

interface VideoJobRow {
  id: string;
  status: string;
  original_filename: string;
  output_video_url: string | null;
  error_message: string | null;
  duration_seconds: number | null;
}

const ACCEPT = "video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm";
const MAX_SIZE_BYTES = 1024 * 1024 * 1024; // 1GB, matches server cap

const STATUS_LABELS: Record<string, string> = {
  uploading: "Uploading…",
  uploaded: "Queued…",
  analyzing: "Transcribing & analyzing speech…",
  rendering: "Rendering your edit…",
  done: "Ready!",
  failed: "Something went wrong",
};

export default function VideoEditorTab({ C }: { C: Theme }) {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [job, setJob] = useState<VideoJobRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!job?.id) return;
    const channel = supabase
      .channel(`video_job_${job.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "video_jobs", filter: `id=eq.${job.id}` },
        payload => {
          const row = payload.new as VideoJobRow;
          setJob(row);
          setStatus(row.status as JobStatus);
          if (row.status === "failed") setError(row.error_message || "Processing failed.");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [job?.id]);

  function handleFile(f: File) {
    setError(null);
    if (f.size > MAX_SIZE_BYTES) {
      setError(`File too large. Max size is ${Math.round(MAX_SIZE_BYTES / (1024 * 1024))}MB.`);
      return;
    }
    setFile(f);
    setJob(null);
    setStatus("idle");
  }

  async function handleAiEdit() {
    if (!file) return;
    setError(null);
    setStatus("uploading");
    try {
      const createRes = await fetch("/api/video-jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, sizeBytes: file.size, mimeType: file.type }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error || "Failed to create job.");

      const { jobId, path, uploadToken } = createData;

      const { error: uploadError } = await supabase.storage
        .from("video-uploads")
        .uploadToSignedUrl(path, uploadToken, file);
      if (uploadError) throw new Error(uploadError.message);

      setStatus("uploaded");
      setJob({
        id: jobId,
        status: "uploaded",
        original_filename: file.name,
        output_video_url: null,
        error_message: null,
        duration_seconds: null,
      });

      const startRes = await fetch(`/api/video-jobs/${jobId}/start`, { method: "POST" });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error || "Failed to start processing.");

      setStatus("analyzing");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("failed");
    }
  }

  const isProcessing = status === "uploading" || status === "uploaded" || status === "analyzing" || status === "rendering";

  return (
    <>
      <h1 style={{ fontSize: 22, fontWeight: 600, color: C.text, margin: "4px 0 2px" }}>🎬 AI Video Editor</h1>
      <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 20px" }}>
        Upload raw footage, get an export-ready ad creative — trimmed and cleaned up automatically.
      </p>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, boxShadow: C.shadow, maxWidth: 560 }}>
        <div
          onClick={() => !isProcessing && inputRef.current?.click()}
          style={{
            border: `2px dashed ${C.border}`,
            borderRadius: 10,
            padding: "32px 16px",
            textAlign: "center",
            cursor: isProcessing ? "default" : "pointer",
            background: C.bg,
            marginBottom: 16,
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            style={{ display: "none" }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
          <div style={{ fontSize: 14, color: C.text, fontWeight: 500 }}>
            {file ? file.name : "Click to choose a video"}
          </div>
          {file && (
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </div>
          )}
        </div>

        <button
          onClick={handleAiEdit}
          disabled={!file || isProcessing}
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            fontSize: 14,
            fontWeight: 600,
            cursor: !file || isProcessing ? "default" : "pointer",
            background: !file || isProcessing ? C.border : C.blue,
            color: !file || isProcessing ? C.textMuted : "#fff",
          }}
        >
          {isProcessing ? STATUS_LABELS[status] : "✨ AI Edit"}
        </button>

        {error && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: C.redSoft, color: C.red, borderRadius: 8, fontSize: 13 }}>
            {error}
          </div>
        )}

        {status === "done" && job?.output_video_url && (
          <div style={{ marginTop: 20 }}>
            <video src={job.output_video_url} controls style={{ width: "100%", borderRadius: 8, background: "#000" }} />
            <a
              href={job.output_video_url}
              download
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 12,
                padding: "10px 16px",
                borderRadius: 8,
                background: C.green,
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Download
            </a>
          </div>
        )}
      </div>
    </>
  );
}
