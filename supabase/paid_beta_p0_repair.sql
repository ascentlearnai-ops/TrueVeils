-- Paid beta P0 repair.
-- Restores the candidate fallback audio metadata path without reopening broad
-- legacy session access. Candidates can write only audio rows for sessions
-- they can access through session_participants.

drop policy if exists "session participants insert audio chunks" on public.audio_chunks;
create policy "session participants insert audio chunks"
  on public.audio_chunks for insert to authenticated
  with check (
    storage_path like session_id || '/%'
    and exists (
      select 1
      from public.sessions s
      where s.id = audio_chunks.session_id
        and s.status in ('candidate_ready', 'active')
        and private.can_access_session(s.internal_id)
    )
  );

drop policy if exists "session participants update audio chunks" on public.audio_chunks;
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
        and s.status in ('candidate_ready', 'active')
        and private.can_access_session(s.internal_id)
    )
  );

grant select, insert, update on public.audio_chunks to authenticated;
