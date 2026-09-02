-- Platformer — the whole database. Paste this file into the Supabase SQL editor
-- and run it. It is safely re-runnable: every object is dropped or guarded
-- before being created, so running it again after a change is the normal way to
-- apply that change. This is the only SQL file; when something needs to change,
-- it changes here and you re-run the lot.
--
-- One thing this file cannot do for you:
--   Authentication -> Sign In / Providers -> Email -> turn OFF "Confirm email"
-- Usernames map to addresses at platformer.local, which has no inbox, so a
-- confirmation mail would have nowhere to arrive.


-- ============================================================== 1. players

-- One row per player, created with the account rather than on first login.
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  username   text not null,
  session    uuid,
  last_seen  timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

-- Readable by everyone signed in, so friend lists and leaderboards work.
-- That means an unfiltered query returns every player: any read of your OWN
-- profile must say id=eq.<your id> explicitly.
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);

drop policy if exists "own profile writable" on public.profiles;
create policy "own profile writable" on public.profiles
  for update to authenticated using (auth.uid() = id);

-- The profile appears with the account. The username comes from the metadata
-- the signup call sends, which is where the typed capitalisation lives — the
-- address itself is lowercased, which is what makes logins case-insensitive.
create or replace function public.on_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', ''));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.on_new_user();


-- ====================================================== 2. one device at a time

-- Claiming writes this device's id onto the profile. Dropped by signature
-- first: create or replace would leave an old signature behind, and Postgres
-- then refuses the call as ambiguous.
drop function if exists public.claim_session(uuid);
create function public.claim_session(new_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles p
     set session = new_session
   where p.id = auth.uid();
end $$;

-- One call does two jobs: stamps presence so you can count who is online, and
-- returns who currently owns the account. A tab whose own id no longer matches
-- has been signed in elsewhere, and signs itself out.
drop function if exists public.heartbeat();
create function public.heartbeat() returns json
language plpgsql security definer set search_path = public as $$
declare claimed uuid;
begin
  update public.profiles p
     set last_seen = now()
   where p.id = auth.uid()
  returning p.session into claimed;

  return json_build_object('session', claimed);
end $$;


-- ============================================================== 3. runs

-- A personal history: what you played, how far you got, how long it took. The
-- run itself is not stored, so nothing here is replayable.
--
-- The game is client-side and the anon key is public, so a determined person
-- could POST a row by hand. Two things still hold: physically impossible times
-- are rejected by the database itself, and nobody can edit or delete a run or
-- file one under someone else name. Since this is your own history rather than
-- a ranking, there is nothing to gain by faking it anyway.

create table if not exists public.runs (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references auth.users on delete cascade,
  seed       text not null,
  mode       text not null,
  reached    int  not null,
  seconds    numeric(8,2) not null,
  falls      int  not null default 0,
  finished   boolean not null default false,
  checksum   text,
  client     text,
  hidden     boolean not null default false,
  created_at timestamptz default now()
);

alter table public.runs
  drop constraint if exists runs_mode_known,
  drop constraint if exists runs_distance_sane,
  drop constraint if exists runs_time_possible,
  drop constraint if exists runs_finished_means_finished,
  drop constraint if exists runs_inputs_bounded;

alter table public.runs drop column if exists inputs;

alter table public.runs
  -- '10k' is no longer offered by the menu, and it stays on this list anyway.
  -- Postgres checks a constraint against the rows already in the table when it
  -- is added, so dropping a retired mode from here would make this file refuse
  -- to re-run on any database that has a 10 km run in it.
  add constraint runs_mode_known check (mode in ('500m', '1k', '2k', '5k', '10k')),
  add constraint runs_distance_sane check (reached between 0 and 10000 and falls >= 0),

  -- The player's top speed is 9 metres per second and nothing in the game
  -- raises it, so covering N metres cannot take less than N/9 seconds. A time
  -- below this line is not a good run, it is an impossible one. The margin is
  -- for float rounding only.
  add constraint runs_time_possible check (seconds >= reached / 9.05),

  -- Claiming a finish means claiming the whole distance. The else arm is the
  -- retired 10 km, which is why it is still spelled out at all.
  add constraint runs_finished_means_finished check (
    not finished or reached >= case mode
      when '500m' then 500 when '1k' then 1000 when '2k' then 2000
      when '5k' then 5000 else 10000 end
  );

create index if not exists runs_board on public.runs (seed, mode, seconds);

alter table public.runs enable row level security;

drop policy if exists "runs readable" on public.runs;
create policy "runs readable" on public.runs
  for select to authenticated using (not hidden);

-- You may add your own runs and nothing else. There is deliberately no update
-- policy and no delete policy: a time cannot be edited after the fact, a rival
-- cannot be erased, and a cheat cannot tidy away its own evidence.
drop policy if exists "own runs insertable" on public.runs;
create policy "own runs insertable" on public.runs
  for insert to authenticated with check (auth.uid() = player_id);

-- The board function is gone: runs are a personal history now, read straight
-- from the table with a player_id filter, so there is nothing to rank.
drop function if exists public.leaderboard(text, text, int);


-- ============================================================= 4. moderation
-- Run these by hand when you need them. As project owner you bypass RLS, so
-- they work from the SQL editor even though players cannot do any of it.
--
--   -- hide one entry but keep the evidence
--   update public.runs set hidden = true where id = '<run id>';
--
--   -- hide everything by one player
--   update public.runs set hidden = true
--    where player_id = (select id from public.profiles where lower(username) = lower('<name>'));
--
--   -- delete outright
--   delete from public.runs where id = '<run id>';
--
--   -- wipe every run on one seed
--   delete from public.runs where seed = '<SEED>';


-- Success looks like: no errors, "profiles" and "runs" in the Table Editor, and
-- claim_session and heartbeat under Database -> Functions.
