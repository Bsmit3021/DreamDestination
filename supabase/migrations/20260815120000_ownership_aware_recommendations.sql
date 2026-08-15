-- ---------------------------------------------------------------------------
-- DreamDestination — ownership-aware recommendation persistence
--
-- Why this exists
-- ---------------
-- Phase 3 wrote recommendations through `replace_recommendations(profile_id,
-- version, rows)`: SECURITY INVOKER, executable only by `service_role`. The
-- application resolved the caller's profile from `auth.uid()` and passed its id
-- in.
--
-- That was not exploitable — the server action accepts no browser input at all
-- — but it had two structural weaknesses:
--
--   1. The database took `p_profile_id` on trust. Ownership was guaranteed by
--      application code alone; Postgres verified nothing. A future refactor
--      that let a request-supplied value reach that argument would silently
--      become a cross-user write.
--
--   2. It required the service-role key in the authenticated request path. That
--      key bypasses RLS on every table, so the blast radius of any mistake
--      involving that client was the entire database.
--
-- This migration replaces it with a function that takes no profile id at all.
-- The caller's profile is resolved inside Postgres from `auth.uid()`, so
-- targeting another user's recommendations is not merely forbidden, it is
-- unexpressible. Ordinary authenticated users execute it directly, which
-- removes the service-role client from the user flow entirely.
--
-- SECURITY DEFINER is required and is safe here because the function:
--   * pins `search_path` to empty and schema-qualifies every reference,
--   * derives ownership solely from `auth.uid()`,
--   * refuses to run when there is no authenticated caller,
--   * accepts no identifier that could name another user or profile,
--   * contains no dynamic SQL,
--   * is executable only by `authenticated`.
-- ---------------------------------------------------------------------------

create or replace function public.replace_my_recommendations(
  p_algorithm_version text,
  p_rows jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_profile_id uuid;
  v_inserted integer;
begin
  -- No session, no write. Without this an anonymous caller would fall through
  -- to a NULL profile lookup.
  if v_user_id is null then
    raise exception 'replace_my_recommendations requires an authenticated caller'
      using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array, got %',
      coalesce(jsonb_typeof(p_rows), 'null')
      using errcode = '22023';
  end if;

  -- The only profile this function can ever touch is the caller's own.
  select id into v_profile_id
  from public.profiles
  where user_id = v_user_id;

  if v_profile_id is null then
    raise exception 'No profile exists for the authenticated caller'
      using errcode = 'P0002';
  end if;

  -- Delete + insert in one function call, so the unique (profile_id, rank)
  -- and (profile_id, city_id) constraints cannot be tripped by a rerun.
  delete from public.recommendations where profile_id = v_profile_id;

  insert into public.recommendations (
    profile_id, city_id, dream_score, "rank", reason_json, algorithm_version
  )
  select
    v_profile_id,
    (row_data->>'city_id')::uuid,
    (row_data->>'dream_score')::numeric,
    (row_data->>'rank')::integer,
    coalesce(row_data->'reason_json', '{}'::jsonb),
    p_algorithm_version
  from jsonb_array_elements(p_rows) as row_data;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

comment on function public.replace_my_recommendations(text, jsonb) is
  'Atomically replaces the CALLING user''s recommendations. Ownership is derived from auth.uid(); no profile id is accepted.';

-- Postgres grants EXECUTE to PUBLIC by default, which would expose a
-- SECURITY DEFINER function to anon. Revoke first, then grant narrowly.
revoke all on function public.replace_my_recommendations(text, jsonb)
  from public, anon;
grant execute on function public.replace_my_recommendations(text, jsonb)
  to authenticated;

-- The service-role variant now has no caller. Leaving a privileged function in
-- place that nothing uses is avoidable attack surface.
drop function if exists public.replace_recommendations(uuid, text, jsonb);
