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

-- --------------------------------------------------------------------------
-- replace_my_recommendations: direct RPC abuse attempts as User A
--
-- The function takes no profile id, so "target another user" is not something
-- the caller can even express. These prove the surrounding guarantees.
-- --------------------------------------------------------------------------

-- A can replace their OWN recommendations through the function.
do $$
declare n int; owned int;
begin
  n := public.replace_my_recommendations('v1', jsonb_build_array(
    jsonb_build_object(
      'city_id', '22222222-2222-4222-8222-222222222222',
      'dream_score', 0.75, 'rank', 1, 'reason_json', '{}'::jsonb
    )
  ));
  select count(*) into owned from public.recommendations;
  if n = 1 and owned = 1 then
    raise notice 'PASS  A can replace their own recommendations via RPC';
  else
    raise exception 'FAIL: inserted=% visible=%', n, owned;
  end if;
end $$;

-- Doing so must not have touched B's rows.
do $$
declare total int;
begin
  -- Counted as the table owner, since RLS hides B's rows from A.
  set local role postgres;
  select count(*) into total from public.recommendations
    where profile_id = '11111111-1111-4111-8111-11111111111b';
  set local role authenticated;
  if total = 1 then
    raise notice 'PASS  A''s RPC call left B''s recommendations untouched';
  else
    raise exception 'FAIL: B now has % recommendation rows', total;
  end if;
end $$;

-- Rerunning replaces rather than duplicating.
do $$
declare owned int;
begin
  perform public.replace_my_recommendations('v1', jsonb_build_array(
    jsonb_build_object('city_id', '22222222-2222-4222-8222-222222222222',
                       'dream_score', 0.5, 'rank', 1, 'reason_json', '{}'::jsonb)
  ));
  select count(*) into owned from public.recommendations;
  if owned = 1 then
    raise notice 'PASS  RPC rerun replaces instead of duplicating';
  else
    raise exception 'FAIL: rerun left % rows', owned;
  end if;
end $$;

-- Malformed payloads must fail loudly, not write partial data.
do $$
begin
  begin
    perform public.replace_my_recommendations('v1', '{"not":"an array"}'::jsonb);
    raise exception 'FAIL: RPC accepted a non-array payload';
  exception
    when sqlstate '22023' then
      raise notice 'PASS  RPC rejects a non-array payload';
  end;
end $$;

do $$
begin
  begin
    perform public.replace_my_recommendations('v1', jsonb_build_array(
      jsonb_build_object('city_id', '99999999-9999-4999-8999-999999999999',
                         'dream_score', 0.5, 'rank', 1)
    ));
    raise exception 'FAIL: RPC accepted a non-existent city';
  exception
    when foreign_key_violation then
      raise notice 'PASS  RPC rejects an unknown city id';
  end;
end $$;

do $$
begin
  begin
    perform public.replace_my_recommendations('v1', jsonb_build_array(
      jsonb_build_object('city_id', '22222222-2222-4222-8222-222222222222',
                         'dream_score', 0.5, 'rank', 1),
      jsonb_build_object('city_id', '22222222-2222-4222-8222-222222222222',
                         'dream_score', 0.4, 'rank', 1)
    ));
    raise exception 'FAIL: RPC accepted duplicate ranks';
  exception
    when unique_violation then
      raise notice 'PASS  RPC rejects duplicate ranks';
  end;
end $$;

do $$
begin
  begin
    perform public.replace_my_recommendations('not-a-version', jsonb_build_array(
      jsonb_build_object('city_id', '22222222-2222-4222-8222-222222222222',
                         'dream_score', 0.5, 'rank', 1)
    ));
    raise exception 'FAIL: RPC accepted an invalid algorithm version';
  exception
    when check_violation then
      raise notice 'PASS  RPC rejects an invalid algorithm version';
  end;
end $$;

do $$
begin
  begin
    perform public.replace_my_recommendations('v1', jsonb_build_array(
      jsonb_build_object('city_id', '22222222-2222-4222-8222-222222222222',
                         'dream_score', 9.9, 'rank', 1)
    ));
    raise exception 'FAIL: RPC accepted an out-of-range score';
  exception
    when check_violation then
      raise notice 'PASS  RPC rejects an out-of-range dream_score';
  end;
end $$;

-- Extra fields in the payload are ignored, not smuggled into the row.
do $$
declare owner_ok boolean;
begin
  perform public.replace_my_recommendations('v1', jsonb_build_array(
    jsonb_build_object(
      'city_id', '22222222-2222-4222-8222-222222222222',
      'dream_score', 0.6, 'rank', 1,
      'profile_id', '11111111-1111-4111-8111-11111111111b',
      'user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    )
  ));
  select bool_and(profile_id = '11111111-1111-4111-8111-11111111111a')
    into owner_ok from public.recommendations;
  if owner_ok then
    raise notice 'PASS  RPC ignores injected profile_id/user_id fields';
  else
    raise exception 'FAIL: injected ownership field took effect';
  end if;
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
    perform public.replace_my_recommendations('v1', '[]'::jsonb);
    raise exception 'FAIL: anon executed replace_my_recommendations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot execute replace_my_recommendations';
  end;
end $$;

reset role;
rollback;
