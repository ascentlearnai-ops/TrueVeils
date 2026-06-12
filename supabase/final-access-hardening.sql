-- Final paid-beta access hardening.
-- Candidates authenticate anonymously, then candidate-join creates a
-- session_participants row. No TrueVeils data needs direct anon access.

drop policy if exists "Truveil recent session-code access" on public.sessions;
drop policy if exists "Truveil audio chunks access by recent session" on public.audio_chunks;
drop policy if exists "Truveil audio chunks access by session" on public.audio_chunks;

revoke all on public.sessions, public.audio_chunks from anon;

alter table public.audio_chunks enable row level security;

create policy "session participants select audio chunks"
  on public.audio_chunks for select to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and private.can_access_session(s.internal_id)
    )
  );

create policy "session participants insert audio chunks"
  on public.audio_chunks for insert to authenticated
  with check (
    storage_path like session_id || '/%'
    and exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and s.status in ('waiting', 'candidate_ready', 'active')
        and private.can_access_session(s.internal_id)
    )
  );

create policy "session participants update audio chunks"
  on public.audio_chunks for update to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and private.can_access_session(s.internal_id)
    )
  )
  with check (
    storage_path like session_id || '/%'
    and exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and private.can_access_session(s.internal_id)
    )
  );

create policy "session participants delete audio chunks"
  on public.audio_chunks for delete to authenticated
  using (
    exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and private.can_access_session(s.internal_id)
    )
  );

revoke all on public.audio_chunks from authenticated;
grant select, insert, update, delete on public.audio_chunks to authenticated;

drop policy if exists "Truveil session audio select" on storage.objects;
drop policy if exists "Truveil session audio insert" on storage.objects;
drop policy if exists "Truveil session audio delete" on storage.objects;

create policy "Truveil authenticated session audio select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'session-audio'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and private.can_access_session(s.internal_id)
    )
  );

create policy "Truveil authenticated session audio insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'session-audio'
    and name ~ '^TRV-[A-Z0-9]{6}/[0-9]{5}-[0-9]+\.(webm|ogg|wav)$'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and s.status in ('waiting', 'candidate_ready', 'active')
        and private.can_access_session(s.internal_id)
    )
  );

create policy "Truveil authenticated session audio delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'session-audio'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and private.can_access_session(s.internal_id)
    )
  );

alter function private.session_id_from_topic(text)
  set search_path = pg_catalog;

revoke all on function private.session_id_from_topic(text) from public, anon;
grant execute on function private.session_id_from_topic(text) to authenticated;

revoke all on function public.cleanup_expired_session_audio(interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_expired_session_audio(interval)
  to postgres, service_role;
