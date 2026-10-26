'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261024000100_session_readiness.sql'), 'utf8');
const RECRUITER = '00000000-0000-4000-8000-000000000001';
const CANDIDATE = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';
const LEGACY_SESSION_POLICY = `
  create policy "Recruiters can manage organization sessions" on public.sessions for all to authenticated
    using (exists(select 1 from public.organization_members m where m.organization_id=sessions.organization_id and m.user_id=auth.uid()))
    with check (exists(select 1 from public.organization_members m where m.organization_id=sessions.organization_id and m.user_id=auth.uid()));
`;

test('readiness migration on synthetic PostgreSQL schema', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema private;
    create table auth.users (id uuid primary key, email text, is_anonymous boolean not null default false);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select jsonb_build_object('is_anonymous', coalesce(nullif(current_setting('request.jwt.claim.is_anonymous', true), ''), 'true')::boolean) $$;
    create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null);
    create table public.organization_members (
      organization_id uuid references public.organizations(id), user_id uuid references auth.users(id),
      role text not null, primary key (organization_id,user_id)
    );
    create table public.sessions (
      id text primary key, internal_id uuid not null unique default gen_random_uuid(), join_code text unique,
      candidate_link text, status text, flags jsonb, transcript jsonb,
      recruiter_id uuid references auth.users(id), organization_id uuid references public.organizations(id),
      candidate_name text, role_title text, technical_vocabulary text[] not null default '{}',
      policy_preset text not null default 'standard_technical', allowed_apps text[], allowed_sites text[], blocked_sites text[],
      blocking_mode text, expires_at timestamptz, retention_until timestamptz, ended_at timestamptz
    );
    create table public.session_participants (
      session_id uuid references public.sessions(internal_id), user_id uuid references auth.users(id),
      participant_role text, candidate_name text, expires_at timestamptz, primary key (session_id,user_id)
    );
    create table public.session_notes (id int primary key, session_id uuid references public.sessions(internal_id), body text);
    create function private.is_org_member(org uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.organization_members where organization_id=org and user_id=auth.uid()) $$;
    create function private.can_access_session(target uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.sessions s where s.internal_id=target and
        (s.recruiter_id=auth.uid() or exists(select 1 from public.session_participants p
          where p.session_id=target and p.user_id=auth.uid() and p.expires_at>now()))) $$;
    create function private.is_session_recruiter(target uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.sessions where internal_id=target and recruiter_id=auth.uid()) $$;
    alter table public.sessions enable row level security;
    create policy "recruiters manage sessions" on public.sessions for all to authenticated
      using (recruiter_id=auth.uid() or private.is_org_member(organization_id))
      with check (recruiter_id=auth.uid() or private.is_org_member(organization_id));
    create policy "session participants read sessions" on public.sessions for select to authenticated
      using (private.can_access_session(internal_id));
    ${LEGACY_SESSION_POLICY}
    alter table public.session_notes enable row level security;
    create policy "session access notes" on public.session_notes for all to authenticated
      using (private.can_access_session(session_id)) with check (private.can_access_session(session_id));
    create policy "recruiters manage session notes" on public.session_notes for all to authenticated
      using (private.is_session_recruiter(session_id)) with check (private.is_session_recruiter(session_id));
    grant usage on schema public,auth,private to anon,authenticated,service_role;
    grant all on public.sessions, public.session_notes to authenticated;
    grant select on public.organization_members to authenticated;
    insert into auth.users values
      ('${RECRUITER}','recruiter@example.test',false), ('${CANDIDATE}',null,true), ('${OTHER}',null,true);
  `);
  assert.equal((await db.query("select count(*)::int as count from pg_policies where schemaname='public' and tablename='sessions' and policyname='Recruiters can manage organization sessions'")).rows[0].count, 1);
  await db.exec(migration);
  await db.exec(migration); // Deliberate idempotency check.
  t.beforeEach(() => db.exec('truncate public.session_notes, public.session_participants, public.sessions, public.organization_members, public.organizations'));
  const asRole = (role, sql, params = [], user = CANDIDATE, anonymous = true) => db.transaction(async tx => {
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.is_anonymous',$2,true)", [user, String(anonymous)]);
    await tx.exec(`set local role ${role}`);
    return tx.query(sql, params);
  });
  const create = async (code = 'TRV-AAAAAA', user = RECRUITER, role = 'service_role') =>
    (await asRole(role, 'select public.create_recruiter_session($1,$2,$3) as result', [user, 'Synthetic workspace', {
      id: code, candidate_link: `https://truveil-secure.vercel.app/?code=${code}&open=1`,
      candidate_name: 'Synthetic candidate', role_title: 'Developer', technical_vocabulary: ['TypeScript'],
      allowed_apps: ['editor'], allowed_sites: [], blocked_sites: [],
    }])).rows[0].result;
  const join = async (user = CANDIDATE, role = 'service_role') =>
    (await asRole(role, 'select public.claim_candidate_session($1,$2,$3) as result', ['TRV-AAAAAA', user, 'Synthetic'])).rows[0].result;
  const count = async table => (await db.query(`select count(*)::int as count from public.${table}`)).rows[0].count;
  const transition = async (session, state = 'interrupted', user = CANDIDATE, role = 'service_role', expiry = new Date(Date.now() + 3600000).toISOString()) =>
    (await asRole(role, 'select public.transition_candidate_session($1,$2,$3,$4) as result', [session, user, state, expiry])).rows[0].result;

  await t.test('state transition RPC is service-only and cannot impersonate a candidate', async () => {
    const { session } = await create();
    await join();
    for (const role of ['anon', 'authenticated']) await assert.rejects(transition(session.internal_id, 'interrupted', CANDIDATE, role), e => e.code === '42501');
    assert.equal((await transition(session.internal_id, 'interrupted', OTHER)).status_code, 403);
    assert.equal((await transition(session.internal_id, 'interrupted', RECRUITER)).status_code, 403);
  });

  await t.test('state transition atomically preserves lifecycle and records candidate interruption', async () => {
    const { session } = await create();
    await join();
    for (const current of ['waiting', 'candidate_ready', 'active', 'completed', 'cancelled', 'interrupted']) {
      for (const next of ['candidate_ready', 'interrupted']) {
        await db.query('update public.sessions set status=$1,ended_at=null', [current]);
        const result = await transition(session.internal_id, next);
        const allowed = next === 'candidate_ready' ? ['waiting', 'candidate_ready'] : ['candidate_ready', 'active'];
        assert.equal(Boolean(result.ok), allowed.includes(current), `${current} -> ${next}`);
        const row = (await db.query('select status,ended_at from public.sessions')).rows[0];
        assert.equal(row.status, allowed.includes(current) ? next : current);
        assert.equal(Boolean(row.ended_at), allowed.includes(current) && next === 'interrupted');
      }
    }
  });

  await t.test('revocation after an edge-style initial read denies the atomic transition', async () => {
    const { session } = await create();
    await join();
    assert.equal((await db.query('select * from public.session_participants where user_id=$1', [CANDIDATE])).rows.length, 1);
    await db.query('delete from public.session_participants where user_id=$1', [CANDIDATE]);
    assert.equal((await transition(session.internal_id)).status_code, 403);
    assert.equal((await db.query('select status from public.sessions')).rows[0].status, 'candidate_ready');
  });

  await t.test('membership, session and signed-token expiry are rechecked inside the transition', async () => {
    const { session } = await create();
    await join();
    for (const table of ['session_participants', 'sessions']) {
      for (const expiry of [null, new Date(Date.now() - 1000).toISOString()]) {
        await db.query(`update public.${table} set expires_at=$1`, [expiry]);
        assert.equal((await transition(session.internal_id)).status_code, 410);
        await db.exec(`update public.${table} set expires_at=now()+interval '1 hour'`);
      }
    }
    assert.equal((await transition(session.internal_id, 'interrupted', CANDIDATE, 'service_role', new Date(Date.now() - 1000).toISOString())).status_code, 410);
    assert.equal((await db.query('select status from public.sessions')).rows[0].status, 'candidate_ready');
  });

  await t.test('state authorization uses wall-clock time even inside an older transaction', async () => {
    const { session } = await create();
    await join();
    await db.transaction(async tx => {
      await tx.exec("update public.session_participants set expires_at=clock_timestamp()+interval '40 milliseconds' where participant_role='candidate'");
      await new Promise(resolve => setTimeout(resolve, 70));
      await tx.exec('set local role service_role');
      const row = (await tx.query('select public.transition_candidate_session($1,$2,$3,clock_timestamp()+interval \'1 hour\') as result', [session.internal_id, CANDIDATE, 'interrupted'])).rows[0];
      assert.equal(row.result.status_code, 410);
    });
    assert.match(migration, /for share;/i);
  });

  await t.test('RPC permissions reject direct anonymous and authenticated impersonation', async () => {
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(create('TRV-AAAAAA', RECRUITER, role), e => e.code === '42501');
      await assert.rejects(join(RECRUITER, role), e => e.code === '42501');
    }
    assert.equal(await count('sessions'), 0);
    assert.equal((await create('TRV-AAAAAA', CANDIDATE)).status_code, 401);
    assert.equal(await count('organizations'), 0);
  });

  await t.test('anonymous direct-table caller cannot escalate into recruiter ownership', async () => {
    await assert.rejects(asRole('authenticated', 'insert into public.sessions(id,recruiter_id) values ($1,$2)', ['TRV-FAKE00', CANDIDATE]), e => e.code === '42501');
  });

  await t.test('creation atomically produces an owned session and recruiter membership', async () => {
    const result = await create();
    assert.equal(result.session.recruiter_id, RECRUITER);
    assert.equal(result.session.status, 'waiting');
    assert.ok(result.session.organization_id);
    assert.equal(await count('organizations'), 1);
    const participants = (await db.query('select * from public.session_participants')).rows;
    assert.equal(participants[0].participant_role, 'recruiter');
    assert.equal(new Date(participants[0].expires_at).getTime(), new Date(result.session.expires_at).getTime());
  });

  await t.test('competing first-use requests reuse one workspace', async () => {
    // PGlite queues one backend. This checks submitted overlapping requests,
    // not multi-connection contention; the transaction advisory lock is explicit.
    assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(recruiter_user::text, 0\)\)/);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create(`TRV-AAAAA${i}`)));
    assert.equal(new Set(results.map(r => r.session.organization_id)).size, 1);
    assert.equal(await count('organizations'), 1);
    assert.equal(await count('organization_members'), 1);
    assert.equal(await count('sessions'), 8);
  });

  await t.test('participant failure rolls back new workspace, membership, and session', async () => {
    await db.exec(`create function public.fail_participant_test() returns trigger language plpgsql as $$
      begin raise exception 'injected membership failure'; end $$;
      create trigger fail_participant_test before insert on public.session_participants
      for each row execute function public.fail_participant_test();`);
    try {
      await assert.rejects(create(), /injected membership failure/);
      for (const table of ['organizations', 'organization_members', 'sessions', 'session_participants']) assert.equal(await count(table), 0, table);
    } finally {
      await db.exec('drop trigger fail_participant_test on public.session_participants; drop function public.fail_participant_test()');
    }
  });

  await t.test('duplicate code failure does not create a second workspace for another recruiter', async () => {
    await create();
    await db.query('update auth.users set email=$1,is_anonymous=false where id=$2', ['other@example.test', OTHER]);
    try {
      await assert.rejects(create('TRV-AAAAAA', OTHER), e => e.code === '23505');
      assert.equal(await count('organizations'), 1);
      assert.equal(await count('organization_members'), 1);
    } finally {
      await db.query('update auth.users set email=null,is_anonymous=true where id=$1', [OTHER]);
    }
  });

  await t.test('reviewer-only workspace identity cannot create or self-promote', async () => {
    const org = (await db.query("insert into public.organizations(name) values ('Synthetic') returning id")).rows[0].id;
    await db.query("insert into public.organization_members values($1,$2,'reviewer')", [org, RECRUITER]);
    assert.equal((await create()).status_code, 403);
    assert.equal(await count('sessions'), 0);
    assert.equal(await count('organizations'), 1);
    await assert.rejects(asRole('authenticated', 'insert into public.sessions(id,recruiter_id,organization_id) values ($1,$2,$3)',
      ['TRV-FAKE00', RECRUITER, org], RECRUITER, false), e => e.code === '42501');
  });

  await t.test('recruiter can cancel owned workspace session but cannot move it to another workspace', async () => {
    await create();
    const result = await asRole('authenticated', "update public.sessions set status='cancelled' returning status", [], RECRUITER, false);
    assert.equal(result.rows[0].status, 'cancelled');
    const otherOrg = (await db.query("insert into public.organizations(name) values('Other synthetic workspace') returning id")).rows[0].id;
    await assert.rejects(asRole('authenticated', 'update public.sessions set organization_id=$1', [otherOrg], RECRUITER, false), e => e.code === '42501');
  });

  await t.test('legacy permissive policy bypass is reproduced then removed by the migration', async () => {
    const { session } = await create();
    await db.query("update public.organization_members set role='reviewer' where user_id=$1", [RECRUITER]);
    await db.query("insert into public.organization_members values($1,$2,'owner')", [session.organization_id, CANDIDATE]);
    await db.exec(LEGACY_SESSION_POLICY);
    try {
      assert.equal((await asRole('authenticated', "update public.sessions set status='cancelled' returning id", [], RECRUITER, false)).rows.length, 1,
        'legacy policy ORs around the hardened policy for a reviewer');
      assert.equal((await asRole('authenticated', 'insert into public.sessions(id,recruiter_id,organization_id) values($1,$2,$3) returning id',
        ['TRV-LEGACY', CANDIDATE, session.organization_id])).rows.length, 1, 'legacy policy permits anonymous workspace member writes');
    } finally {
      await db.exec(migration);
    }
    for (const [user, anonymous] of [[RECRUITER, false], [CANDIDATE, true]]) {
      await assert.rejects(asRole('authenticated', 'insert into public.sessions(id,recruiter_id,organization_id) values($1,$2,$3)',
        ['TRV-DENIED', user, session.organization_id], user, anonymous), e => e.code === '42501');
      assert.equal((await asRole('authenticated', "update public.sessions set status='active' returning id", [], user, anonymous)).rows.length, 0);
      assert.equal((await asRole('authenticated', 'delete from public.sessions returning id', [], user, anonymous)).rows.length, 0);
    }
    assert.equal(await count('sessions'), 2, 'denied mutations leave existing sessions unchanged');
  });

  await t.test('join returns current state and caps candidate expiry to the session', async () => {
    await create();
    await db.exec("update public.sessions set expires_at=now()+interval '20 minutes'");
    const result = await join();
    assert.equal(result.session.status, 'candidate_ready');
    const expiry = (await db.query('select expires_at from public.sessions')).rows[0].expires_at;
    assert.equal(new Date(result.expires_at).getTime(), new Date(expiry).getTime());
    assert.equal(result.session.transcript, undefined);
    assert.equal(result.session.flags, undefined);
  });

  await t.test('only the original candidate reconnects and active state is preserved', async () => {
    await create();
    await join();
    await db.exec("update public.sessions set status='active'");
    assert.equal((await join()).session.status, 'active');
    assert.equal((await join(OTHER)).status_code, 409);
    assert.equal((await db.query('select status from public.sessions')).rows[0].status, 'active');
  });

  await t.test('recruiter/reviewer membership cannot be overwritten as candidate', async () => {
    const { session } = await create();
    assert.equal((await join(RECRUITER)).status_code, 409);
    await db.query("insert into public.session_participants values ($1,$2,'reviewer',null,now()+interval '1 hour')", [session.internal_id, CANDIDATE]);
    assert.equal((await join()).status_code, 409);
    assert.equal((await db.query("select participant_role from public.session_participants where user_id=$1", [CANDIDATE])).rows[0].participant_role, 'reviewer');
  });

  await t.test('overlapping claims allow one candidate and unique index blocks bypass', async () => {
    const { session } = await create();
    const outcomes = await Promise.all([join(), join(OTHER)]);
    assert.equal(outcomes.filter(r => r.session).length, 1);
    assert.equal(outcomes.filter(r => r.status_code === 409).length, 1);
    await assert.rejects(db.query("insert into public.session_participants values ($1,$2,'candidate',null,now()+interval '1 hour')", [session.internal_id, OTHER]), e => e.code === '23505');
  });

  await t.test('terminal, expired, and unclaimed active sessions refuse new claims', async () => {
    await create();
    for (const status of ['completed', 'cancelled', 'interrupted', 'active']) {
      await db.query('update public.sessions set status=$1', [status]);
      assert.equal((await join()).status_code, 409, status);
    }
    await db.exec("update public.sessions set status='waiting',expires_at=now()-interval '1 second'");
    assert.equal((await join()).status_code, 410);
    assert.equal(await count('session_participants'), 1);
  });

  await t.test('candidate cannot read or edit recruiter notes; recruiter access remains', async () => {
    const { session } = await create();
    await join();
    await db.query('insert into public.session_notes values(1,$1,$2)', [session.internal_id, 'Synthetic recruiter note']);
    assert.equal((await asRole('authenticated', 'select * from public.session_notes')).rows.length, 0);
    await assert.rejects(asRole('authenticated', 'insert into public.session_notes values(2,$1,$2)', [session.internal_id, 'Forbidden']), e => e.code === '42501');
    assert.equal((await asRole('authenticated', "update public.session_notes set body='Forbidden' returning id")).rows.length, 0);
    assert.equal((await asRole('authenticated', 'delete from public.session_notes returning id')).rows.length, 0);
    assert.equal((await asRole('authenticated', 'select * from public.session_notes', [], RECRUITER, false)).rows.length, 1);
    assert.equal((await asRole('authenticated', "update public.session_notes set body='Reviewed' returning id", [], RECRUITER, false)).rows.length, 1);
    assert.equal((await asRole('authenticated', 'select * from public.sessions')).rows.length, 1, 'candidate session read remains available');
  });
});
