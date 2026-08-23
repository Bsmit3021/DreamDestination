-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 5 advisor security checks
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/advisor_rls.sql
--
-- Runs in a transaction and rolls back. Fixture ids are namespaced so they
-- cannot collide with seeded data.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
set client_min_messages = notice;

begin;

insert into auth.users (id, email) values
  ('a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', 'p5-a@example.com'),
  ('b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', 'p5-b@example.com');

insert into public.profiles (
  id, user_id, age_range, household_income, occupation, relationship_status,
  children, household_size, current_city, current_state, housing_budget,
  work_preference
) values
  ('55555555-5555-4555-8555-55555555555a',
   'a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5', '25-34', 100000, 'A', 'single',
   0, 1, 'Brooklyn', 'NY', 3000, 'remote'),
  ('55555555-5555-4555-8555-55555555555b',
   'b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5', '35-44', 90000, 'B', 'married',
   1, 3, 'Denver', 'CO', 2500, 'hybrid');

-- B owns a conversation with one message. A must never reach either.
insert into public.advisor_conversations (id, profile_id, title)
values ('66666666-6666-4666-8666-66666666666b',
        '55555555-5555-4555-8555-55555555555b', 'B private thread');

insert into public.advisor_messages (conversation_id, role, content)
values ('66666666-6666-4666-8666-66666666666b', 'user', 'B secret question');

-- --------------------------------------------------------------------------
-- Authenticated user A
-- --------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a5a5a5a5-a5a5-4a5a-8a5a-a5a5a5a5a5a5","role":"authenticated"}';

do $$
declare n int;
begin
  select count(*) into n from public.advisor_conversations;
  if n = 0 then
    raise notice 'PASS  A cannot read B''s conversations';
  else
    raise exception 'FAIL: A sees % of B''s conversations', n;
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.advisor_messages;
  if n = 0 then
    raise notice 'PASS  A cannot read B''s messages';
  else
    raise exception 'FAIL: A sees % of B''s messages', n;
  end if;
end $$;

-- Even naming B's conversation id directly returns nothing.
do $$
declare n int;
begin
  select count(*) into n from public.advisor_messages
    where conversation_id = '66666666-6666-4666-8666-66666666666b';
  if n = 0 then
    raise notice 'PASS  A cannot read B''s messages by supplying B''s conversation id';
  else
    raise exception 'FAIL: A read % messages via a supplied id', n;
  end if;
end $$;

-- A can create a conversation on their own profile.
do $$
begin
  insert into public.advisor_conversations (id, profile_id, title)
  values ('66666666-6666-4666-8666-66666666666a',
          '55555555-5555-4555-8555-55555555555a', 'A thread');
  raise notice 'PASS  A can create a conversation on their own profile';
end $$;

-- A cannot create one on B's profile.
do $$
begin
  begin
    insert into public.advisor_conversations (profile_id, title)
    values ('55555555-5555-4555-8555-55555555555b', 'stolen');
    raise exception 'FAIL: A created a conversation on B''s profile';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot create a conversation on B''s profile';
  end;
end $$;

-- A cannot post into B's conversation.
do $$
begin
  begin
    insert into public.advisor_messages (conversation_id, role, content)
    values ('66666666-6666-4666-8666-66666666666b', 'user', 'injected');
    raise exception 'FAIL: A posted into B''s conversation';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot post into B''s conversation';
  end;
end $$;

-- A can post into their own.
do $$
begin
  insert into public.advisor_messages (conversation_id, role, content)
  values ('66666666-6666-4666-8666-66666666666a', 'user', 'my question');
  raise notice 'PASS  A can post into their own conversation';
end $$;

-- A cannot rename or delete B's conversation.
do $$
declare n int;
begin
  update public.advisor_conversations set title = 'hacked'
    where id = '66666666-6666-4666-8666-66666666666b';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot rename B''s conversation (0 rows matched)';
  else
    raise exception 'FAIL: A renamed % of B''s conversations', n;
  end if;
end $$;

do $$
declare n int;
begin
  delete from public.advisor_conversations
    where id = '66666666-6666-4666-8666-66666666666b';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot delete B''s conversation';
  else
    raise exception 'FAIL: A deleted % of B''s conversations', n;
  end if;
end $$;

do $$
declare n int;
begin
  delete from public.advisor_messages
    where conversation_id = '66666666-6666-4666-8666-66666666666b';
  get diagnostics n = row_count;
  if n = 0 then
    raise notice 'PASS  A cannot delete B''s messages';
  else
    raise exception 'FAIL: A deleted % of B''s messages', n;
  end if;
end $$;

-- Assistant turns are historical record: no UPDATE grant exists at all.
do $$
begin
  begin
    update public.advisor_messages set content = 'rewritten'
      where conversation_id = '66666666-6666-4666-8666-66666666666a';
    raise exception 'FAIL: A rewrote a stored message';
  exception
    when insufficient_privilege then
      raise notice 'PASS  messages cannot be rewritten (no UPDATE grant)';
  end;
end $$;

-- Phase 3/4 reference data stays read-only from an advisor session.
do $$
begin
  begin
    update public.metro_occupation_stats set median_annual_wage = 1;
    raise exception 'FAIL: A modified wage reference data';
  exception
    when insufficient_privilege then
      raise notice 'PASS  A cannot modify wage reference data';
  end;
end $$;

-- --------------------------------------------------------------------------
-- User B: isolation is mutual
-- --------------------------------------------------------------------------

set local request.jwt.claims =
  '{"sub":"b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5","role":"authenticated"}';

do $$
declare own int; total int;
begin
  select count(*) into total from public.advisor_conversations;
  select count(*) into own from public.advisor_conversations
    where profile_id = '55555555-5555-4555-8555-55555555555b';
  if total = 1 and own = 1 then
    raise notice 'PASS  B sees only their own conversation';
  else
    raise exception 'FAIL: B sees % conversations (own=%)', total, own;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- Anonymous visitor
-- --------------------------------------------------------------------------

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

do $$
begin
  begin
    perform count(*) from public.advisor_conversations;
    raise exception 'FAIL: anon queried advisor conversations';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot read advisor conversations';
  end;
end $$;

do $$
begin
  begin
    perform count(*) from public.advisor_messages;
    raise exception 'FAIL: anon queried advisor messages';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot read advisor messages';
  end;
end $$;

do $$
begin
  begin
    insert into public.advisor_messages (conversation_id, role, content)
    values ('66666666-6666-4666-8666-66666666666b', 'user', 'anon injected');
    raise exception 'FAIL: anon inserted an advisor message';
  exception
    when insufficient_privilege then
      raise notice 'PASS  anon cannot insert advisor messages';
  end;
end $$;

reset role;
rollback;
