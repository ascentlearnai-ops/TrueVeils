-- Apply before deploying the matching create-session/candidate-join functions.
-- Existing duplicate candidate memberships intentionally block this migration;
-- never silently remove memberships to make the index succeed.
begin;

-- Permissive policies are ORed: older installations must not retain this bypass.
drop policy if exists "Recruiters can manage organization sessions" on public.sessions;

create unique index if not exists session_one_candidate_idx
  on public.session_participants (session_id)
  where participant_role = 'candidate';

-- The legacy permissive policy overrides the recruiter-only policy via OR.
drop policy if exists "session access notes" on public.session_notes;

-- Anonymous Auth users have the authenticated DB role too. Require an actual
-- signed-in recruiter identity on the direct-table path, not only at the edge.
alter policy "recruiters manage sessions" on public.sessions
  using (
    coalesce((select auth.jwt())->>'is_anonymous', 'true') = 'false'
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = sessions.organization_id
        and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin', 'recruiter')
    )
  )
  with check (
    coalesce((select auth.jwt())->>'is_anonymous', 'true') = 'false'
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = sessions.organization_id
        and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin', 'recruiter')
    )
  );

create or replace function public.create_recruiter_session(
  recruiter_user uuid, workspace_name text, session_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  member public.organization_members%rowtype;
  created public.sessions%rowtype;
  workspace_id uuid;
begin
  if not exists (select 1 from auth.users where id = recruiter_user
    and is_anonymous is false and nullif(email, '') is not null) then
    return jsonb_build_object('status_code', 401, 'error', 'Recruiter sign-in is required.');
  end if;
  -- Serialize first-use onboarding for this verified recruiter. This lock and
  -- every insert below are released/rolled back together on any failure.
  perform pg_advisory_xact_lock(hashtextextended(recruiter_user::text, 0));
  select * into member from public.organization_members where user_id = recruiter_user
    order by (role in ('owner', 'admin', 'recruiter')) desc, organization_id limit 1;
  if found then
    if member.role not in ('owner', 'admin', 'recruiter') then
      return jsonb_build_object('status_code', 403, 'error', 'Recruiter workspace access is required.');
    end if;
    workspace_id := member.organization_id;
  else
    insert into public.organizations (name) values (left(workspace_name, 160)) returning id into workspace_id;
    insert into public.organization_members (organization_id, user_id, role)
      values (workspace_id, recruiter_user, 'owner');
  end if;

  insert into public.sessions (
    id, join_code, candidate_link, status, flags, transcript, recruiter_id, organization_id,
    candidate_name, role_title, technical_vocabulary, policy_preset,
    allowed_apps, allowed_sites, blocked_sites, blocking_mode, expires_at, retention_until
  ) values (
    session_data->>'id', session_data->>'id', session_data->>'candidate_link', 'waiting', '[]', '[]',
    recruiter_user, workspace_id, left(session_data->>'candidate_name', 120),
    left(session_data->>'role_title', 160),
    array(select jsonb_array_elements_text(coalesce(session_data->'technical_vocabulary', '[]'))),
    coalesce(session_data->>'policy_preset', 'standard_technical'),
    array(select jsonb_array_elements_text(coalesce(session_data->'allowed_apps', '[]'))),
    array(select jsonb_array_elements_text(coalesce(session_data->'allowed_sites', '[]'))),
    array(select jsonb_array_elements_text(coalesce(session_data->'blocked_sites', '[]'))),
    'warn_refocus', now() + interval '4 hours', now() + interval '30 days'
  ) returning * into created;
  insert into public.session_participants (session_id, user_id, participant_role, expires_at)
    values (created.internal_id, recruiter_user, 'recruiter', created.expires_at);
  return jsonb_build_object('session', to_jsonb(created));
end;
$$;

revoke all on function public.create_recruiter_session(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_recruiter_session(uuid, text, jsonb) to service_role;

create or replace function public.claim_candidate_session(
  target_code text, candidate_user uuid, display_name text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.sessions%rowtype;
  existing_candidate uuid;
  candidate_expiry timestamptz;
begin
  if candidate_user is null or target_code is null or target_code !~ '^TRV-[A-Z0-9]{6}$' then
    return jsonb_build_object('status_code', 400, 'error', 'Invalid candidate or session code.');
  end if;
  select * into target from public.sessions where join_code = target_code for update;
  if not found then
    return jsonb_build_object('status_code', 404, 'error', 'Session not found.');
  end if;
  if target.status is null or target.status not in ('waiting', 'candidate_ready', 'active') then
    return jsonb_build_object('status_code', 409, 'error', 'This session has ended.');
  end if;
  if target.expires_at is null or target.expires_at <= now() then
    return jsonb_build_object('status_code', 410, 'error', 'This session code has expired.');
  end if;

  select user_id into existing_candidate from public.session_participants
    where session_id = target.internal_id and participant_role = 'candidate';
  if existing_candidate is not null and existing_candidate <> candidate_user then
    return jsonb_build_object('status_code', 409, 'error', 'This session is already linked to another candidate.');
  end if;
  if target.status = 'active' and existing_candidate is distinct from candidate_user then
    return jsonb_build_object('status_code', 409, 'error', 'Only the linked candidate can reconnect.');
  end if;
  if target.recruiter_id = candidate_user or exists (
    select 1 from public.session_participants
    where session_id = target.internal_id and user_id = candidate_user
      and participant_role <> 'candidate'
  ) then
    return jsonb_build_object('status_code', 409, 'error', 'This account already has a different session role.');
  end if;

  candidate_expiry := least(target.expires_at, now() + interval '4 hours');
  insert into public.session_participants
    (session_id, user_id, participant_role, candidate_name, expires_at)
    values (target.internal_id, candidate_user, 'candidate', left(coalesce(display_name, ''), 120), candidate_expiry)
    on conflict (session_id, user_id) do update
      set candidate_name = excluded.candidate_name, expires_at = excluded.expires_at;
  if target.status = 'waiting' then
    update public.sessions set status = 'candidate_ready' where internal_id = target.internal_id;
    target.status := 'candidate_ready';
  end if;

  return jsonb_build_object('session', jsonb_build_object(
    'id', target.id, 'internal_id', target.internal_id, 'join_code', target.join_code,
    'status', target.status, 'allowed_apps', target.allowed_apps,
    'allowed_sites', target.allowed_sites, 'blocked_sites', target.blocked_sites,
    'blocking_mode', target.blocking_mode, 'technical_vocabulary', target.technical_vocabulary,
    'role_title', target.role_title, 'policy_preset', target.policy_preset
  ), 'expires_at', candidate_expiry);
end;
$$;

revoke all on function public.claim_candidate_session(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_candidate_session(text, uuid, text) to service_role;

create or replace function public.transition_candidate_session(
  target_session uuid, candidate_user uuid, requested_state text, token_expiry timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target public.sessions%rowtype;
  participant public.session_participants%rowtype;
  changed integer;
begin
  if requested_state is null or requested_state not in ('candidate_ready', 'interrupted') then
    return jsonb_build_object('status_code', 400, 'error', 'Invalid session state.');
  end if;
  -- Match claim_candidate_session lock order. Hold membership against concurrent
  -- deletion or expiry changes until the conditional session update completes.
  select * into target from public.sessions where internal_id = target_session for update;
  if not found then
    return jsonb_build_object('status_code', 409, 'error', 'This session cannot accept that state change.');
  end if;
  select * into participant from public.session_participants
    where session_id = target_session and user_id = candidate_user and participant_role = 'candidate'
    for share;
  if not found then
    return jsonb_build_object('status_code', 403, 'error', 'Current candidate membership is required.');
  end if;
  if token_expiry is null or target.expires_at is null or participant.expires_at is null
    or least(token_expiry, target.expires_at, participant.expires_at) <= clock_timestamp() then
    return jsonb_build_object('status_code', 410, 'error', 'Candidate access has expired.');
  end if;
  update public.sessions set status = requested_state,
    ended_at = case when requested_state = 'interrupted' then clock_timestamp() else ended_at end
    where internal_id = target_session
      and token_expiry > clock_timestamp() and expires_at > clock_timestamp()
      and participant.expires_at > clock_timestamp()
      and ((requested_state = 'candidate_ready' and status in ('waiting', 'candidate_ready'))
        or (requested_state = 'interrupted' and status in ('candidate_ready', 'active')));
  get diagnostics changed = row_count;
  if changed <> 1 then
    return jsonb_build_object('status_code', 409, 'error', 'This session cannot accept that state change.');
  end if;
  return jsonb_build_object('ok', true, 'status', requested_state);
end;
$$;

revoke all on function public.transition_candidate_session(uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.transition_candidate_session(uuid, uuid, text, timestamptz) to service_role;

commit;
