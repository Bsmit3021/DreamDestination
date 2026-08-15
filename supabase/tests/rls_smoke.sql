-- ---------------------------------------------------------------------------
-- DreamDestination — Row Level Security smoke test
--
-- Verifies the ownership model with real role impersonation: two users, one
-- anonymous visitor, and the exact operations the app performs.
--
-- Run against any database that has the migration applied and Supabase's auth
-- schema present:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_smoke.sql
--
-- Against a hosted Supabase project, use the connection string from
-- Project Settings -> Database (the direct connection, not the pooler).
--
-- Everything runs inside a transaction that is rolled back, so it leaves no
-- data behind. It raises an exception on the first failure.
--
-- Two distinct denial mechanisms are asserted, and they are not
-- interchangeable:
--   * missing GRANT  -> raises insufficient_privilege
--   * RLS USING      -> silently matches zero rows
-- A test that only looked for exceptions would miss the second entirely.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

-- --------------------------------------------------------------------------
-- Fixtures, created as the table owner before dropping into user roles.
-- --------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'user-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'user-b@example.com');

insert into public.profiles (
  id, user_id, age_range, household_income, occupation, relationship_status,
  children, household_size, current_city, current_state, housing_budget,
  work_preference
) values (
  '11111111-1111-4111-8111-111111111111',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '35-44', 90000, 'B occupation', 'married', 1, 3, 'Denver', 'CO', 2500,
  'hybrid'
);

insert into public.preferences (profile_id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.cities (id, slug, city, state, latitude, longitude)
values ('22222222-2222-4222-8222-222222222222', 'austin-tx', 'Austin', 'TX',
        30.267153, -97.743057);

insert into public.city_metrics (city_id, median_rent)
values ('22222222-2222-4222-8222-222222222222', 1850);

insert into public.recommendations (profile_id, city_id, dream_score, "rank")
values ('11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222', 0.88, 1);

-- --------------------------------------------------------------------------
-- USER A
-- --------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

-- A can create their own profile.
do $$
begin
  insert into public.profiles (
    id, user_id, age_range, household_income, occupation, relationship_status,
    children, household_size, current_city, current_state, housing_budget,
    work_preference
  ) values (
    '33333333-3333-4333-8333-333333333333',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '25-34', 120000, 'A occupation', 'single', 0, 1, 'Brooklyn', 'NY', 3200,
    'remote'
  );
  raise notice 'PASS  A can insert their own profile';
end $$;

-- A cannot create a profile owned by B (RLS WITH CHECK).
do $$
begin
  begin
    insert into public.profiles (
      user_id, age_range, household_income, occupation, relationship_status,
      children, household_size, current_city, current_state, housing_budget,
      work_preference
    ) values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '25-34', 1, 'spoofed', 'single', 0, 1, 'Queens', 'NY', 1, 'remote'
    );
    raise exception 'FAIL: A inserted a profile owned by B';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot insert a profile owned by B';
  end;
end $$;

-- A sees exactly their own profile.
do $$
declare n int; own int;
begin
  select count(*) into n from public.profiles;
  select count(*) into own from public.profiles
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  if n = 1 and own = 1 then
    raise notice 'PASS  A selects only their own profile (B is invisible)';
  else
    raise exception 'FAIL: A sees % profiles (own=%)', n, own;
  end if;
end $$;

-- A can update their own profile.
do $$
declare n int;
begin
  update public.profiles set occupation = 'A updated'
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  if n = 1 then
    raise notice 'PASS  A can update their own profile';
  else
    raise exception 'FAIL: A updated % of their own rows', n;
  end if;
end $$;

-- A cannot update B's profile. RLS filters the row out, so this affects zero
-- rows rather than raising.
do $$
declare n int;
begin
  update public.profiles set occupation = 'hacked'
    where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot update B''s profile (0 rows matched)';
  else
    raise exception 'FAIL: A updated % of B''s rows', n;
  end if;
end $$;

-- A cannot delete B's profile.
do $$
declare n int;
begin
  delete from public.profiles
    where id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot delete B''s profile';
  else
    raise exception 'FAIL: A deleted % of B''s rows', n;
  end if;
end $$;

-- The app never plain-INSERTs a profile: it upserts on the user_id conflict
-- target. That path needs the INSERT and UPDATE policies to cooperate, so
-- exercise the real query shape and confirm it still yields exactly one row.
do $$
declare n int;
begin
  insert into public.profiles (
    user_id, age_range, household_income, occupation, relationship_status,
    children, household_size, current_city, current_state, housing_budget,
    work_preference
  ) values (
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    '25-34', 125000, 'A upserted', 'single', 0, 1, 'Brooklyn', 'NY', 3300,
    'remote'
  )
  on conflict (user_id) do update set
    occupation = excluded.occupation,
    household_income = excluded.household_income;

  select count(*) into n from public.profiles
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  if n = 1 then
    raise notice 'PASS  A upsert updates in place (still exactly 1 profile)';
  else
    raise exception 'FAIL: upsert produced % profiles for A', n;
  end if;
end $$;

-- The same upsert must not let A overwrite B's row by aiming at B's user_id.
do $$
begin
  begin
    insert into public.profiles (
      user_id, age_range, household_income, occupation, relationship_status,
      children, household_size, current_city, current_state, housing_budget,
      work_preference
    ) values (
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      '25-34', 1, 'stolen', 'single', 0, 1, 'Queens', 'NY', 1, 'remote'
    )
    on conflict (user_id) do update set occupation = excluded.occupation;
    raise exception 'FAIL: A upserted over B''s profile';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot upsert over B''s profile';
  end;
end $$;

-- A can upsert their own preferences.
do $$
begin
  insert into public.preferences (profile_id, career_weight)
  values ('33333333-3333-4333-8333-333333333333', 0.9)
  on conflict (profile_id) do update set career_weight = excluded.career_weight;
  raise notice 'PASS  A can upsert their own preferences';
end $$;

-- A reads only their own preferences.
do $$
declare n int;
begin
  select count(*) into n from public.preferences;
  if n = 1 then
    raise notice 'PASS  A reads only their own preferences';
  else
    raise exception 'FAIL: A sees % preference rows', n;
  end if;
end $$;

-- A cannot attach preferences to B's profile.
do $$
begin
  begin
    insert into public.preferences (profile_id)
    values ('11111111-1111-4111-8111-111111111111');
    raise exception 'FAIL: A wrote preferences onto B''s profile';
  exception
    when insufficient_privilege or unique_violation then
      raise notice 'PASS  A cannot write preferences onto B''s profile';
  end;
end $$;

-- A cannot update B's preferences.
do $$
declare n int;
begin
  update public.preferences set career_weight = 1
    where profile_id = '11111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot update B''s preferences';
  else
    raise exception 'FAIL: A updated % of B''s preference rows', n;
  end if;
end $$;

-- Recommendations are read-only for users: no INSERT grant or policy exists.
do $$
begin
  begin
    insert into public.recommendations (profile_id, city_id, dream_score, "rank")
    values ('33333333-3333-4333-8333-333333333333',
            '22222222-2222-4222-8222-222222222222', 1.0, 1);
    raise exception 'FAIL: A fabricated a recommendation';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot write recommendations';
  end;
end $$;

-- A cannot read B's recommendations.
do $$
declare n int;
begin
  select count(*) into n from public.recommendations;
  if n = 0 then
    raise notice 'PASS  A cannot read B''s recommendations';
  else
    raise exception 'FAIL: A sees % of B''s recommendations', n;
  end if;
end $$;

-- Reference data is readable but not writable.
do $$
declare n int;
begin
  select count(*) into n from public.cities;
  if n = 1 then
    raise notice 'PASS  A can read city reference data';
  else
    raise exception 'FAIL: A sees % cities', n;
  end if;
end $$;

do $$
begin
  begin
    update public.cities set city = 'Hacked';
    raise exception 'FAIL: A modified cities';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot modify cities';
  end;
end $$;

do $$
begin
  begin
    update public.city_metrics set median_rent = 1;
    raise exception 'FAIL: A modified city_metrics';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot modify city_metrics';
  end;
end $$;

-- --------------------------------------------------------------------------
-- USER B — isolation is mutual, not one-directional.
-- --------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';

do $$
declare n int; own int; recs int;
begin
  select count(*) into n from public.profiles;
  select count(*) into own from public.profiles
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select count(*) into recs from public.recommendations;

  if n = 1 and own = 1 then
    raise notice 'PASS  B selects only their own profile (A is invisible)';
  else
    raise exception 'FAIL: B sees % profiles (own=%)', n, own;
  end if;

  if recs = 1 then
    raise notice 'PASS  B can read their own recommendations';
  else
    raise exception 'FAIL: B sees % recommendations', recs;
  end if;
end $$;

do $$
declare n int;
begin
  update public.profiles set occupation = 'hacked'
    where id = '33333333-3333-4333-8333-333333333333';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  B cannot update A''s profile';
  else
    raise exception 'FAIL: B updated % of A''s rows', n;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- ANONYMOUS VISITOR
-- --------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare n int;
begin
  select count(*) into n from public.cities;
  if n = 1 then
    raise notice 'PASS  anon can read cities';
  else
    raise exception 'FAIL: anon sees % cities', n;
  end if;

  select count(*) into n from public.city_metrics;
  if n = 1 then
    raise notice 'PASS  anon can read city_metrics';
  else
    raise exception 'FAIL: anon sees % city_metrics rows', n;
  end if;
end $$;

do $$
begin
  begin
    perform count(*) from public.profiles;
    raise exception 'FAIL: anon queried profiles';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot read profiles';
  end;
end $$;

do $$
begin
  begin
    perform count(*) from public.preferences;
    raise exception 'FAIL: anon queried preferences';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot read preferences';
  end;
end $$;

do $$
begin
  begin
    perform count(*) from public.recommendations;
    raise exception 'FAIL: anon queried recommendations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot read recommendations';
  end;
end $$;

reset role;
rollback;
