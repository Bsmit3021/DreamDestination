-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 4 security checks
--
-- Covers the career/housing reference tables and the user-owned career target.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/opportunity_rls.sql
--
-- Runs in a transaction and rolls back. Fixtures are namespaced `p4-` so they
-- cannot collide with the seeded 100-metro dataset.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

insert into auth.users (id, email) values
  ('a4a4a4a4-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'p4-a@example.com'),
  ('b4b4b4b4-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'p4-b@example.com');

insert into public.profiles (
  id, user_id, age_range, household_income, occupation, relationship_status,
  children, household_size, current_city, current_state, housing_budget,
  work_preference
) values
  ('44444444-1111-4111-8111-11111111111a', 'a4a4a4a4-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '25-34', 100000, 'A occupation', 'single', 0, 1, 'Brooklyn', 'NY', 3000, 'remote'),
  ('44444444-1111-4111-8111-11111111111b', 'b4b4b4b4-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   '35-44', 90000, 'B occupation', 'married', 1, 3, 'Denver', 'CO', 2500, 'hybrid');

-- B has a career target; A must never see or change it.
insert into public.profile_career_targets
  (profile_id, source_text, soc_code, match_method, match_confidence, confirmed_by_user)
values
  ('44444444-1111-4111-8111-11111111111b', 'B job title', '15-1252', 'exact', 1.0, true);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a4a4a4a4-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

-- --------------------------------------------------------------------------
-- Reference data: readable, never writable
-- --------------------------------------------------------------------------

do $$
declare n int;
begin
  select count(*) into n from public.occupations;
  if n > 0 then raise notice 'PASS  A can read occupations';
  else raise exception 'FAIL: A sees % occupations', n; end if;

  select count(*) into n from public.metro_occupation_stats;
  if n > 0 then raise notice 'PASS  A can read metro occupation stats';
  else raise exception 'FAIL: A sees % career rows', n; end if;

  select count(*) into n from public.housing_market_stats;
  if n > 0 then raise notice 'PASS  A can read housing market stats';
  else raise exception 'FAIL: A sees % housing rows', n; end if;
end $$;

do $$
begin
  begin
    update public.metro_occupation_stats set median_annual_wage = 999999;
    raise exception 'FAIL: A invented a wage';
  exception when insufficient_privilege then
    raise notice 'PASS  A cannot modify wage data';
  end;
end $$;

do $$
begin
  begin
    update public.housing_market_stats set median_gross_rent = 1;
    raise exception 'FAIL: A changed rent data';
  exception when insufficient_privilege then
    raise notice 'PASS  A cannot modify housing data';
  end;
end $$;

do $$
begin
  begin
    update public.occupations set title = 'Hacked';
    raise exception 'FAIL: A modified the occupation table';
  exception when insufficient_privilege then
    raise notice 'PASS  A cannot modify occupations';
  end;
end $$;

do $$
begin
  begin
    insert into public.occupation_titles (soc_code, title, normalized_title, title_kind)
    values ('15-1252', 'Fake Title', 'fake title', 'reported');
    raise exception 'FAIL: A inserted an occupation title';
  exception when insufficient_privilege then
    raise notice 'PASS  A cannot insert occupation titles';
  end;
end $$;

do $$
begin
  begin
    update public.metric_sources set organization = 'Hacked';
    raise exception 'FAIL: A modified source metadata';
  exception when insufficient_privilege then
    raise notice 'PASS  A cannot modify source metadata';
  end;
end $$;

-- --------------------------------------------------------------------------
-- Career target ownership
-- --------------------------------------------------------------------------

do $$
declare n int;
begin
  select count(*) into n from public.profile_career_targets;
  if n = 0 then raise notice 'PASS  A cannot read B''s career target';
  else raise exception 'FAIL: A sees % career targets', n; end if;
end $$;

do $$
declare n int;
begin
  update public.profile_career_targets set soc_code = '00-0000'
    where profile_id = '44444444-1111-4111-8111-11111111111b';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  A cannot modify B''s career target';
  else raise exception 'FAIL: A updated % of B''s career target rows', n; end if;
end $$;

do $$
declare n int;
begin
  delete from public.profile_career_targets
    where profile_id = '44444444-1111-4111-8111-11111111111b';
  get diagnostics n = row_count;
  if n = 0 then raise notice 'PASS  A cannot delete B''s career target';
  else raise exception 'FAIL: A deleted % of B''s rows', n; end if;
end $$;

do $$
begin
  begin
    insert into public.profile_career_targets
      (profile_id, source_text, soc_code, match_method, match_confidence)
    values ('44444444-1111-4111-8111-11111111111b', 'spoofed', '15-1252', 'exact', 1.0);
    raise exception 'FAIL: A fabricated a career target owned by B';
  exception when insufficient_privilege or unique_violation then
    raise notice 'PASS  A cannot fabricate career-target ownership';
  end;
end $$;

do $$
declare n int;
begin
  insert into public.profile_career_targets
    (profile_id, source_text, soc_code, match_method, match_confidence, confirmed_by_user)
  values ('44444444-1111-4111-8111-11111111111a', 'A job title', '29-1141', 'exact', 1.0, true);
  select count(*) into n from public.profile_career_targets;
  if n = 1 then raise notice 'PASS  A can create their own career target';
  else raise exception 'FAIL: A sees % targets after insert', n; end if;
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
  select count(*) into n from public.metro_occupation_stats;
  if n > 0 then raise notice 'PASS  anon can read career reference data';
  else raise exception 'FAIL: anon sees % career rows', n; end if;
end $$;

do $$
begin
  begin
    perform count(*) from public.profile_career_targets;
    raise exception 'FAIL: anon queried career targets';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot read career targets';
  end;
end $$;

do $$
begin
  begin
    update public.metro_occupation_stats set employment = 0;
    raise exception 'FAIL: anon modified wage data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot mutate career data';
  end;
end $$;

do $$
begin
  begin
    update public.housing_market_stats set median_gross_rent = 1;
    raise exception 'FAIL: anon modified housing data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot mutate housing data';
  end;
end $$;

do $$
begin
  begin
    update public.occupations set title = 'Hacked';
    raise exception 'FAIL: anon modified occupations';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot mutate occupations';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- Phase 6B reference data follows exactly the same read model: public to read,
-- writable by nobody through the API. A user able to write crime rates or
-- school counts could manufacture their own recommendations.
-- ---------------------------------------------------------------------------

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.metro_safety_stats;
  raise notice 'PASS  anon can read metro safety stats (% rows)', v_count;
end $$;

do $$
declare v_count integer;
begin
  select count(*) into v_count from public.metro_school_stats;
  raise notice 'PASS  anon can read metro school stats (% rows)', v_count;
end $$;

do $$
begin
  begin
    update public.metro_safety_stats set violent_crime_rate = 0;
    raise exception 'FAIL: anon modified safety data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot mutate safety data';
  end;
end $$;

do $$
begin
  begin
    insert into public.metro_safety_stats
      (city_id, fbi_metro_name, data_year, source_id)
    values ('22222222-2222-4222-8222-222222222222', 'Fake M. S. A.', 2025,
            '33333333-3333-4333-8333-333333333333');
    raise exception 'FAIL: anon inserted safety data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot insert safety data';
  end;
end $$;

do $$
begin
  begin
    update public.metro_school_stats set public_school_count = 99999;
    raise exception 'FAIL: anon modified school data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot mutate school data';
  end;
end $$;

do $$
begin
  begin
    delete from public.metro_school_stats;
    raise exception 'FAIL: anon deleted school data';
  exception when insufficient_privilege then
    raise notice 'PASS  anon cannot delete school data';
  end;
end $$;

reset role;
rollback;
