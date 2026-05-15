-- Pingis-stege schema
-- Kör hela filen i Supabase SQL Editor (Database → SQL → New query).
-- Idempotent: går att köra om utan att förstöra data.

-- =====================================================================
-- Tabeller
-- =====================================================================

create table if not exists players (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  rating      int  not null default 1000,
  wins        int  not null default 0,
  losses      int  not null default 0,
  slack_id    text unique,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- Idempotenta tillägg ifall tabellen redan finns från en tidigare version
alter table players add column if not exists slack_id   text;
alter table players add column if not exists avatar_url text;
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'players_slack_id_key'
  ) then
    alter table players add constraint players_slack_id_key unique (slack_id);
  end if;
end $$;

create table if not exists matches (
  id                    uuid primary key default gen_random_uuid(),
  winner_id             uuid not null references players(id) on delete restrict,
  loser_id              uuid not null references players(id) on delete restrict,
  winner_rating_before  int  not null default 0,
  loser_rating_before   int  not null default 0,
  winner_rating_after   int  not null default 0,
  loser_rating_after    int  not null default 0,
  played_at             timestamptz not null default now(),
  constraint matches_different_players check (winner_id <> loser_id)
);

create index if not exists matches_played_at_idx on matches (played_at desc);

-- =====================================================================
-- Elo-trigger
-- Räknar ut nya ratings, uppdaterar spelarna, och fyller rating-fälten
-- på match-raden — allt atomiskt med radlås. Klienten gör bara:
--   insert into matches (winner_id, loser_id) values (...);
-- =====================================================================

create or replace function update_elo_after_match()
returns trigger
language plpgsql
security definer
as $$
declare
  k_factor      constant int := 32;
  expected_win  numeric;
  delta         int;
  winner_rec    record;
  loser_rec     record;
begin
  -- Lås båda spelarraderna för att undvika race conditions
  select rating into winner_rec from players where id = NEW.winner_id for update;
  select rating into loser_rec  from players where id = NEW.loser_id  for update;

  if winner_rec is null then
    raise exception 'Winner % does not exist', NEW.winner_id;
  end if;
  if loser_rec is null then
    raise exception 'Loser % does not exist', NEW.loser_id;
  end if;

  NEW.winner_rating_before := winner_rec.rating;
  NEW.loser_rating_before  := loser_rec.rating;

  expected_win := 1.0 / (1.0 + power(
    10,
    (loser_rec.rating - winner_rec.rating)::numeric / 400.0
  ));
  delta := round(k_factor * (1 - expected_win));

  NEW.winner_rating_after := winner_rec.rating + delta;
  NEW.loser_rating_after  := loser_rec.rating  - delta;

  update players
     set rating = NEW.winner_rating_after,
         wins   = wins + 1
   where id = NEW.winner_id;

  update players
     set rating = NEW.loser_rating_after,
         losses = losses + 1
   where id = NEW.loser_id;

  return NEW;
end;
$$;

drop trigger if exists trg_update_elo on matches;
create trigger trg_update_elo
  before insert on matches
  for each row execute function update_elo_after_match();

-- =====================================================================
-- undo_match: ångra senaste matchen
-- Säkerhetsregler:
--   * Bara den absolut senaste matchen kan ångras (annars blir
--     rating-historiken inkonsistent eftersom senare matcher byggde
--     vidare på resultatet).
--   * Matchen får inte vara äldre än 5 minuter — efter det räknas
--     resultatet som etablerat och måste fixas via Supabase Studio.
-- Återställer ratings till winner_rating_before/loser_rating_before
-- och dekrementerar wins/losses, sen raderas match-raden.
-- =====================================================================

create or replace function undo_match(p_match_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  m record;
  latest_id uuid;
  age_sec numeric;
begin
  select * into m from matches where id = p_match_id for update;
  if not found then
    raise exception 'Match % finns inte', p_match_id;
  end if;

  age_sec := extract(epoch from (now() - m.played_at));
  if age_sec > 300 then
    raise exception 'Matchen är för gammal för att ångras (%.0f sekunder gammal, max 300)', age_sec
      using errcode = 'P0001';
  end if;

  select id into latest_id from matches order by played_at desc limit 1;
  if latest_id is null or latest_id <> p_match_id then
    raise exception 'Bara den absolut senaste matchen kan ångras'
      using errcode = 'P0001';
  end if;

  update players
     set rating = m.winner_rating_before,
         wins   = greatest(wins - 1, 0)
   where id = m.winner_id;

  update players
     set rating = m.loser_rating_before,
         losses = greatest(losses - 1, 0)
   where id = m.loser_id;

  delete from matches where id = p_match_id;
end;
$$;

grant execute on function undo_match(uuid) to anon, authenticated;

-- =====================================================================
-- Row Level Security
-- Öppen rapportering: alla får läsa och skapa. Inga updates/deletes
-- från klienten — felrapporter fixas via Supabase Studio.
-- =====================================================================

alter table players enable row level security;
alter table matches enable row level security;

drop policy if exists "players_select_all" on players;
drop policy if exists "players_insert_all" on players;
drop policy if exists "matches_select_all" on matches;
drop policy if exists "matches_insert_all" on matches;

create policy "players_select_all" on players for select to anon, authenticated using (true);
create policy "players_insert_all" on players for insert to anon, authenticated with check (true);
create policy "matches_select_all" on matches for select to anon, authenticated using (true);
create policy "matches_insert_all" on matches for insert to anon, authenticated with check (true);

-- =====================================================================
-- Realtime: publicera tabellerna så klienten kan prenumerera
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'players'
  ) then
    alter publication supabase_realtime add table players;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and tablename = 'matches'
  ) then
    alter publication supabase_realtime add table matches;
  end if;
end $$;
