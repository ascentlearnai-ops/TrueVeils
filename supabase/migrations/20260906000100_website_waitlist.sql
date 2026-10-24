-- Website-only storage. Does not grant anonymous access or change interview tables.
begin;

create table public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  audience text not null check (audience in ('recruiter', 'candidate')),
  name text check (length(name) <= 100),
  company text check (length(company) <= 160),
  consent boolean not null check (consent is true),
  consent_version text not null default 'waitlist-v1',
  source_origin text not null check (length(source_origin) <= 2048),
  created_at timestamptz not null default now(),
  unique (email, audience)
);

create table public.waitlist_rate_limits (
  rate_key text primary key check (rate_key ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 5)
);
create index waitlist_rate_limits_expiry on public.waitlist_rate_limits (window_started_at);

alter table public.waitlist_signups enable row level security;
alter table public.waitlist_rate_limits enable row level security;
revoke all on public.waitlist_signups, public.waitlist_rate_limits from public, anon, authenticated, service_role;

create function public.register_waitlist_signup(
  p_email text,
  p_name text,
  p_company text,
  p_audience text,
  p_consent boolean,
  p_source_origin text,
  p_rate_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window timestamptz;
  v_attempts integer;
begin
  if p_email is null or p_email <> lower(btrim(p_email))
    or length(p_email) not between 3 and 254
    or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_audience is null or p_audience not in ('recruiter', 'candidate')
    or p_consent is distinct from true
    or length(p_name) > 100 or length(p_company) > 160
    or coalesce(p_name, '') ~ '[[:cntrl:]]' or coalesce(p_company, '') ~ '[[:cntrl:]]'
    or p_source_origin is null or length(p_source_origin) > 2048
    or p_source_origin !~ '^https?://[^/[:space:]]+$'
    or p_rate_key is null or p_rate_key !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid waitlist submission' using errcode = '22023';
  end if;

  -- The row lock makes the shared 5-per-15-minute limit atomic across both sites.
  insert into public.waitlist_rate_limits as limits (rate_key, window_started_at, attempts)
  values (p_rate_key, v_now, 1)
  on conflict (rate_key) do update
  set window_started_at = case when limits.window_started_at <= v_now - interval '15 minutes'
        then v_now else limits.window_started_at end,
      attempts = case when limits.window_started_at <= v_now - interval '15 minutes'
        then 1 else limits.attempts + 1 end
  where limits.window_started_at <= v_now - interval '15 minutes' or limits.attempts < 5
  returning window_started_at, attempts into v_window, v_attempts;

  if v_attempts is null then
    select window_started_at into v_window from public.waitlist_rate_limits where rate_key = p_rate_key;
    return jsonb_build_object('accepted', false, 'retry_after',
      greatest(1, least(900, ceil(extract(epoch from v_window + interval '15 minutes' - v_now))::integer)));
  end if;

  -- Existing signups count as stored, without exposing membership or overwriting details.
  insert into public.waitlist_signups (email, audience, name, company, consent, source_origin)
  values (p_email, p_audience, nullif(btrim(p_name), ''), nullif(btrim(p_company), ''), true, p_source_origin)
  on conflict (email, audience) do nothing;

  -- Bound housekeeping work; raw client IPs are never stored.
  delete from public.waitlist_rate_limits where rate_key in (
    select rate_key from public.waitlist_rate_limits
    where window_started_at < v_now - interval '1 day'
    order by window_started_at limit 1000 for update skip locked
  ) and window_started_at < v_now - interval '1 day';
  return jsonb_build_object('accepted', true, 'retry_after', 0);
end;
$$;

revoke all on function public.register_waitlist_signup(text, text, text, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.register_waitlist_signup(text, text, text, text, boolean, text, text)
  to service_role;

notify pgrst, 'reload schema';
commit;
