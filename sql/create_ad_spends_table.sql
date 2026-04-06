-- Run this in your Supabase SQL editor
-- Dashboard: https://supabase.com/dashboard → SQL Editor

create table if not exists ad_spends (
  id uuid default gen_random_uuid() primary key,
  ad_name text not null unique,
  spend numeric(10,2) not null default 0,
  source text not null default 'manual', -- 'manual' or 'facebook'
  updated_at timestamptz not null default now()
);
