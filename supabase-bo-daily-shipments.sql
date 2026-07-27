-- AQope · histórico BO diario
-- Ejecutar manualmente en Supabase SQL Editor después de revisar las políticas.
-- No modifica app_states y no contiene operaciones DELETE.

create extension if not exists pgcrypto;

create table if not exists public.bo_daily_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_date date not null,
  product_code text not null,
  product_type text,
  product_reference text not null,
  category text not null
    check (category in ('ROSAS', 'COMPUESTOS', 'SIMPLES', 'PLANTAS')),
  quantity integer not null default 0 check (quantity >= 0),
  source_label text,
  source_period_start date,
  source_period_end date,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bo_daily_shipments_date_product_key
    unique (shipment_date, product_code)
);

create index if not exists bo_daily_shipments_date_idx
  on public.bo_daily_shipments (shipment_date);

create index if not exists bo_daily_shipments_category_date_idx
  on public.bo_daily_shipments (category, shipment_date);

create or replace function public.set_bo_daily_shipments_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace trigger set_bo_daily_shipments_updated_at
before update on public.bo_daily_shipments
for each row execute function public.set_bo_daily_shipments_updated_at();

-- Registro de ejecuciones. La aplicación funciona aunque esta tabla opcional
-- no se cree, pero permite auditar importaciones completas y parciales.
create table if not exists public.bo_import_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_by uuid references auth.users(id) on delete set null,
  source_label text,
  period_start date,
  period_end date,
  records_processed integer not null default 0,
  records_inserted integer not null default 0,
  records_updated integer not null default 0,
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  error_message text
);

create index if not exists bo_import_runs_started_at_idx
  on public.bo_import_runs (started_at desc);

-- Políticas RLS propuestas. Revíselas antes de ejecutar esta sección.
-- Los usuarios autenticados pueden leer, insertar y actualizar.
-- No se crea ninguna política DELETE.
alter table public.bo_daily_shipments enable row level security;
alter table public.bo_import_runs enable row level security;

do $policies$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_daily_shipments'
      and policyname = 'Authenticated users read BO shipments'
  ) then
    create policy "Authenticated users read BO shipments"
      on public.bo_daily_shipments for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_daily_shipments'
      and policyname = 'Authenticated users insert BO shipments'
  ) then
    create policy "Authenticated users insert BO shipments"
      on public.bo_daily_shipments for insert to authenticated
      with check (auth.uid() = imported_by);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_daily_shipments'
      and policyname = 'Authenticated users update BO shipments'
  ) then
    create policy "Authenticated users update BO shipments"
      on public.bo_daily_shipments for update to authenticated
      using (true) with check (auth.uid() = imported_by);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_import_runs'
      and policyname = 'Authenticated users read BO import runs'
  ) then
    create policy "Authenticated users read BO import runs"
      on public.bo_import_runs for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_import_runs'
      and policyname = 'Authenticated users insert BO import runs'
  ) then
    create policy "Authenticated users insert BO import runs"
      on public.bo_import_runs for insert to authenticated
      with check (auth.uid() = imported_by);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'bo_import_runs'
      and policyname = 'Authenticated users update own BO import runs'
  ) then
    create policy "Authenticated users update own BO import runs"
      on public.bo_import_runs for update to authenticated
      using (auth.uid() = imported_by)
      with check (auth.uid() = imported_by);
  end if;
end
$policies$;

grant select, insert, update on public.bo_daily_shipments to authenticated;
grant select, insert, update on public.bo_import_runs to authenticated;
