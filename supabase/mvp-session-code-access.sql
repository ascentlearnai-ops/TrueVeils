-- TrueVeils MVP session-code access recovery.
-- Run this only for the current code-based beta flow that uses the Supabase publishable key.
-- It lets the admin app create TRV session codes and lets the candidate app find them.
-- Before real customers, replace this with recruiter auth + session-scoped candidate tokens.

alter table if exists public.sessions
  add column if not exists allowed_apps text[] default array[]::text[],
  add column if not exists allowed_sites text[] default array[]::text[],
  add column if not exists blocked_sites text[] default array[]::text[],
  add column if not exists blocking_mode text default 'warn_refocus',
  add column if not exists candidate_link text,
  add column if not exists flags jsonb default '[]'::jsonb,
  add column if not exists transcript jsonb default '[]'::jsonb,
  add column if not exists join_code text,
  add column if not exists internal_id uuid,
  add column if not exists status text default 'waiting',
  add column if not exists created_at timestamptz default now();

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.sessions to anon, authenticated;

alter table if exists public.sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sessions'
      and policyname = 'Truveil MVP sessions select by code'
  ) then
    create policy "Truveil MVP sessions select by code"
      on public.sessions
      for select
      to anon, authenticated
      using (id like 'TRV-%' or coalesce(join_code, '') like 'TRV-%');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sessions'
      and policyname = 'Truveil MVP sessions create code'
  ) then
    create policy "Truveil MVP sessions create code"
      on public.sessions
      for insert
      to anon, authenticated
      with check (id like 'TRV-%' or coalesce(join_code, '') like 'TRV-%');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'sessions'
      and policyname = 'Truveil MVP sessions update by code'
  ) then
    create policy "Truveil MVP sessions update by code"
      on public.sessions
      for update
      to anon, authenticated
      using (id like 'TRV-%' or coalesce(join_code, '') like 'TRV-%')
      with check (id like 'TRV-%' or coalesce(join_code, '') like 'TRV-%');
  end if;
end $$;
