-- ============================================================
-- Lenzo Music — Supabase schema
-- Run once: Supabase Dashboard → SQL Editor → paste all → Run
-- One general table; db.json semantics preserved 1:1.
-- ============================================================ */

create table if not exists public.store (
  collection text not null,
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (collection, id)
);

alter table public.store enable row level security;

-- The app talks with the service_role key (server-side only),
-- which bypasses RLS. No public policies — the browser never
-- touches this table directly.

create index if not exists store_collection_idx on public.store (collection);

-- Keep updated_at fresh automatically.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists store_touch on public.store;
create trigger store_touch
  before insert or update on public.store
  for each row execute function public.touch_updated_at();
