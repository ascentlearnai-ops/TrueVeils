-- Shared Ascent profile bootstrap: preserve profile creation and trigger wiring.
-- CREATE OR REPLACE retains the existing function owner and execution grants.
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  insert into public.profiles (id, tier, display_name)
  values (NEW.id, 'Initiate', coalesce(NEW.raw_user_meta_data->>'full_name', 'User'));
  return NEW;
end;
$function$;

commit;
