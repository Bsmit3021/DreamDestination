-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 3 security checks
--
-- Covers the tables Phase 3 added plus the recommendation-writing path, which
-- is the one place the application uses an elevated client.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/recommendations_rls.sql
--
-- Runs in a transaction and rolls back.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p3-a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'p3-b@example.com');

insert into public.profiles (
  id, user_id, age_range, household_income, occupation, relationship_status,
  children, household_size, current_city, current_state, housing_budget,
  work_preference
) values
  ('11111111-1111-4111-8111-11111111111a',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '25-34', 100000, 'A', 'single',
   0, 1, 'Brooklyn', 'NY', 3000, 'remote'),
  ('11111111-1111-4111-8111-11111111111b',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '35-44', 90000, 'B', 'married',
   1, 3, 'Denver', 'CO', 2500, 'hybrid');

insert into public.cities (id, slug, city, state, latitude, longitude)
values ('22222222-2222-4222-8222-222222222222', 'p3-testville-tx', 'Testville',
        'TX', 31.0, -97.0);

insert into public.metric_sources (
  id, key, organization, dataset, url, period, retrieved_on, geography_level
) values (
  '33333333-3333-4333-8333-333333333333', 'p3-test-source', 'Test Org',
  'Test Dataset', 'https://example.test', '2020-2024', current_date, 'cbsa'
);

insert into public.city_metric_observations (
  city_id, metric_key, dimension, raw_value, unit, source_id
) values (
  '22222222-2222-4222-8222-222222222222', 'median_gross_rent', 'housing',
  1200, 'usd_per_month', '33333333-3333-4333-8333-333333333333'
);

-- Recommendations for B only, so A must not be able to see them.
insert into public.recommendations (
  profile_id, city_id, dream_score, "rank", reason_json, algorithm_version
) values (
  '11111111-1111-4111-8111-11111111111b',
  '22222222-2222-4222-8222-222222222222', 0.9, 1, '{}'::jsonb, 'v1'
);

-- --------------------------------------------------------------------------
-- Authenticated user A
-- --------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

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

do $$
begin
  begin
    insert into public.recommendations (profile_id, city_id, dream_score, "rank")
    values ('11111111-1111-4111-8111-11111111111a',
            '22222222-2222-4222-8222-222222222222', 1.0, 1);
    raise exception 'FAIL: A fabricated a recommendation for themselves';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot write their own recommendations';
  end;
end $$;

do $$
begin
  begin
    insert into public.recommendations (profile_id, city_id, dream_score, "rank")
    values ('11111111-1111-4111-8111-11111111111b',
            '22222222-2222-4222-8222-222222222222', 0.1, 2);
    raise exception 'FAIL: A wrote a recommendation onto B''s profile';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot write recommendations onto B''s profile';
  end;
end $$;

do $$
declare n int;
begin
  update public.recommendations set dream_score = 0.01
    where profile_id = '11111111-1111-4111-8111-11111111111b';
  get diagnostics n = row_count;
  raise exception 'FAIL: A updated % of B''s recommendation rows', n;
exception
  when insufficient_privilege then
    raise notice 'PASS  A cannot overwrite B''s recommendations';
end $$;

-- New Phase 3 reference tables: readable, not writable.

do $$
declare n int;
begin
  select count(*) into n from public.city_metric_observations;
  if n >= 1 then
    raise notice 'PASS  A can read city metric observations';
  else
    raise exception 'FAIL: A sees % observations', n;
  end if;

  select count(*) into n from public.metric_sources;
  if n >= 1 then
    raise notice 'PASS  A can read metric sources';
  else
    raise exception 'FAIL: A sees % sources', n;
  end if;
end $$;

do $$
begin
  begin
    update public.city_metric_observations set raw_value = 1;
    raise exception 'FAIL: A modified city metric observations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot modify city metric observations';
  end;
end $$;

do $$
begin
  begin
    update public.metric_sources set organization = 'Hacked';
    raise exception 'FAIL: A modified metric sources';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot modify metric sources';
  end;
end $$;

-- The regeneration function must not be callable by an ordinary user.
do $$
begin
  begin
    perform public.replace_recommendations(
      '11111111-1111-4111-8111-11111111111b', 'v1', '[]'::jsonb
    );
    raise exception 'FAIL: A executed replace_recommendations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot execute replace_recommendations';
  end;
end $$;

-- --------------------------------------------------------------------------
-- Anonymous visitor
-- --------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
declare n int;
begin
  select count(*) into n from public.city_metric_observations;
  if n >= 1 then
    raise notice 'PASS  anon can read city metric observations';
  else
    raise exception 'FAIL: anon sees % observations', n;
  end if;
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

do $$
begin
  begin
    perform public.replace_recommendations(
      '11111111-1111-4111-8111-11111111111b', 'v1', '[]'::jsonb
    );
    raise exception 'FAIL: anon executed replace_recommendations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot execute replace_recommendations';
  end;
end $$;

reset role;
rollback;
