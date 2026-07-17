-- ============================================================
-- Snake Royale — Supabase setup
-- Run this once in Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Events table (one row per TikTok gift/like/share/join/chat)
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  kind        text not null,
  user_id     text,
  user_name   text,
  user_avatar text,
  payload     jsonb not null default '{}'::jsonb
);

-- 2) Make the table stream over Realtime
alter table public.events replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'events'
  ) then
    alter publication supabase_realtime add table public.events;
  end if;
end $$;

-- 3) Row Level Security
alter table public.events enable row level security;

-- Overlay uses the anon key and only needs to READ (Realtime respects RLS).
drop policy if exists "events_read_anon" on public.events;
create policy "events_read_anon"
  on public.events for select
  to anon
  using (true);

-- Inserts come only from the Vercel function using the SERVICE ROLE key,
-- which bypasses RLS — so no insert policy for anon is needed (keeps it safe).

-- 4) Optional: auto-delete old rows so the table stays tiny.
-- Run this block only if you have pg_cron enabled (Supabase -> Database -> Extensions).
-- select cron.schedule('purge_snake_events', '*/30 * * * *',
--   $$ delete from public.events where created_at < now() - interval '2 hours' $$);
