-- Truveil Windows paid-beta security model.
-- Apply after the existing session/audio migrations.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'recruiter' check (role in ('owner', 'admin', 'recruiter')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

alter table public.sessions
  add column if not exists internal_id uuid default gen_random_uuid(),
  add column if not exists join_code text,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists recruiter_id uuid references auth.users(id) on delete set null,
  add column if not exists expires_at timestamptz default (now() + interval '4 hours'),
  add column if not exists retention_until timestamptz default (now() + interval '30 days');

update public.sessions
set join_code = id
where join_code is null;

create unique index if not exists sessions_internal_id_idx on public.sessions(internal_id);
create unique index if not exists sessions_join_code_idx on public.sessions(join_code);
create index if not exists sessions_org_created_idx on public.sessions(organization_id, created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(internal_id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recruiter_id uuid references auth.users(id) on delete set null,
  summary jsonb not null default '{}'::jsonb,
  transcript jsonb not null default '[]'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  model_version text,
  created_at timestamptz not null default now(),
  retention_until timestamptz not null default (now() + interval '30 days')
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.sessions enable row level security;
alter table public.reports enable row level security;
alter table public.audio_chunks enable row level security;

drop policy if exists "Truveil recent session-code access" on public.sessions;
drop policy if exists "Truveil sessions realtime access" on public.sessions;
drop policy if exists "Truveil audio chunks access by recent session" on public.audio_chunks;
drop policy if exists "Truveil audio chunks access by session" on public.audio_chunks;
drop policy if exists "Truveil session audio insert" on storage.objects;
drop policy if exists "Truveil session audio select" on storage.objects;
drop policy if exists "Truveil session audio delete" on storage.objects;

create policy "Members can view their organizations"
  on public.organizations for select to authenticated
  using (exists (
    select 1 from public.organization_members member
    where member.organization_id = organizations.id and member.user_id = auth.uid()
  ));

create policy "Members can view memberships"
  on public.organization_members for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from public.organization_members member
    where member.organization_id = organization_members.organization_id
      and member.user_id = auth.uid()
      and member.role in ('owner', 'admin')
  ));

create policy "Recruiters can manage organization sessions"
  on public.sessions for all to authenticated
  using (exists (
    select 1 from public.organization_members member
    where member.organization_id = sessions.organization_id and member.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.organization_members member
    where member.organization_id = sessions.organization_id and member.user_id = auth.uid()
  ));

create policy "Recruiters can manage organization reports"
  on public.reports for all to authenticated
  using (exists (
    select 1 from public.organization_members member
    where member.organization_id = reports.organization_id and member.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.organization_members member
    where member.organization_id = reports.organization_id and member.user_id = auth.uid()
  ));

create policy "Recruiters can view organization audio metadata"
  on public.audio_chunks for select to authenticated
  using (exists (
    select 1 from public.sessions session
    join public.organization_members member on member.organization_id = session.organization_id
    where session.id = audio_chunks.session_id and member.user_id = auth.uid()
  ));

revoke all on public.organizations, public.organization_members, public.sessions, public.reports, public.audio_chunks from anon;
grant select on public.organizations, public.organization_members to authenticated;
grant select, insert, update, delete on public.sessions, public.reports to authenticated;
grant select on public.audio_chunks to authenticated;

create or replace function public.cleanup_expired_reports()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count integer;
begin
  delete from public.reports where retention_until < now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_reports() from public;
grant execute on function public.cleanup_expired_reports() to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'truveil-report-retention') then
    perform cron.unschedule('truveil-report-retention');
  end if;
end $$;

select cron.schedule(
  'truveil-report-retention',
  '17 3 * * *',
  $$select public.cleanup_expired_reports();$$
);
