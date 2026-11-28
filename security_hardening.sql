-- Capycoins server-side security migration
-- Run once in the Supabase SQL editor before deploying the matching account.js.
-- Safe to re-run: it replaces the sync function and keeps existing profile data.
--
-- The browser is intentionally treated as untrusted. Signed-in balances can only
-- increase through secure_sync_progress(), which validates game names, applies
-- per-game token buckets, enforces a daily ceiling and deduplicates retries.

begin;

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  total_cents bigint not null default 0,
  clicks bigint not null default 0,
  best_cps integer not null default 0,
  days jsonb not null default '{}'::jsonb,
  games jsonb not null default '{}'::jsonb,
  game_stats jsonb not null default '{}'::jsonb
);

alter table public.profiles add column if not exists clicks bigint not null default 0;
alter table public.profiles add column if not exists best_cps integer not null default 0;
alter table public.profiles add column if not exists days jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists games jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists game_stats jsonb not null default '{}'::jsonb;

create table if not exists public.capycoin_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  requested jsonb not null default '{}'::jsonb,
  awarded jsonb not null default '{}'::jsonb,
  rejected jsonb not null default '{}'::jsonb,
  awarded_cents bigint not null default 0,
  primary key (user_id, claim_id)
);

create index if not exists capycoin_claims_user_created_idx
  on public.capycoin_claims (user_id, created_at desc);

create table if not exists public.capycoin_rate_buckets (
  user_id uuid not null references auth.users(id) on delete cascade,
  game text not null,
  tokens numeric not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, game),
  constraint capycoin_rate_game check (game in ('clicker','catch','dash','stack','fisher','whack'))
);

create table if not exists public.capycoin_daily_spins (
  user_id uuid not null references auth.users(id) on delete cascade,
  spin_day date not null,
  claim_id uuid not null,
  prize_cents integer not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, spin_day)
);

alter table public.profiles enable row level security;
alter table public.capycoin_claims enable row level security;
alter table public.capycoin_rate_buckets enable row level security;
alter table public.capycoin_daily_spins enable row level security;

-- Replace every pre-existing profile policy. Leaving an older permissive UPDATE
-- policy in place would undo the column grants below because policies are ORed.
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', r.policyname);
  end loop;
end
$$;

create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy "profiles_insert_own_empty" on public.profiles
  for insert to authenticated
  with check (
    id = auth.uid() and total_cents = 0 and clicks = 0 and best_cps = 0
    and days = '{}'::jsonb and games = '{}'::jsonb and game_stats = '{}'::jsonb
  );

create policy "profiles_update_own_username" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- There is deliberately no table-wide UPDATE policy. The column grant below
-- permits username changes while balances and stats remain RPC-only.
revoke all on table public.profiles from anon, authenticated;
grant select, insert on table public.profiles to authenticated;
grant update (username) on table public.profiles to authenticated;

revoke all on table public.capycoin_claims from anon, authenticated;
revoke all on table public.capycoin_rate_buckets from anon, authenticated;
revoke all on table public.capycoin_daily_spins from anon, authenticated;

create or replace function public._capy_progress_snapshot(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'total_cents', coalesce(p.total_cents, 0),
    'clicks', coalesce(p.clicks, 0),
    'best_cps', coalesce(p.best_cps, 0),
    'days', coalesce(p.days, '{}'::jsonb),
    'games', coalesce(p.games, '{}'::jsonb),
    'game_stats', coalesce(p.game_stats, '{}'::jsonb)
  )
  from public.profiles p
  where p.id = p_uid
$$;

revoke all on function public._capy_progress_snapshot(uuid) from public, anon, authenticated;

-- Game stats are sent as deltas for counters and as absolute values for bests.
-- Merge them here so a delta never overwrites a cumulative counter.
create or replace function public._capy_merge_game_stats(p_old jsonb, p_delta jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_out jsonb := coalesce(p_old, '{}'::jsonb);
  v_delta jsonb := coalesce(p_delta, '{}'::jsonb);
  v_game text;
  v_old bigint;
  v_new bigint;
  v_inv jsonb;
  v_key text;
  v_val jsonb;
begin
  if jsonb_typeof(v_out) <> 'object' then v_out := '{}'::jsonb; end if;
  if jsonb_typeof(v_delta) <> 'object' then v_delta := '{}'::jsonb; end if;

  foreach v_game in array array['stack','dash','catch','whack','fisher','spin'] loop
    if jsonb_typeof(v_out -> v_game) <> 'object' then
      v_out := jsonb_set(v_out, array[v_game], '{}'::jsonb, true);
    end if;
  end loop;

  -- best scores are maxima
  foreach v_game in array array['stack','dash','catch'] loop
    v_old := coalesce((v_out -> v_game ->> 'best')::bigint, 0);
    v_new := case when (v_delta -> v_game ->> 'best') ~ '^[0-9]{1,12}$'
                  then (v_delta -> v_game ->> 'best')::bigint else 0 end;
    v_out := jsonb_set(v_out, array[v_game, 'best'], to_jsonb(greatest(v_old, v_new)), true);
  end loop;

  -- whack: rounds and whacks accumulate, best and streak are maxima
  v_old := coalesce((v_out -> 'whack' ->> 'rounds')::bigint, 0);
  v_new := case when (v_delta -> 'whack' ->> 'rounds') ~ '^[0-9]{1,12}$'
                then (v_delta -> 'whack' ->> 'rounds')::bigint else 0 end;
  v_out := jsonb_set(v_out, '{whack,rounds}', to_jsonb(v_old + v_new), true);

  v_old := coalesce((v_out -> 'whack' ->> 'whacks')::bigint, 0);
  v_new := case when (v_delta -> 'whack' ->> 'whacks') ~ '^[0-9]{1,12}$'
                then (v_delta -> 'whack' ->> 'whacks')::bigint else 0 end;
  v_out := jsonb_set(v_out, '{whack,whacks}', to_jsonb(v_old + v_new), true);

  v_old := coalesce((v_out -> 'whack' ->> 'best')::bigint, 0);
  v_new := case when (v_delta -> 'whack' ->> 'best') ~ '^[0-9]{1,12}$'
                then (v_delta -> 'whack' ->> 'best')::bigint else 0 end;
  v_out := jsonb_set(v_out, '{whack,best}', to_jsonb(greatest(v_old, v_new)), true);

  v_old := coalesce((v_out -> 'whack' ->> 'streak')::bigint, 0);
  v_new := case when (v_delta -> 'whack' ->> 'streak') ~ '^[0-9]{1,12}$'
                then (v_delta -> 'whack' ->> 'streak')::bigint else 0 end;
  v_out := jsonb_set(v_out, '{whack,streak}', to_jsonb(greatest(v_old, v_new)), true);

  -- fisher: caught accumulates; inventory is a signed delta per item
  v_old := coalesce((v_out -> 'fisher' ->> 'caught')::bigint, 0);
  v_new := case when (v_delta -> 'fisher' ->> 'caught') ~ '^[0-9]{1,12}$'
                then (v_delta -> 'fisher' ->> 'caught')::bigint else 0 end;
  v_out := jsonb_set(v_out, '{fisher,caught}', to_jsonb(v_old + v_new), true);

  if jsonb_typeof(v_out -> 'fisher' -> 'inv') <> 'object' then
    v_out := jsonb_set(v_out, '{fisher,inv}', '{}'::jsonb, true);
  end if;
  v_inv := coalesce(v_out -> 'fisher' -> 'inv', '{}'::jsonb);
  if jsonb_typeof(v_delta -> 'fisher' -> 'inv') = 'object' then
    for v_key, v_val in select key, value from jsonb_each(v_delta -> 'fisher' -> 'inv') loop
      if v_key ~ '^[A-Za-z0-9_]{1,32}$'
         and (v_val #>> '{}') ~ '^-?[0-9]{1,9}$' then
        v_old := coalesce((v_inv ->> v_key)::bigint, 0);
        v_new := greatest(0, v_old + (v_val #>> '{}')::bigint);
        if v_new = 0 then
          v_inv := v_inv - v_key;
        else
          v_inv := jsonb_set(v_inv, array[v_key], to_jsonb(v_new), true);
        end if;
      end if;
    end loop;
  end if;
  v_out := jsonb_set(v_out, '{fisher,inv}', v_inv, true);

  -- spin is an absolute value: the last spin and its prize
  if jsonb_typeof(v_delta -> 'spin') = 'object' then
    v_out := jsonb_set(v_out, '{spin}', v_delta -> 'spin', true);
  end if;

  return v_out;
end
$$;

revoke all on function public._capy_merge_game_stats(jsonb, jsonb) from public, anon, authenticated;

-- Drop every old overload before creating the current signature, otherwise
-- PostgREST cannot tell which function a call without p_tz_offset means.
do $$
declare r record;
begin
  for r in
    select pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'secure_sync_progress'
  loop
    execute format('drop function public.secure_sync_progress(%s)', r.args);
  end loop;
end
$$;

create or replace function public.secure_sync_progress(
  p_claim_id uuid,
  p_games jsonb default '{}'::jsonb,
  p_clicks bigint default 0,
  p_best integer default 0,
  p_stats jsonb default '{}'::jsonb,
  p_tz_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_game text;
  v_value jsonb;
  v_requested bigint;
  v_award bigint;
  v_total_award bigint := 0;
  v_click_award bigint := 0;
  v_rate numeric;
  v_burst numeric;
  v_tokens numeric;
  v_updated timestamptz;
  v_available numeric;
  v_daily_used bigint;
  v_daily_remaining bigint;
  v_awarded jsonb := '{}'::jsonb;
  v_rejected jsonb := '{}'::jsonb;
  v_existing jsonb;
  v_rows integer;
  -- The chart is local to the player, so bucket earnings by their local date
  -- rather than UTC. The offset is clamped and only affects the chart.
  v_day text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_claim_id is null then
    raise exception 'claim id is required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_games, '{}'::jsonb)) <> 'object' then
    raise exception 'games must be an object' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_stats, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_stats, '{}'::jsonb)::text) > 16384 then
    raise exception 'invalid stats payload' using errcode = '22023';
  end if;
  if octet_length(coalesce(p_games, '{}'::jsonb)::text) > 2048 then
    raise exception 'games payload is too large' using errcode = '22023';
  end if;

  v_day := ((v_now - make_interval(mins => least(greatest(coalesce(p_tz_offset, 0), -840), 840)))
            at time zone 'UTC')::date::text;

  -- Serialize all awards for one account so parallel tabs cannot race a bucket.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  insert into public.profiles (id) values (v_uid)
  on conflict (id) do nothing;

  if exists (
    select 1 from public.capycoin_claims
    where user_id = v_uid and claim_id = p_claim_id
  ) then
    return public._capy_progress_snapshot(v_uid);
  end if;

  select coalesce(sum(awarded_cents), 0)
    into v_daily_used
  from public.capycoin_claims
  where user_id = v_uid and created_at >= date_trunc('day', v_now);
  -- 500 capycoins/day is intentionally generous for normal play but bounds abuse.
  v_daily_remaining := greatest(0, 50000 - v_daily_used);

  for v_game, v_value in
    select key, value from jsonb_each(coalesce(p_games, '{}'::jsonb))
  loop
    if v_game not in ('clicker','catch','dash','stack','fisher','whack','spin')
       or jsonb_typeof(v_value) <> 'number'
       or (v_value #>> '{}') !~ '^[0-9]{1,7}$' then
      v_rejected := jsonb_set(v_rejected, array[v_game], v_value, true);
      continue;
    end if;

    v_requested := (v_value #>> '{}')::bigint;
    if v_requested <= 0 then continue; end if;
    v_requested := least(v_requested, 1000000);
    v_award := 0;

    if v_game = 'spin' then
      -- A spin is limited to one allowed prize per UTC day. The long-term fix
      -- can move prize generation into this RPC; this still removes replaying.
      if v_requested in (300,400,500,600,800,1000,1200,1500)
         and v_daily_remaining > 0 then
        insert into public.capycoin_daily_spins (user_id, spin_day, claim_id, prize_cents)
        values (v_uid, (v_now at time zone 'UTC')::date, p_claim_id, v_requested::integer)
        on conflict (user_id, spin_day) do nothing;
        get diagnostics v_rows = row_count;
        if v_rows = 1 then v_award := least(v_requested, v_daily_remaining); end if;
      end if;
    else
      -- cents/minute, with a one-minute burst. These values are deliberately
      -- above normal play and can be tuned after reviewing capycoin_claims.
      case v_game
        when 'clicker' then v_rate := 3000; v_burst := 3000;
        when 'catch'   then v_rate := 6000; v_burst := 6000;
        when 'dash'    then v_rate := 2400; v_burst := 2400;
        when 'stack'   then v_rate := 5000; v_burst := 5000;
        when 'fisher'  then v_rate := 4000; v_burst := 4000;
        when 'whack'   then v_rate := 10000; v_burst := 10000;
      end case;

      select tokens, updated_at into v_tokens, v_updated
      from public.capycoin_rate_buckets
      where user_id = v_uid and game = v_game
      for update;

      if not found then
        v_tokens := v_burst;
        v_updated := v_now;
        insert into public.capycoin_rate_buckets (user_id, game, tokens, updated_at)
        values (v_uid, v_game, v_tokens, v_now);
      end if;

      v_available := least(
        v_burst,
        v_tokens + v_rate * greatest(0, extract(epoch from (v_now - v_updated))) / 60
      );

      -- Clicker awards must correspond exactly to five-cent clicks.
      if v_game = 'clicker' and v_requested % 5 <> 0 then
        v_award := 0;
      else
        v_award := least(v_requested, floor(v_available)::bigint, v_daily_remaining);
      end if;

      update public.capycoin_rate_buckets
      set tokens = greatest(0, v_available - v_award), updated_at = v_now
      where user_id = v_uid and game = v_game;
    end if;

    if v_award < v_requested then
      v_rejected := jsonb_set(v_rejected, array[v_game], to_jsonb(v_requested - v_award), true);
    end if;
    if v_award > 0 then
      v_awarded := jsonb_set(v_awarded, array[v_game], to_jsonb(v_award), true);
      v_total_award := v_total_award + v_award;
      v_daily_remaining := greatest(0, v_daily_remaining - v_award);
      if v_game = 'clicker' then v_click_award := v_click_award + v_award / 5; end if;

      select games -> v_game into v_existing from public.profiles where id = v_uid;
      update public.profiles
      set games = jsonb_set(
            coalesce(games, '{}'::jsonb), array[v_game],
            to_jsonb(coalesce((v_existing #>> '{}')::bigint, 0) + v_award), true
          )
      where id = v_uid;
    end if;
  end loop;

  update public.profiles
  set total_cents = total_cents + v_total_award,
      clicks = clicks + v_click_award,
      best_cps = greatest(best_cps, least(greatest(coalesce(p_best, 0), 0), 25)),
      days = case when v_total_award > 0 then jsonb_set(
        coalesce(days, '{}'::jsonb),
        array[v_day],
        to_jsonb(coalesce((days ->> v_day)::bigint, 0) + v_total_award),
        true
      ) else days end,
      game_stats = public._capy_merge_game_stats(game_stats, p_stats)
  where id = v_uid;

  insert into public.capycoin_claims
    (user_id, claim_id, requested, awarded, rejected, awarded_cents)
  values
    (v_uid, p_claim_id, coalesce(p_games, '{}'::jsonb), v_awarded, v_rejected, v_total_award);

  return public._capy_progress_snapshot(v_uid);
end
$$;

revoke all on function public.secure_sync_progress(uuid, jsonb, bigint, integer, jsonb, integer) from public, anon;
grant execute on function public.secure_sync_progress(uuid, jsonb, bigint, integer, jsonb, integer) to authenticated;

-- Disable the old arbitrary-increment entry points. Dynamic SQL handles any
-- argument types used by earlier versions of the project.
do $$
declare r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('add_cents', 'sync_progress')
  loop
    execute format(
      'revoke all on function %I.%I(%s) from public, anon, authenticated',
      r.nspname, r.proname, r.args
    );
  end loop;
end
$$;

-- Make PostgREST pick up the new function signature immediately.
notify pgrst, 'reload schema';

commit;
