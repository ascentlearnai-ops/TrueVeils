-- TrueVeils sellable technical-interview integrity upgrade.
-- Backward-compatible with the existing text join-code sessions table.

create extension if not exists pgcrypto;

create schema if not exists private;
revoke all on schema private from public;

alter table public.sessions
  add column if not exists internal_id uuid default gen_random_uuid(),
  add column if not exists join_code text,
  add column if not exists organization_id uuid,
  add column if not exists recruiter_id uuid references auth.users(id) on delete set null,
  add column if not exists candidate_name text,
  add column if not exists role_title text,
  add column if not exists technical_vocabulary text[] not null default array[]::text[],
  add column if not exists policy_preset text not null default 'standard_technical',
  add column if not exists consented_at timestamptz,
  add column if not exists started_at timestamptz,
  add column if not exists expires_at timestamptz default (now() + interval '4 hours'),
  add column if not exists retention_until timestamptz default (now() + interval '30 days');

update public.sessions set join_code = id where join_code is null;
update public.sessions set internal_id = gen_random_uuid() where internal_id is null;

create unique index if not exists sessions_internal_id_idx on public.sessions(internal_id);
create unique index if not exists sessions_join_code_idx on public.sessions(join_code);
create index if not exists sessions_retention_idx on public.sessions(retention_until);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'recruiter' check (role in ('owner', 'admin', 'recruiter', 'reviewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.sessions
  drop constraint if exists sessions_organization_id_fkey,
  add constraint sessions_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade;

create table if not exists public.session_participants (
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_role text not null default 'candidate' check (participant_role in ('candidate', 'recruiter', 'reviewer')),
  candidate_name text,
  joined_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '4 hours'),
  primary key (session_id, user_id)
);

create table if not exists public.session_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  event_type text not null,
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  occurred_at timestamptz not null default now(),
  process_name text,
  window_title text,
  detected_url text,
  detected_host text,
  detection_source text,
  matched_rule text,
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed', 'reviewed', 'allowed', 'dismissed')),
  metadata jsonb not null default '{}'::jsonb
);
create index if not exists session_events_session_time_idx on public.session_events(session_id, occurred_at);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  segment_id text not null,
  sequence integer not null default 0,
  revision integer not null default 0,
  text text not null,
  confidence real,
  source text not null,
  started_at timestamptz,
  ended_at timestamptz,
  emitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(session_id, segment_id, revision)
);
create index if not exists transcript_segments_session_sequence_idx on public.transcript_segments(session_id, sequence);

create table if not exists public.session_notes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  note text not null,
  bookmarked_at timestamptz,
  transcript_segment_id text,
  event_id uuid references public.session_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists session_notes_session_time_idx on public.session_notes(session_id, created_at);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  recruiter_id uuid references auth.users(id) on delete set null,
  review_band text not null default 'incomplete_evidence'
    check (review_band in ('clear', 'review', 'high_priority_review', 'incomplete_evidence')),
  summary jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  telemetry_health jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '30 days')
);
alter table public.reports
  add column if not exists review_band text not null default 'incomplete_evidence',
  add column if not exists notes jsonb not null default '[]'::jsonb,
  add column if not exists telemetry_health jsonb not null default '{}'::jsonb,
  add column if not exists retention_until timestamptz not null default (now() + interval '30 days');
create index if not exists reports_org_created_idx on public.reports(organization_id, created_at desc);
create index if not exists reports_retention_idx on public.reports(retention_until);

create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org and user_id = auth.uid()
  );
$$;

create or replace function private.can_access_session(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.internal_id = target_session
      and (
        s.recruiter_id = auth.uid()
        or private.is_org_member(s.organization_id)
        or exists (
          select 1 from public.session_participants p
          where p.session_id = s.internal_id
            and p.user_id = auth.uid()
            and p.expires_at > now()
        )
      )
  );
$$;

create or replace function private.session_id_from_topic(topic_name text)
returns uuid
language plpgsql
immutable
as $$
declare raw_id text;
begin
  raw_id := replace(topic_name, 'truveil-session:', '');
  return raw_id::uuid;
exception when others then
  return null;
end;
$$;

grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.can_access_session(uuid) to authenticated;
grant execute on function private.session_id_from_topic(text) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.session_events enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.session_notes enable row level security;
alter table public.reports enable row level security;

drop policy if exists "members read organizations" on public.organizations;
create policy "members read organizations" on public.organizations for select to authenticated
  using (private.is_org_member(id));

drop policy if exists "members read memberships" on public.organization_members;
create policy "members read memberships" on public.organization_members for select to authenticated
  using (user_id = auth.uid() or private.is_org_member(organization_id));

drop policy if exists "session participants read sessions" on public.sessions;
create policy "session participants read sessions" on public.sessions for select to authenticated
  using (private.can_access_session(internal_id));

drop policy if exists "recruiters manage sessions" on public.sessions;
create policy "recruiters manage sessions" on public.sessions for all to authenticated
  using (recruiter_id = auth.uid() or private.is_org_member(organization_id))
  with check (recruiter_id = auth.uid() or private.is_org_member(organization_id));

drop policy if exists "participants read their membership" on public.session_participants;
create policy "participants read their membership" on public.session_participants for select to authenticated
  using (user_id = auth.uid() or private.can_access_session(session_id));

drop policy if exists "session access events" on public.session_events;
create policy "session access events" on public.session_events for all to authenticated
  using (private.can_access_session(session_id))
  with check (private.can_access_session(session_id));

drop policy if exists "session access transcripts" on public.transcript_segments;
create policy "session access transcripts" on public.transcript_segments for all to authenticated
  using (private.can_access_session(session_id))
  with check (private.can_access_session(session_id));

drop policy if exists "session access notes" on public.session_notes;
create policy "session access notes" on public.session_notes for all to authenticated
  using (private.can_access_session(session_id))
  with check (private.can_access_session(session_id));

drop policy if exists "organization access reports" on public.reports;
create policy "organization access reports" on public.reports for all to authenticated
  using (private.can_access_session(session_id))
  with check (private.can_access_session(session_id));

-- Private Realtime channels use topics like truveil-session:<internal UUID>.
drop policy if exists "truveil private realtime read" on realtime.messages;
create policy "truveil private realtime read" on realtime.messages for select to authenticated
  using (private.can_access_session(private.session_id_from_topic(realtime.topic())));

drop policy if exists "truveil private realtime write" on realtime.messages;
create policy "truveil private realtime write" on realtime.messages for insert to authenticated
  with check (private.can_access_session(private.session_id_from_topic(realtime.topic())));

revoke all on public.organizations, public.organization_members, public.sessions,
  public.session_participants, public.session_events, public.transcript_segments,
  public.session_notes, public.reports from anon;

grant select on public.organizations, public.organization_members, public.sessions,
  public.session_participants, public.session_events, public.transcript_segments,
  public.session_notes, public.reports to authenticated;
grant insert, update, delete on public.sessions, public.session_events,
  public.transcript_segments, public.session_notes, public.reports to authenticated;

create or replace function private.cleanup_truveil_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.reports where retention_until < now();
  delete from public.sessions where retention_until < now();
end;
$$;
