-- AQope · propuesta relacional de Producción
-- REVISAR Y EJECUTAR MANUALMENTE cuando se autorice.
-- Este archivo no se ejecuta desde la aplicación y no contiene borrado físico.

-- FUENTE DE VERDAD DE FABRICACIÓN: variante de Nomenclaturas.
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

-- DATOS MAESTROS

-- Metadatos operativos de las cuatro tareas principales. No guarda rendimientos.
create table if not exists public.production_main_tasks (
  task_code text primary key
    check (task_code in ('RECEPTION','PREASSIGNMENT','MANUFACTURING','SHIPPING')),
  task_name text not null check (btrim(task_name)<>''),
  priority text not null default 'Media' check (priority in ('Baja','Media','Alta')),
  mobility text not null default 'Flexible' check (mobility in ('Fija','Flexible')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

-- Categorías reutilizadas desde la clasificación operativa de la aplicación.
-- No se fija aquí un catálogo paralelo ni una lista cerrada de categorías.
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

-- Fila única id='global'. Fuente de verdad del rendimiento de Expedición.
create table if not exists public.production_settings (
  id text primary key default 'global' check (id='global'),
  shipping_rate_per_hour_person numeric(14,4)
    check (shipping_rate_per_hour_person is null or shipping_rate_per_hour_person>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

-- Catálogo configurable exclusivamente para tareas satélite.
create table if not exists public.production_satellite_tasks (
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique check (btrim(task_code)<>''),
  task_name text not null check (btrim(task_name)<>''),
  active boolean not null default true,
  calculation_type text not null
    check (calculation_type in ('por_cantidad','tiempo_fijo')),
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
    (calculation_type='por_cantidad' and performance_per_hour_person is not null and fixed_person_hours is null)
    or
    (calculation_type='tiempo_fijo' and fixed_person_hours is not null and performance_per_hour_person is null)
  )
);

create unique index if not exists production_satellite_tasks_code_normalized_key
  on public.production_satellite_tasks (upper(btrim(task_code)));
create index if not exists production_satellite_tasks_active_idx
  on public.production_satellite_tasks (active,task_name);

-- PLANIFICACIÓN SEMANAL

-- Cabecera y estado de una semana. Los resultados se recalculan, no se duplican.
create table if not exists public.production_weekly_plans (
  id uuid primary key default gen_random_uuid(),
  planning_year integer not null check (planning_year between 2000 and 2200),
  planning_week integer not null check (planning_week between 1 and 53),
  status text not null default 'draft' check (status in ('draft','validated')),
  bouquet_system numeric(14,4) check (bouquet_system is null or bouquet_system>=0),
  bouquet_adjustment numeric(14,4) not null default 0,
  validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  unique (planning_year,planning_week),
  check ((status='validated' and validated_at is not null) or status='draft')
);

-- Previsión diaria y decisiones manuales de Preasignación/Recepción.
-- used = greatest(0, system_forecast + manual_adjustment), calculado por la aplicación.
create table if not exists public.production_weekly_forecasts (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  expedition_day smallint not null check (expedition_day between 1 and 7),
  system_forecast numeric(14,4) check (system_forecast is null or system_forecast>=0),
  manual_adjustment numeric(14,4) not null default 0,
  preassignment_day smallint not null check (preassignment_day between 1 and 7),
  reception_day smallint check (reception_day between 1 and 7),
  unique (plan_id,expedition_day)
);

-- Mix mínimo por categoría y día de expedición.
create table if not exists public.production_weekly_category_mix (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  expedition_day smallint not null check (expedition_day between 1 and 7),
  product_category text not null check (btrim(product_category)<>''),
  planned_units numeric(14,4) not null check (planned_units>=0),
  unique (plan_id,expedition_day,product_category)
);

-- Mix detallado cuando Previsiones disponga de producto + variante.
-- El rendimiento no se copia: siempre se consulta en nomenclature_variants.
create table if not exists public.production_weekly_variant_mix (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  expedition_day smallint not null check (expedition_day between 1 and 7),
  product_id uuid not null references public.nomenclature_products(id),
  variant_id uuid not null references public.nomenclature_variants(id),
  planned_units numeric(14,4) not null check (planned_units>=0),
  unique (plan_id,expedition_day,variant_id)
);

-- Selección semanal de tareas satélite y decisiones específicas de la semana.
create table if not exists public.production_weekly_satellite_tasks (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.production_weekly_plans(id) on delete cascade,
  task_id uuid not null references public.production_satellite_tasks(id),
  assigned_day smallint check (assigned_day between 1 and 7),
  automatic_assignment boolean not null default false,
  planned_quantity numeric(14,4) check (planned_quantity is null or planned_quantity>=0),
  unique (plan_id,task_id),
  check ((automatic_assignment and assigned_day is null) or not automatic_assignment)
);

-- Auditoría informativa. Nunca se consulta para calcular rendimientos o carga.
create table if not exists public.production_change_history (
  id uuid primary key default gen_random_uuid(),
  change_scope text not null check (change_scope in ('main','category','shipping','task')),
  entity_key text not null check (btrim(entity_key)<>''),
  field_name text not null check (btrim(field_name)<>''),
  previous_value text,
  new_value text,
  comment text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);

create index if not exists production_weekly_forecasts_plan_idx on public.production_weekly_forecasts(plan_id);
create index if not exists production_weekly_category_mix_plan_idx on public.production_weekly_category_mix(plan_id,expedition_day);
create index if not exists production_weekly_variant_mix_plan_idx on public.production_weekly_variant_mix(plan_id,expedition_day);
create index if not exists production_weekly_satellite_tasks_plan_idx on public.production_weekly_satellite_tasks(plan_id);
create index if not exists production_change_history_entity_idx on public.production_change_history(change_scope,entity_key,changed_at desc);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'production_main_tasks','production_category_times','production_settings','production_satellite_tasks','production_weekly_plans'
  ] loop
    execute format('drop trigger if exists %I_set_updated_at on public.%I',table_name,table_name);
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_production_updated_at()',table_name,table_name);
  end loop;
end;
$$;

alter table public.production_main_tasks enable row level security;
alter table public.production_category_times enable row level security;
alter table public.production_settings enable row level security;
alter table public.production_satellite_tasks enable row level security;
alter table public.production_weekly_plans enable row level security;
alter table public.production_weekly_forecasts enable row level security;
alter table public.production_weekly_category_mix enable row level security;
alter table public.production_weekly_variant_mix enable row level security;
alter table public.production_weekly_satellite_tasks enable row level security;
alter table public.production_change_history enable row level security;

-- Políticas propuestas: lectura y escritura para usuarios autenticados.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'production_main_tasks','production_category_times','production_settings','production_satellite_tasks',
    'production_weekly_plans','production_weekly_forecasts','production_weekly_category_mix',
    'production_weekly_variant_mix','production_weekly_satellite_tasks','production_change_history'
  ] loop
    execute format('drop policy if exists %I_select_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_select_authenticated on public.%I for select to authenticated using (true)',table_name,table_name);
    execute format('drop policy if exists %I_insert_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_insert_authenticated on public.%I for insert to authenticated with check (true)',table_name,table_name);
    execute format('drop policy if exists %I_update_authenticated on public.%I',table_name,table_name);
    execute format('create policy %I_update_authenticated on public.%I for update to authenticated using (true) with check (true)',table_name,table_name);
  end loop;
end;
$$;

grant select,insert,update on public.production_main_tasks to authenticated;
grant select,insert,update on public.production_category_times to authenticated;
grant select,insert,update on public.production_settings to authenticated;
grant select,insert,update on public.production_satellite_tasks to authenticated;
grant select,insert,update on public.production_weekly_plans to authenticated;
grant select,insert,update on public.production_weekly_forecasts to authenticated;
grant select,insert,update on public.production_weekly_category_mix to authenticated;
grant select,insert,update on public.production_weekly_variant_mix to authenticated;
grant select,insert,update on public.production_weekly_satellite_tasks to authenticated;
grant select,insert,update on public.production_change_history to authenticated;

comment on column public.nomenclature_variants.manufacturing_rate_per_hour_person is
  'Fuente de verdad del rendimiento actual opcional de Fabricación por producto y variante.';
comment on table public.production_main_tasks is
  'Nombre, prioridad, movilidad y estado de las cuatro tareas principales.';
comment on table public.production_category_times is
  'Rendimientos actuales de Recepción y Preasignación por categoría operativa.';
comment on table public.production_settings is
  'Fuente de verdad del rendimiento global actual de Expedición.';
comment on table public.production_satellite_tasks is
  'Catálogo maestro de tareas satélite: por cantidad o tiempo fijo en horas-persona.';
comment on table public.production_weekly_plans is
  'Cabecera y estado de cada planificación semanal.';
comment on table public.production_change_history is
  'Registro informativo de modificaciones; nunca interviene en cálculos.';
