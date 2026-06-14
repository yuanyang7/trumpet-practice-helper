-- Run this once in your Supabase project: Dashboard → SQL Editor → New query.
-- Creates the table the app stores saved songs in, and opens it to the public
-- (anon) key so the static frontend can read/write without a login.
-- This is fine for a personal practice app; anyone with your project URL + anon
-- key could read/write this table, so don't put anything sensitive in it.

create table if not exists songs (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  video_id   text unique,                 -- enables upsert: re-analyzing updates the row
  data       jsonb not null,              -- the full analysis result the app renders
  created_at timestamptz default now()
);

alter table songs enable row level security;

create policy "anon read"   on songs for select to anon using (true);
create policy "anon insert" on songs for insert to anon with check (true);
create policy "anon update" on songs for update to anon using (true) with check (true);
create policy "anon delete" on songs for delete to anon using (true);
