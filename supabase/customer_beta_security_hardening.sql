-- Customer beta security hardening.
-- Candidates may read their session and publish ephemeral Realtime messages,
-- but only recruiters may persist or modify interview evidence.

create or replace function private.is_session_recruiter(target_session uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.sessions s
    where s.internal_id = target_session
      and (
        s.recruiter_id = auth.uid()
        or private.is_org_member(s.organization_id)
      )
  );
$$;

revoke all on function private.is_session_recruiter(uuid) from public, anon;
grant execute on function private.is_session_recruiter(uuid) to authenticated;

drop policy if exists "session access events" on public.session_events;
create policy "recruiters manage session events"
on public.session_events for all to authenticated
using (private.is_session_recruiter(session_id))
with check (private.is_session_recruiter(session_id));

drop policy if exists "session access transcripts" on public.transcript_segments;
create policy "recruiters manage transcript segments"
on public.transcript_segments for all to authenticated
using (private.is_session_recruiter(session_id))
with check (private.is_session_recruiter(session_id));

drop policy if exists "session access notes" on public.session_notes;
create policy "recruiters manage session notes"
on public.session_notes for all to authenticated
using (private.is_session_recruiter(session_id))
with check (private.is_session_recruiter(session_id));

drop policy if exists "organization access reports" on public.reports;
create policy "recruiters manage reports"
on public.reports for all to authenticated
using (private.is_session_recruiter(session_id))
with check (private.is_session_recruiter(session_id));

drop policy if exists "session participants select audio chunks" on public.audio_chunks;
drop policy if exists "session participants insert audio chunks" on public.audio_chunks;
drop policy if exists "session participants update audio chunks" on public.audio_chunks;
drop policy if exists "session participants delete audio chunks" on public.audio_chunks;

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

