-- Paid beta backend access cleanup.
-- Removes legacy broad policies that survived earlier migrations and restores
-- the intended split:
-- - candidates can read/join only their own active session through membership
-- - recruiters/org members persist evidence and reports
-- - private Realtime channels are scoped by internal session UUID

drop policy if exists "Truveil sessions access" on public.sessions;
drop policy if exists "session access events" on public.session_events;
drop policy if exists "session access transcripts" on public.transcript_segments;
drop policy if exists "organization access reports" on public.reports;

drop policy if exists "session participants insert audio chunks" on public.audio_chunks;
drop policy if exists "session participants update audio chunks" on public.audio_chunks;
drop policy if exists "session participants delete audio chunks" on public.audio_chunks;

drop policy if exists "session participants select audio chunks" on public.audio_chunks;
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

drop policy if exists "recruiters manage audio chunks" on public.audio_chunks;
create policy "recruiters manage audio chunks"
  on public.audio_chunks for all to authenticated
  using (
    exists (
      select 1 from public.sessions s
      where s.id = audio_chunks.session_id
        and private.is_session_recruiter(s.internal_id)
    )
  )
  with check (
    storage_path like session_id || '/%'
    and exists (
      select 1 from public.sessions s
      where s.id = audio_chunks.session_id
        and private.is_session_recruiter(s.internal_id)
    )
  );

drop policy if exists "Truveil authenticated session audio insert" on storage.objects;
create policy "Truveil authenticated session audio insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'session-audio'
    and name ~ '^TRV-[A-Z0-9]{6}/[0-9]{5}-[0-9]+\.(webm|ogg|wav)$'
    and exists (
      select 1
      from public.sessions s
      where s.id = (storage.foldername(name))[1]
        and s.status in ('candidate_ready', 'active')
        and private.can_access_session(s.internal_id)
    )
  );

revoke all on public.sessions, public.audio_chunks, public.session_events,
  public.transcript_segments, public.session_notes, public.reports from anon;
