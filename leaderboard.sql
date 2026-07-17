-- ============================================================
-- Snake Royale — Season Leaderboard
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- ============================================================

-- 1) Table: one row per player, tracking total wins.
create table if not exists public.leaderboard (
  user_id    text primary key,
  name       text,
  avatar     text,
  wins       int not null default 0,
  updated_at timestamptz not null default now()
);

-- 2) Row Level Security: the overlay (anon key) may READ the board.
alter table public.leaderboard enable row level security;
drop policy if exists "lb_read_anon" on public.leaderboard;
create policy "lb_read_anon"
  on public.leaderboard for select
  to anon
  using (true);

-- 3) Recording a win goes through this function (not direct table writes),
--    so the anon key can only ever increment a win — never edit the table freely.
create or replace function public.bump_win(p_id text, p_name text, p_avatar text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.leaderboard(user_id, name, avatar, wins, updated_at)
  values (p_id, p_name, p_avatar, 1, now())
  on conflict (user_id) do update
    set wins       = public.leaderboard.wins + 1,
        name       = excluded.name,
        avatar     = excluded.avatar,
        updated_at = now();
end;
$$;

grant execute on function public.bump_win(text, text, text) to anon;

-- 4) Optional: reset the season (clears all wins).
-- delete from public.leaderboard;
