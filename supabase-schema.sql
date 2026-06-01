create table if not exists public.milk_village_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.milk_village_state enable row level security;

grant usage on schema public to anon;
grant select, insert, update on table public.milk_village_state to anon;

drop policy if exists "milk village state read" on public.milk_village_state;
drop policy if exists "milk village state insert" on public.milk_village_state;
drop policy if exists "milk village state update" on public.milk_village_state;

create policy "milk village state read"
on public.milk_village_state
for select
to anon
using (id = 'main');

create policy "milk village state insert"
on public.milk_village_state
for insert
to anon
with check (id = 'main');

create policy "milk village state update"
on public.milk_village_state
for update
to anon
using (id = 'main')
with check (id = 'main');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'milk_village_state'
  ) then
    alter publication supabase_realtime add table public.milk_village_state;
  end if;
end $$;
