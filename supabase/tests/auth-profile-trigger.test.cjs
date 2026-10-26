'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const migration = fs.readFileSync(path.join(__dirname, '../migrations/20261024000200_auth_profile_search_path.sql'), 'utf8');
const id = suffix => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

test('shared profile trigger search-path repair on synthetic PostgreSQL schema', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role auth_writer;
    create role profile_function_owner;
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users (
      id uuid primary key, raw_user_meta_data jsonb, is_anonymous boolean not null default false
    );
    create table public.profiles (
      id uuid primary key references auth.users(id), tier text not null,
      display_name text not null, study_metadata jsonb not null default '{"progress":0}'::jsonb
    );
    insert into auth.users values ('${id(1)}', '{}', false);
    insert into public.profiles values ('${id(1)}', 'Existing tier', 'Existing learner', '{"progress":42}');
    grant usage on schema auth to auth_writer;
    grant insert, select on auth.users to auth_writer;
    grant usage on schema public, auth to profile_function_owner;
    grant insert on public.profiles to profile_function_owner;

    -- Exact original function body from the read-only production definition.
    create function public.handle_new_user() returns trigger language plpgsql security definer as $$
    BEGIN
      INSERT INTO profiles (id, tier, display_name)
      VALUES (NEW.id, 'Initiate', COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'));
      RETURN NEW;
    END;
    $$;
    alter function public.handle_new_user() owner to profile_function_owner;
    grant execute on function public.handle_new_user() to public, anon, authenticated, service_role;
    create trigger on_auth_user_created after insert on auth.users
      for each row execute function public.handle_new_user();
  `);

  const functionMetadata = async () => (await db.query(`
    select p.oid, p.proowner, p.proacl::text as acl, p.prosecdef, p.proconfig,
      p.prorettype::regtype::text as return_type, l.lanname as language
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      join pg_language l on l.oid=p.prolang
    where n.nspname='public' and p.proname='handle_new_user' and p.pronargs=0
  `)).rows[0];
  const triggerMetadata = async () => (await db.query(`
    select oid, tgfoid, tgenabled, pg_get_triggerdef(oid) as definition
    from pg_trigger where tgrelid='auth.users'::regclass and tgname='on_auth_user_created'
  `)).rows[0];
  const beforeFunction = await functionMetadata();
  const beforeTrigger = await triggerMetadata();
  const existingProfile = (await db.query('select * from public.profiles where id=$1', [id(1)])).rows[0];

  const signup = (suffix, metadata = {}, anonymous = false, searchPath = 'pg_catalog, auth') => db.transaction(async tx => {
    await tx.exec('set local role auth_writer');
    await tx.query("select set_config('search_path', $1, true)", [searchPath]);
    return tx.query('insert into auth.users(id,raw_user_meta_data,is_anonymous) values($1,$2,$3) returning id',
      [id(suffix), metadata, anonymous]);
  });
  const profile = async suffix => (await db.query('select * from public.profiles where id=$1', [id(suffix)])).rows[0];

  await t.test('original trigger reproduces relation profiles does not exist and rolls back signup', async () => {
    await assert.rejects(signup(2, { full_name: 'Synthetic learner' }), e => e.code === '42P01' && /relation "profiles" does not exist/.test(e.message));
    assert.equal((await db.query('select id from auth.users where id=$1', [id(2)])).rows.length, 0);
    assert.equal(await profile(2), undefined);
  });

  await t.test('replacement pins search path while preserving function identity, owner, grants, trigger and existing data', async () => {
    await db.exec(migration);
    const after = await functionMetadata();
    assert.deepEqual(after.proconfig, ['search_path=pg_catalog']);
    assert.deepEqual({ ...after, proconfig: null }, beforeFunction);
    assert.deepEqual(await triggerMetadata(), beforeTrigger);
    assert.deepEqual(await profile(1), existingProfile);
    await db.exec(migration);
    assert.deepEqual(await functionMetadata(), after);
    assert.deepEqual(await triggerMetadata(), beforeTrigger);
  });

  await t.test('restricted Auth writer creates the same mandatory Ascent profile without direct profile permissions', async () => {
    const result = await signup(2, { full_name: 'Synthetic learner', tier: 'Ignored override' });
    assert.equal(result.rows[0].id, id(2));
    assert.deepEqual(await profile(2), {
      id: id(2), tier: 'Initiate', display_name: 'Synthetic learner', study_metadata: { progress: 0 },
    });
    const privileges = (await db.query("select has_table_privilege('auth_writer','public.profiles','INSERT') as can_insert")).rows[0];
    assert.equal(privileges.can_insert, false);
  });

  await t.test('anonymous-style signups with absent or null full_name still create default profiles', async () => {
    for (const [suffix, metadata] of [[3, {}], [4, null], [5, { full_name: null }]]) {
      await signup(suffix, metadata, true);
      const row = await profile(suffix);
      assert.equal(row.tier, 'Initiate');
      assert.equal(row.display_name, 'User');
      assert.deepEqual(row.study_metadata, { progress: 0 });
    }
  });

  await t.test('full_name coercion and empty-string behavior remain unchanged', async () => {
    for (const [suffix, value, expected] of [[6, '', ''], [7, 42, '42']]) {
      await signup(suffix, { full_name: value });
      assert.equal((await profile(suffix)).display_name, expected);
    }
  });

  await t.test('auth and temporary shadow profiles cannot capture the trigger insert', async () => {
    await db.exec(`
      create table auth.profiles (id uuid, tier text, display_name text);
      create temporary table profiles (id uuid, tier text, display_name text);
      grant insert on auth.profiles, pg_temp.profiles to profile_function_owner;
    `);
    await signup(8, { full_name: 'Correct public target' }, false, 'pg_temp, auth, pg_catalog');
    assert.equal((await profile(8)).display_name, 'Correct public target');
    assert.equal((await db.query('select count(*)::int as count from auth.profiles')).rows[0].count, 0);
    assert.equal((await db.query('select count(*)::int as count from pg_temp.profiles')).rows[0].count, 0);
  });

  await t.test('a real profile insertion error still aborts the Auth insert instead of skipping profile creation', async () => {
    await db.exec("alter table public.profiles add constraint synthetic_profile_failure check (display_name <> 'synthetic failure')");
    try {
      await assert.rejects(signup(9, { full_name: 'synthetic failure' }), e => e.code === '23514');
      assert.equal((await db.query('select id from auth.users where id=$1', [id(9)])).rows.length, 0);
      assert.equal(await profile(9), undefined);
    } finally {
      await db.exec('alter table public.profiles drop constraint synthetic_profile_failure');
    }
  });
});
