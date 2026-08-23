-- ---------------------------------------------------------------------------
-- DreamDestination — Phase 5: advisor conversations
--
-- Additive only. Nothing existing is altered or dropped.
--
-- Ownership runs through `profiles`, exactly as preferences and
-- recommendations already do, so a conversation is reachable only by the user
-- whose auth.uid() owns the parent profile. No browser-supplied identifier is
-- ever trusted as authority.
-- ---------------------------------------------------------------------------

create table public.advisor_conversations (
  id uuid primary key default gen_random_uuid(),

  profile_id uuid not null
    references public.profiles (id) on delete cascade,

  title text not null default 'New conversation'
    constraint advisor_conversations_title_length
      check (char_length(title) between 1 and 200),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.advisor_conversations is
  'One advisor chat thread, owned through the parent profile.';

create index advisor_conversations_profile_idx
  on public.advisor_conversations (profile_id, updated_at desc);

create trigger advisor_conversations_set_updated_at
  before update on public.advisor_conversations
  for each row execute function public.set_updated_at();

create table public.advisor_messages (
  id uuid primary key default gen_random_uuid(),

  conversation_id uuid not null
    references public.advisor_conversations (id) on delete cascade,

  role text not null
    constraint advisor_messages_role_allowed check (role in ('user', 'assistant')),

  content text not null
    constraint advisor_messages_content_length
      check (char_length(content) between 1 and 8000),

  -- Validated evidence ids only. Written after server-side citation checking,
  -- so an id the model invented never lands here.
  evidence_refs jsonb not null default '[]'::jsonb
    constraint advisor_messages_evidence_is_array
      check (jsonb_typeof(evidence_refs) = 'array'),

  -- Configuration that produced this answer. Without it, a later model or
  -- prompt change would silently re-attribute old responses.
  model text
    constraint advisor_messages_model_length check (char_length(model) <= 100),
  prompt_version text
    constraint advisor_messages_prompt_version_length
      check (char_length(prompt_version) <= 20),

  input_tokens integer
    constraint advisor_messages_input_tokens_non_negative check (input_tokens >= 0),
  output_tokens integer
    constraint advisor_messages_output_tokens_non_negative check (output_tokens >= 0),
  latency_ms integer
    constraint advisor_messages_latency_non_negative check (latency_ms >= 0),

  created_at timestamptz not null default now()
);

comment on table public.advisor_messages is
  'Advisor turns. Assistant rows record the model and prompt version that produced them.';
comment on column public.advisor_messages.evidence_refs is
  'Server-validated evidence ids. Model-invented ids are rejected before insert.';

create index advisor_messages_conversation_idx
  on public.advisor_messages (conversation_id, created_at);

-- Supports the per-user rate limit window without scanning all messages.
create index advisor_messages_created_at_idx
  on public.advisor_messages (created_at desc);

-- ---------------------------------------------------------------------------
-- Privileges and RLS
--
-- Users may create and read their own threads. There is deliberately no
-- UPDATE policy on messages: a turn is a historical record, and letting a
-- client edit one would let a user rewrite what the advisor said.
-- ---------------------------------------------------------------------------

grant select, insert, update, delete on public.advisor_conversations to authenticated;
grant select, insert, delete on public.advisor_messages to authenticated;
grant all on public.advisor_conversations to service_role;
grant all on public.advisor_messages to service_role;

alter table public.advisor_conversations enable row level security;
alter table public.advisor_messages enable row level security;

create policy "Users read their own advisor conversations"
  on public.advisor_conversations for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = advisor_conversations.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users create advisor conversations on their own profile"
  on public.advisor_conversations for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = advisor_conversations.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users update their own advisor conversations"
  on public.advisor_conversations for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = advisor_conversations.profile_id
        and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = advisor_conversations.profile_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users delete their own advisor conversations"
  on public.advisor_conversations for delete to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = advisor_conversations.profile_id
        and p.user_id = (select auth.uid())
    )
  );

-- Message ownership is inherited two levels up: message -> conversation ->
-- profile -> auth.uid(). Writing into someone else's thread fails the WITH
-- CHECK regardless of what conversation id the client supplies.
create policy "Users read messages in their own conversations"
  on public.advisor_messages for select to authenticated
  using (
    exists (
      select 1
      from public.advisor_conversations c
      join public.profiles p on p.id = c.profile_id
      where c.id = advisor_messages.conversation_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users add messages to their own conversations"
  on public.advisor_messages for insert to authenticated
  with check (
    exists (
      select 1
      from public.advisor_conversations c
      join public.profiles p on p.id = c.profile_id
      where c.id = advisor_messages.conversation_id
        and p.user_id = (select auth.uid())
    )
  );

create policy "Users delete messages in their own conversations"
  on public.advisor_messages for delete to authenticated
  using (
    exists (
      select 1
      from public.advisor_conversations c
      join public.profiles p on p.id = c.profile_id
      where c.id = advisor_messages.conversation_id
        and p.user_id = (select auth.uid())
    )
  );
