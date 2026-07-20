create table if not exists video_jobs (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  status              text not null default 'uploaded'
                       check (status in ('uploaded','analyzing','rendering','done','failed')),
  error_message       text,

  original_filename   text not null,
  file_size_bytes     bigint not null,
  mime_type           text not null,
  source_video_path   text not null,
  source_video_url    text,
  duration_seconds    numeric,

  transcript_status   text not null default 'pending'
                       check (transcript_status in ('pending','processing','done','failed')),
  transcript_job_id   text,
  transcript          jsonb,

  audio_status        text not null default 'pending'
                       check (audio_status in ('pending','processing','done','failed')),
  audio_job_id        text,
  cleaned_audio_url   text,

  cut_list            jsonb,
  caption_track       jsonb,

  render_triggered_at timestamptz,
  render_status       text not null default 'pending'
                       check (render_status in ('pending','processing','done','failed')),
  render_job_id       text,
  output_video_url    text,

  webhook_token       uuid not null default gen_random_uuid(),
  options             jsonb not null default '{"openingTrim":true,"removeSilence":false,"removeFillers":false,"captions":false,"audioEnhance":false,"language":"en"}'::jsonb
);

create unique index if not exists video_jobs_webhook_token_idx on video_jobs (webhook_token);
create index if not exists video_jobs_status_idx on video_jobs (status);
