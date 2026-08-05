-- AQope · arquitectura propuesta de Producción
-- REVISAR Y EJECUTAR MANUALMENTE únicamente cuando se autorice.
-- La aplicación no ejecuta este archivo. No contiene borrado físico ni vigencias.

-- Fabricación conserva su fuente de verdad en la variante de Nomenclaturas.
alter table public.nomenclature_variants
  add column if not exists manufacturing_rate_per_hour_person numeric(14,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='nomenclature_variants_manufacturing_rate_positive'
      and conrelid='public.nomenclature_variants'::regclass
  ) then
    alter table public.nomenclature_variants
      add constraint nomenclature_variants_manufacturing_rate_positive
      check (manufacturing_rate_per_hour_person is null or manufacturing_rate_per_hour_person>0);
  end if;
end;
$$;

create or replace function public.set_production_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

-- Colección maestra única. Las cuatro actividades base se distinguen mediante
-- special_kind; cualquier otra tarea puede cambiar entre principal y satélite.
create table if not exists public.production_tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique check (btrim(task_code)<>''),
  task_name text not null check (btrim(task_name)<>''),
  activity_type text not null check (activity_type in ('principal','satelite')),
  special_kind text unique
    check (special_kind is null or special_kind in ('reception','preassignment','manufacturing','shipping')),
  active boolean not null default true,
  calculation_type text
    check (calculation_type is null or calculation_type in ('por_cantidad','tiempo_fijo')),
  performance_per_hour_person numeric(14,4)
    check (performance_per_hour_person is null or performance_per_hour_person>0),
  fixed_person_hours numeric(14,4)
    check (fixed_person_hours is null or fixed_person_hours>0),
  frequency text,
  priority text not null default 'Media' check (priority in ('Baja','Media','Alta')),
  mobility text not null default 'Flexible' check (mobility in ('Fija','Flexible')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check (
    (special_kind is not null and activity_type='principal' and calculation_type is null
      and performance_per_hour_person is null and fixed_person_hours is null)
    or
    (special_kind is null and calculation_type='por_cantidad'
      and performance_per_hour_person is not null and fixed_person_hours is null)
    or
    (special_kind is null and calculation_type='tiempo_fijo'
      and fixed_person_hours is not null and performance_per_hour_person is null)
  )
);

create unique index if not exists production_tasks_code_normalized_key
  on public.production_tasks (upper(btrim(task_code)));
create index if not exists production_tasks_type_active_idx
  on public.production_tasks (activity_type,active,task_name);

-- Rendimientos actuales de Recepción y Preasignación por categoría.
create table if not exists public.production_category_times (
  product_category text primary key check (btrim(product_category)<>''),
  reception_rate_per_hour_person numeric(14,4)
    check (reception_rate_per_hour_person is null or reception_rate_per_hour_person>0),
  preassignment_rate_per_hour_person numeric(14,4)
    check (preassignment_rate_per_hour_person is null or preassignment_rate_per_hour_person>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

-- Rendimiento global actual de Expedición.
create table if not exists public.production_settings (
  id text primary key default 'global' check (id='global'),
  shipping_rate_per_hour_person numeric(14,4)
    check (shipping_rate_per_hour_person is null or shipping_rate_per_hour_person>0),
  distribution_settings jsonb not null default '{"recentWeights":[40,30,20,10],"recentShare":70,"comparableShare":30}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

-- Una fila por año y semana. Guarda decisiones y trazabilidad de la propuesta,
-- pero no duplica tareas, compras, campañas ni rendimientos maestros.
create table if not exists public.production_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  planning_year integer not null check (planning_year between 2000 and 2200),
  planning_week integer not null check (planning_week between 1 and 53),
  status text not null default 'draft' check (status in ('draft','validated')),
  annual_forecast numeric(14,4) check (annual_forecast is null or annual_forecast>=0),
  production_adjustment numeric(14,4) not null default 0,
  automatic_distribution jsonb not null default '{}'::jsonb,
  distribution_references jsonb not null default '[]'::jsonb,
  distribution_context jsonb not null default '{}'::jsonb,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (planning_year,planning_week),
  check ((status='validated' and validated_at is not null) or status='draft')
);

-- Distribución diaria propuesta/ajustada y día decidido de Preasignación.
create table if not exists public.production_weekly_days (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  expedition_day smallint not null check (expedition_day between 1 and 7),
  proposed_percent numeric(7,4) not null default 0 check (proposed_percent between 0 and 100),
  planned_expeditions numeric(14,4) not null default 0 check (planned_expeditions>=0),
  manually_adjusted boolean not null default false,
  preassignment_day smallint not null check (preassignment_day between 1 and 7),
  unique (plan_id,expedition_day)
);

create table if not exists public.production_weekly_category_mix (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  expedition_day smallint not null check (expedition_day between 1 and 7),
  product_category text not null check (btrim(product_category)<>''),
  planned_units numeric(14,4) not null check (planned_units>=0),
  unique (plan_id,expedition_day,product_category)
);

-- El rendimiento se consulta siempre en nomenclature_variants.
create table if not exists public.production_weekly_variant_mix (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  product_id uuid not null references public.nomenclature_products(id),
  variant_id uuid not null references public.nomenclature_variants(id),
  expedition_day smallint not null check (expedition_day between 1 and 7),
  planned_units numeric(14,4) not null check (planned_units>=0),
  unique (plan_id,expedition_day,variant_id)
);

-- Selecciones semanales de tareas generales. Las cuatro actividades base no
-- necesitan filas aquí porque sus cargas proceden de sus fuentes operativas.
create table if not exists public.production_weekly_task_assignments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  task_id uuid not null references public.production_tasks(id),
  assigned_day smallint check (assigned_day between 1 and 7),
  automatic_assignment boolean not null default false,
  planned_quantity numeric(14,4) check (planned_quantity is null or planned_quantity>=0),
  unique (plan_id,task_id),
  check ((automatic_assignment and assigned_day is null) or not automatic_assignment)
);

-- Historial simple e informativo; nunca interviene en los cálculos.
create table if not exists public.production_change_history (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null check (btrim(entity_key)<>''),
  field_name text not null check (btrim(field_name)<>''),
  previous_value text,
  new_value text,
  comment text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);

create index if not exists production_weekly_days_plan_idx on public.production_weekly_days(plan_id);
create index if not exists production_weekly_category_mix_plan_idx on public.production_weekly_category_mix(plan_id,expedition_day);
create index if not exists production_weekly_variant_mix_plan_idx on public.production_weekly_variant_mix(plan_id,expedition_day);
create index if not exists production_weekly_task_assignments_plan_idx on public.production_weekly_task_assignments(plan_id);
create index if not exists production_change_history_entity_idx on public.production_change_history(entity_key,changed_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array['production_tasks','production_category_times','production_settings','production_weekly_plans'] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I',table_name,table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_production_updated_at()',table_name,table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'production_tasks','production_category_times','production_settings','production_weekly_plans',
    'production_weekly_days','production_weekly_category_mix','production_weekly_variant_mix',
    'production_weekly_task_assignments','production_change_history'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists %I_select_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_select_authenticated on public.%I for select to authenticated using (true)',table_name,table_name);
    execute format('drop policy if exists %I_insert_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_insert_authenticated on public.%I for insert to authenticated with check (true)',table_name,table_name);
    execute format('drop policy if exists %I_update_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_update_authenticated on public.%I for update to authenticated using (true) with check (true)',table_name,table_name);
    execute format('grant select,insert,update on public.%I to authenticated',table_name);
  end loop;
end;
$$;

comment on table public.production_tasks is 'Colección maestra única de actividades principales y satélite.';
comment on table public.production_weekly_plans is 'Decisiones y referencias de la planificación semanal de Producción.';
comment on table public.production_change_history is 'Historial informativo; no interviene en cálculos.';
