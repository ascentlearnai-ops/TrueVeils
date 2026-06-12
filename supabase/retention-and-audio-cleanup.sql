-- Paid-beta retention maintenance.
-- Raw fallback audio is removed by the processing path; this job marks stale
-- metadata clearly and removes expired report/session records.

create extension if not exists pg_cron;

create or replace function private.cleanup_truveil_retention()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.audio_chunks
    set status = 'failed_deleted',
        reasoning = coalesce(reasoning, 'Stale fallback audio metadata cleaned after processing timeout.')
    where status in ('uploaded', 'transcribing', 'failed')
      and created_at < now() - interval '15 minutes';

  update public.audio_chunks
    set status = 'transcribed_deleted'
    where status = 'transcribed'
      and created_at < now() - interval '15 minutes';

  delete from public.audio_chunks
    where created_at < now() - interval '30 days';

  delete from public.reports where retention_until < now();
  delete from public.sessions where retention_until < now();
end;
$$;

select cron.schedule(
  'truveil-retention-cleanup',
  '17 3 * * *',
  $$select private.cleanup_truveil_retention();$$
);

select private.cleanup_truveil_retention();
