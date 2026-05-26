-- Truveil retention + session-code RLS hardening.
-- Keeps the no-login MVP working while limiting audio/session access to recent active sessions.

create extension if not exists pg_cron with schema extensions;

alter table if exists public.sessions enable row level security;

drop policy if exists "Truveil sessions realtime access" on public.sessions;
create policy "Truveil recent session-code access"
  on public.sessions
  for all
  to anon, authenticated
  using (
    id ~ '^TRV-[A-Z0-9]{6}$'
    and coalesce(created_at, now()) > now() - interval '24 hours'
  )
  with check (
    id ~ '^TRV-[A-Z0-9]{6}$'
    and coalesce(status, 'waiting') in ('waiting', 'active', 'completed', 'interrupted')
    and coalesce(created_at, now()) > now() - interval '24 hours'
  );

drop policy if exists "Truveil audio chunks access by session" on public.audio_chunks;
create policy "Truveil audio chunks access by recent session"
  on public.audio_chunks
  for all
  to anon, authenticated
  using (
    storage_path like session_id || '/%'
    and exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and coalesce(s.created_at, now()) > now() - interval '24 hours'
        and coalesce(s.status, 'waiting') in ('waiting', 'active', 'completed', 'interrupted')
    )
  )
  with check (
    storage_path like session_id || '/%'
    and exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and coalesce(s.created_at, now()) > now() - interval '24 hours'
        and coalesce(s.status, 'waiting') in ('waiting', 'active')
    )
  );

drop policy if exists "Truveil session audio insert" on storage.objects;
drop policy if exists "Truveil session audio select" on storage.objects;
drop policy if exists "Truveil session audio delete" on storage.objects;

create policy "Truveil session audio insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'session-audio'
    and name ~ '^TRV-[A-Z0-9]{6}/[0-9]{5}-[0-9]+\\.(webm|ogg|wav)$'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and coalesce(s.created_at, now()) > now() - interval '24 hours'
        and coalesce(s.status, 'waiting') in ('waiting', 'active')
    )
  );

create policy "Truveil session audio select"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'session-audio'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and coalesce(s.created_at, now()) > now() - interval '24 hours'
    )
  );

create policy "Truveil session audio delete"
  on storage.objects
  for delete
  to anon, authenticated
  using (
    bucket_id = 'session-audio'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and coalesce(s.created_at, now()) > now() - interval '24 hours'
    )
  );

create or replace function public.cleanup_expired_session_audio(retention interval default interval '2 hours')
returns integer
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  deleted_count integer := 0;
begin
  with expired as (
    select ac.id, ac.storage_path
    from public.audio_chunks ac
    join public.sessions s on s.id = ac.session_id
    where ac.cleaned_at is null
      and (
        coalesce(s.ended_at, s.created_at) < now() - retention
        or coalesce(s.status, 'waiting') in ('completed', 'interrupted')
      )
  ),
  deleted_objects as (
    delete from storage.objects o
    using expired e
    where o.bucket_id = 'session-audio'
      and o.name = e.storage_path
    returning o.name
  ),
  updated_chunks as (
    update public.audio_chunks ac
    set status = 'deleted',
        cleaned_at = now()
    from expired e
    where ac.id = e.id
    returning ac.id
  )
  select count(*) into deleted_count from updated_chunks;

  return deleted_count;
end;
$$;

revoke all on function public.cleanup_expired_session_audio(interval) from public;
grant execute on function public.cleanup_expired_session_audio(interval) to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'truveil-session-audio-cleanup') then
    perform cron.unschedule('truveil-session-audio-cleanup');
  end if;
end $$;

select cron.schedule(
  'truveil-session-audio-cleanup',
  '*/15 * * * *',
  $$select public.cleanup_expired_session_audio(interval '2 hours');$$
);
