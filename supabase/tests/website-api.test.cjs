'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../migrations/20260906000100_website_waitlist.sql'), 'utf8');
const signature = 'public.register_waitlist_signup(text,text,text,text,boolean,text,text)';
const statement = 'select public.register_waitlist_signup($1,$2,$3,$4,$5,$6,$7) as result';
const values = (overrides = {}) => {
  const input = { email: 'person@example.com', name: 'Original', company: 'Original company',
    audience: 'recruiter', consent: true, origin: 'https://truveil-recruiter.vercel.app',
    key: 'a'.repeat(64), ...overrides };
  return [input.email, input.name, input.company, input.audience, input.consent, input.origin, input.key];
};

test('actual waitlist migration on in-memory PostgreSQL via PGlite', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  // Reproduce Supabase's roles and permissive defaults so the migration must revoke them.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create role untrusted;
    grant usage on schema public to anon, authenticated, service_role, untrusted;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  await db.exec(migration);
  const asRole = (role, query, params = []) => db.transaction(async tx => {
    await tx.exec(`set local role ${role}`);
    return tx.query(query, params);
  });
  const signup = async (input, role = 'service_role') =>
    (await asRole(role, statement, values(input))).rows[0].result;
  t.beforeEach(() => db.exec('truncate public.waitlist_signups, public.waitlist_rate_limits'));

  await t.test('RLS and table permissions deny public, anonymous, authenticated and direct service access', async () => {
    const flags = await db.query("select relname, relrowsecurity from pg_class where relname in ('waitlist_signups','waitlist_rate_limits')");
    assert.equal(flags.rows.length, 2);
    assert.ok(flags.rows.every(row => row.relrowsecurity));
    for (const role of ['anon', 'authenticated', 'service_role', 'untrusted']) {
      for (const table of ['waitlist_signups', 'waitlist_rate_limits']) {
        const acl = await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') as allowed", [role, `public.${table}`]);
        assert.equal(acl.rows[0].allowed, false);
        await assert.rejects(asRole(role, `select * from public.${table}`), error => error.code === '42501');
      }
    }
    for (const role of ['anon', 'authenticated', 'untrusted']) {
      await assert.rejects(signup({}, role), error => error.code === '42501');
    }
    assert.equal((await db.query('select has_function_privilege($1,$2,$3) as allowed', ['service_role', signature, 'EXECUTE'])).rows[0].allowed, true);
    assert.deepEqual(await signup({}), { accepted: true, retry_after: 0 });
  });

  await t.test('duplicates preserve original consent/details and audiences remain distinct', async () => {
    await signup({});
    await signup({ name: 'Replacement', company: 'Replacement' });
    await signup({ audience: 'candidate' });
    const rows = (await db.query('select * from public.waitlist_signups order by audience')).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.name === 'Original' && row.company === 'Original company'));
    assert.ok(rows.every(row => row.consent && row.consent_version === 'waitlist-v1' && row.created_at));
  });

  await t.test('database validation rejects invalid input without consuming rate counters', async () => {
    for (const invalid of [{ email: 'NOT-NORMALIZED@example.com' }, { email: 'not-email' },
      { consent: false }, { consent: null }, { audience: 'admin' }, { name: 'x'.repeat(101) },
      { company: 'bad\ncompany' }, { key: 'raw-ip' }, { origin: 'not-origin' }]) {
      await assert.rejects(signup(invalid), error => error.code === '22023');
    }
    assert.equal((await db.query('select count(*)::int as count from public.waitlist_rate_limits')).rows[0].count, 0);
    assert.equal((await db.query('select count(*)::int as count from public.waitlist_signups')).rows[0].count, 0);
  });

  await t.test('simultaneously submitted calls accept exactly five and cap the stored rate counter', async () => {
    // PGlite queues its single backend connection; this is not a multi-backend lock-contention test.
    const submitted = Array.from({ length: 20 }, (_, i) => signup({ email: `burst${i}@example.com` }));
    const results = await Promise.all(submitted);
    assert.equal(results.filter(result => result.accepted).length, 5);
    assert.equal(results.filter(result => !result.accepted).length, 15);
    assert.ok(results.filter(result => !result.accepted).every(result => result.retry_after > 0 && result.retry_after <= 900));
    assert.equal((await db.query('select attempts from public.waitlist_rate_limits')).rows[0].attempts, 5);
    assert.equal((await db.query('select count(*)::int as count from public.waitlist_signups')).rows[0].count, 5);
  });

  await t.test('simultaneously submitted duplicate signups across rate identities store one row', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => signup({ key: i.toString(16).padStart(64, '0') })));
    assert.ok(results.every(result => result.accepted));
    assert.equal((await db.query('select count(*)::int as count from public.waitlist_signups')).rows[0].count, 1);
  });

  await t.test('expired windows reset and housekeeping removes at most 1000 stale entries', async () => {
    for (let i = 0; i < 5; i++) await signup({});
    await db.exec("update public.waitlist_rate_limits set window_started_at = now() - interval '16 minutes'");
    assert.equal((await signup({})).accepted, true);
    assert.equal((await db.query('select attempts from public.waitlist_rate_limits')).rows[0].attempts, 1);
    await db.exec(`insert into public.waitlist_rate_limits
      select repeat(md5(i::text),2), now() - interval '2 days', 1 from generate_series(1,1005) i`);
    await signup({});
    const stale = await db.query("select count(*)::int as count from public.waitlist_rate_limits where window_started_at < now() - interval '1 day'");
    assert.equal(stale.rows[0].count, 5);
  });

  await t.test('a signup storage error rolls back its rate-limit increment atomically', async () => {
    await db.exec(`create function public.fail_waitlist_test() returns trigger language plpgsql as $$
      begin raise exception 'injected storage failure'; end; $$;
      create trigger fail_waitlist_test before insert on public.waitlist_signups
      for each row execute function public.fail_waitlist_test();`);
    try {
      await assert.rejects(signup({}), /injected storage failure/);
      assert.equal((await db.query('select count(*)::int as count from public.waitlist_rate_limits')).rows[0].count, 0);
      assert.equal((await db.query('select count(*)::int as count from public.waitlist_signups')).rows[0].count, 0);
    } finally {
      await db.exec('drop trigger fail_waitlist_test on public.waitlist_signups; drop function public.fail_waitlist_test()');
    }
  });
});
