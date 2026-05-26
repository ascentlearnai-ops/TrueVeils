alter table if exists public.sessions
  add column if not exists allowed_apps text[] default array[]::text[],
  add column if not exists allowed_sites text[] default array[]::text[],
  add column if not exists blocked_sites text[] default array[]::text[],
  add column if not exists blocking_mode text default 'warn_refocus';
