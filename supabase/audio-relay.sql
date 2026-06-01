-- Truveil audio relay storage + metadata
-- Apply in Supabase SQL editor for the project that both Electron apps use.

create table if not exists public.audio_chunks (
  id text primary key,
  session_id text not null references public.sessions(id) on delete cascade,
  storage_path text not null unique,
  sequence integer not null default 0,
  duration_ms integer,
  mime_type text not null default 'audio/webm',
  size_bytes integer not null default 0,
  peak numeric,
  rms numeric,
  status text not null default 'uploaded',
  transcript text,
  score integer,
  reasoning text,
  flags jsonb not null default '[]'::jsonb,
  source text,
  created_at timestamptz not null default now(),
  transcribed_at timestamptz,
  cleaned_at timestamptz,
  constraint audio_chunks_storage_path_session_check check (storage_path like session_id || '/%'),
  constraint audio_chunks_status_check check (status in ('uploading','uploaded','received','transcribing','transcribed','failed','deleted','transcribed_deleted','failed_deleted')),
  constraint audio_chunks_score_check check (score is null or (score >= 0 and score <= 100))
);

alter table public.audio_chunks
  add column if not exists source text;

alter table public.audio_chunks
  drop constraint if exists audio_chunks_status_check;

alter table public.audio_chunks
  add constraint audio_chunks_status_check
  check (status in ('uploading','uploaded','received','transcribing','transcribed','failed','deleted','transcribed_deleted','failed_deleted'));

create index if not exists audio_chunks_session_sequence_idx on public.audio_chunks(session_id, sequence);
create index if not exists audio_chunks_created_idx on public.audio_chunks(created_at desc);

alter table public.audio_chunks enable row level security;

drop policy if exists "Truveil audio chunks access by session" on public.audio_chunks;
create policy "Truveil audio chunks access by session"
  on public.audio_chunks
  for all
  to anon, authenticated
  using (exists (select 1 from public.sessions s where s.id = audio_chunks.session_id))
  with check (exists (select 1 from public.sessions s where s.id = audio_chunks.session_id));

grant select, insert, update, delete on public.audio_chunks to anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-audio',
  'session-audio',
  false,
  10485760,
  array['audio/webm', 'audio/ogg', 'audio/wav', 'application/octet-stream']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Truveil session audio insert" on storage.objects;
drop policy if exists "Truveil session audio select" on storage.objects;
drop policy if exists "Truveil session audio delete" on storage.objects;

create policy "Truveil session audio insert"
  on storage.objects
  for insert
  to anon, authenticated
  with check (
    bucket_id = 'session-audio'
    and exists (select 1 from public.sessions s where s.id = (storage.foldername(name))[1])
  );

create policy "Truveil session audio select"
  on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'session-audio'
    and exists (select 1 from public.sessions s where s.id = (storage.foldername(name))[1])
  );

create policy "Truveil session audio delete"
  on storage.objects
  for delete
  to anon, authenticated
  using (
    bucket_id = 'session-audio'
    and exists (select 1 from public.sessions s where s.id = (storage.foldername(name))[1])
  );

do $$
begin
  alter publication supabase_realtime add table public.audio_chunks;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
