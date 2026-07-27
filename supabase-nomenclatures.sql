-- AQope · modelo relacional de Nomenclaturas
-- PREPARACIÓN: revisar y ejecutar manualmente en Supabase SQL Editor.
-- No modifica app_states, bo_daily_shipments ni otras tablas existentes.
-- No contiene DROP TABLE, DELETE ni políticas que permitan borrado físico.

create extension if not exists pgcrypto;

create or replace function public.set_nomenclature_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.nomenclature_products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  product_name text,
  category text not null
    check (category in ('ROSAS', 'COMPUESTOS', 'SIMPLES', 'PLANTAS')),
  active boolean not null default true,
  deleted boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists nomenclature_products_code_normalized_key
  on public.nomenclature_products (upper(btrim(product_code)));
create index if not exists nomenclature_products_updated_at_idx
  on public.nomenclature_products (updated_at desc);

create table if not exists public.nomenclature_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nomenclature_products(id),
  variant_code text,
  variant_name text,
  size text,
  price_index integer not null check (price_index between 1 and 5),
  sale_price numeric(14,4) check (sale_price is null or sale_price >= 0),
  vat_rate numeric(7,4) not null default 10 check (vat_rate between 0 and 100),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint nomenclature_variants_product_price_key unique (product_id, price_index),
  constraint nomenclature_variants_id_product_key unique (id, product_id)
);

create index if not exists nomenclature_variants_product_idx
  on public.nomenclature_variants (product_id);
create index if not exists nomenclature_variants_code_idx
  on public.nomenclature_variants (variant_code);
create index if not exists nomenclature_variants_updated_at_idx
  on public.nomenclature_variants (updated_at desc);

create table if not exists public.nomenclature_flowers (
  id uuid primary key default gen_random_uuid(),
  article_code text unique,
  article_name text not null,
  migration_match_key text not null unique,
  family text,
  color text,
  format text,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check (btrim(article_name) <> ''),
  check (article_code is null or btrim(article_code) <> ''),
  check (btrim(migration_match_key) <> '')
);

create unique index if not exists nomenclature_flowers_code_normalized_key
  on public.nomenclature_flowers (upper(btrim(article_code)))
  where article_code is not null;
create index if not exists nomenclature_flowers_name_idx
  on public.nomenclature_flowers (article_name);
create index if not exists nomenclature_flowers_updated_at_idx
  on public.nomenclature_flowers (updated_at desc);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text,
  normalized_name text not null unique,
  supplier_name text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check (btrim(normalized_name) <> ''),
  check (btrim(supplier_name) <> '')
);

create unique index if not exists suppliers_code_key
  on public.suppliers (upper(btrim(supplier_code)))
  where supplier_code is not null and btrim(supplier_code) <> '';
create index if not exists suppliers_updated_at_idx
  on public.suppliers (updated_at desc);

create table if not exists public.nomenclature_flower_suppliers (
  id uuid primary key default gen_random_uuid(),
  flower_id uuid not null references public.nomenclature_flowers(id),
  supplier_id uuid not null references public.suppliers(id),
  supplier_article_code text,
  current_unit_cost numeric(14,4)
    check (current_unit_cost is null or current_unit_cost >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  purchase_unit text,
  purchase_multiple numeric(14,4)
    check (purchase_multiple is null or purchase_multiple > 0),
  is_primary boolean not null default false,
  active boolean not null default true,
  source text,
  notes text,
  cost_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint nomenclature_flower_suppliers_key unique (flower_id, supplier_id)
);

create index if not exists nomenclature_flower_suppliers_flower_idx
  on public.nomenclature_flower_suppliers (flower_id);
create index if not exists nomenclature_flower_suppliers_supplier_idx
  on public.nomenclature_flower_suppliers (supplier_id);
create unique index if not exists nomenclature_flower_one_primary_idx
  on public.nomenclature_flower_suppliers (flower_id)
  where is_primary and active;

create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references public.suppliers(id),
  invoice_number text,
  invoice_date date,
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(16,4),
  tax numeric(16,4),
  total numeric(16,4),
  document_name text,
  document_url text,
  source text not null default 'manual'
    check (source in ('manual', 'document_import', 'invoice_ai', 'other')),
  processing_status text not null default 'pending_review'
    check (processing_status in ('pending', 'processing', 'pending_review', 'confirmed', 'failed', 'ignored')),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null
);

create unique index if not exists supplier_invoices_supplier_number_key
  on public.supplier_invoices (supplier_id, upper(btrim(invoice_number)))
  where supplier_id is not null and invoice_number is not null and btrim(invoice_number) <> '';
create index if not exists supplier_invoices_date_idx
  on public.supplier_invoices (invoice_date desc);
create index if not exists supplier_invoices_supplier_idx
  on public.supplier_invoices (supplier_id);

create table if not exists public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.supplier_invoices(id),
  line_number integer,
  flower_id uuid references public.nomenclature_flowers(id),
  flower_supplier_id uuid references public.nomenclature_flower_suppliers(id),
  supplier_article_code text,
  description text,
  normalized_description text,
  quantity numeric(16,4),
  unit text,
  unit_cost numeric(14,4),
  line_total numeric(16,4),
  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'suggested', 'unmatched', 'ignored')),
  match_confidence numeric(7,4)
    check (match_confidence is null or match_confidence between 0 and 1),
  match_method text
    check (match_method is null or match_method in (
      'supplier_article_code',
      'article_code',
      'normalized_description',
      'supplier_and_name',
      'name_and_format',
      'manual',
      'ai_suggestion'
    )),
  match_notes text,
  matched_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint supplier_invoice_lines_number_key unique (invoice_id, line_number)
);

create index if not exists supplier_invoice_lines_invoice_idx
  on public.supplier_invoice_lines (invoice_id);
create index if not exists supplier_invoice_lines_flower_idx
  on public.supplier_invoice_lines (flower_id);
create index if not exists supplier_invoice_lines_match_status_idx
  on public.supplier_invoice_lines (match_status);
create index if not exists supplier_invoice_lines_supplier_article_idx
  on public.supplier_invoice_lines (supplier_article_code);
create index if not exists supplier_invoice_lines_normalized_description_idx
  on public.supplier_invoice_lines (normalized_description);

-- Una versión pertenece a una variante concreta. La migración crea la versión 1;
-- las versiones futuras permitirán reconstruir la receta vigente en cualquier fecha.
create table if not exists public.nomenclature_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nomenclature_products(id),
  variant_id uuid not null references public.nomenclature_variants(id),
  version_number integer not null check (version_number > 0),
  valid_from date not null,
  valid_to date,
  reason text,
  source text not null default 'manual',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint nomenclature_recipe_versions_key unique (variant_id, version_number),
  constraint nomenclature_recipe_versions_id_variant_product_key
    unique (id, variant_id, product_id),
  constraint nomenclature_recipe_versions_variant_product_fk
    foreign key (variant_id, product_id)
    references public.nomenclature_variants(id, product_id),
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists nomenclature_recipe_versions_product_idx
  on public.nomenclature_recipe_versions (product_id);
create index if not exists nomenclature_recipe_versions_variant_valid_idx
  on public.nomenclature_recipe_versions (variant_id, valid_from desc);
create unique index if not exists nomenclature_recipe_one_active_idx
  on public.nomenclature_recipe_versions (variant_id)
  where active and valid_to is null;

create table if not exists public.nomenclature_components (
  id uuid primary key default gen_random_uuid(),
  recipe_version_id uuid not null,
  product_id uuid not null references public.nomenclature_products(id),
  variant_id uuid not null,
  flower_id uuid not null references public.nomenclature_flowers(id),
  preferred_supplier_id uuid references public.suppliers(id),
  stems numeric(14,4) not null default 0 check (stems >= 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  constraint nomenclature_components_recipe_flower_key
    unique (recipe_version_id, flower_id),
  constraint nomenclature_components_recipe_variant_product_fk
    foreign key (recipe_version_id, variant_id, product_id)
    references public.nomenclature_recipe_versions(id, variant_id, product_id)
);

create index if not exists nomenclature_components_product_idx
  on public.nomenclature_components (product_id);
create index if not exists nomenclature_components_variant_idx
  on public.nomenclature_components (variant_id);
create index if not exists nomenclature_components_flower_idx
  on public.nomenclature_components (flower_id);
create index if not exists nomenclature_components_supplier_idx
  on public.nomenclature_components (preferred_supplier_id);

-- Históricos append-only. source_key hace repetible la migración sin duplicar
-- la misma entrada inicial.
create table if not exists public.flower_cost_history (
  id uuid primary key default gen_random_uuid(),
  flower_id uuid not null references public.nomenclature_flowers(id),
  supplier_id uuid references public.suppliers(id),
  flower_supplier_id uuid references public.nomenclature_flower_suppliers(id),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  valid_from date not null,
  valid_to date,
  source text not null
    check (source in ('manual', 'excel_import', 'migration', 'supplier_invoice', 'invoice_ai', 'other')),
  source_reference text,
  source_key text unique,
  invoice_id uuid references public.supplier_invoices(id),
  invoice_line_id uuid references public.supplier_invoice_lines(id),
  invoice_number text,
  invoice_date date,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists flower_cost_history_flower_valid_idx
  on public.flower_cost_history (flower_id, valid_from desc);
create index if not exists flower_cost_history_supplier_valid_idx
  on public.flower_cost_history (supplier_id, valid_from desc);
create index if not exists flower_cost_history_flower_supplier_idx
  on public.flower_cost_history (flower_supplier_id, valid_from desc);
create index if not exists flower_cost_history_invoice_idx
  on public.flower_cost_history (invoice_id);

create table if not exists public.product_sale_price_history (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.nomenclature_variants(id),
  sale_price numeric(14,4) not null check (sale_price >= 0),
  vat_rate numeric(7,4) not null default 10 check (vat_rate between 0 and 100),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  valid_from date not null,
  valid_to date,
  source text not null
    check (source in ('manual', 'excel_import', 'migration', 'other')),
  source_reference text,
  source_key text unique,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  check (valid_to is null or valid_to >= valid_from)
);

create index if not exists product_sale_price_history_variant_valid_idx
  on public.product_sale_price_history (variant_id, valid_from desc);

-- Snapshot económico: coste real queda NULL mientras no exista una fuente real.
create table if not exists public.product_cost_snapshots (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nomenclature_products(id),
  variant_id uuid not null,
  calculated_at timestamptz not null default now(),
  effective_date date,
  sale_price numeric(14,4),
  vat_rate numeric(7,4),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  net_sale_price numeric(14,4),
  theoretical_cost numeric(16,4),
  real_cost numeric(16,4),
  theoretical_margin_eur numeric(16,4),
  theoretical_margin_pct numeric(9,4),
  real_margin_eur numeric(16,4),
  real_margin_pct numeric(9,4),
  source text not null,
  trigger_reason text not null,
  source_key text unique,
  source_invoice_id uuid references public.supplier_invoices(id),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint product_cost_snapshots_variant_product_fk
    foreign key (variant_id, product_id)
    references public.nomenclature_variants(id, product_id)
);

create index if not exists product_cost_snapshots_product_date_idx
  on public.product_cost_snapshots (product_id, calculated_at desc);
create index if not exists product_cost_snapshots_variant_date_idx
  on public.product_cost_snapshots (variant_id, calculated_at desc);
create index if not exists product_cost_snapshots_effective_date_idx
  on public.product_cost_snapshots (effective_date desc);

comment on table public.nomenclature_products is
  'Maestro de productos/ramos. deleted implementa papelera sin DELETE físico.';
comment on table public.nomenclature_variants is
  'Tamaños/precios comerciales (actualmente entre 1 y 5 por producto).';
comment on table public.nomenclature_components is
  'Líneas de receta versionadas; el coste se calcula, no se almacena como verdad en la línea.';
comment on column public.nomenclature_flowers.article_code is
  'Código de negocio opcional. El UUID es la identidad técnica de la flor.';
comment on column public.nomenclature_flowers.migration_match_key is
  'Clave interna no visible para hacer repetible la migración inicial; no sustituye a article_code.';
comment on table public.flower_cost_history is
  'Histórico append-only del coste por flor/proveedor.';
comment on table public.product_cost_snapshots is
  'Fotografías económicas creadas solo ante eventos relevantes.';
comment on table public.supplier_invoice_lines is
  'Líneas preparadas para asociación manual o futura sugerencia por IA.';
comment on column public.product_cost_snapshots.real_cost is
  'Coste realmente confirmado; no debe copiarse del coste teórico si no existe evidencia.';

-- Timestamps automáticos solo para tablas mutables.
do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'nomenclature_products',
    'nomenclature_variants',
    'nomenclature_flowers',
    'suppliers',
    'nomenclature_flower_suppliers',
    'nomenclature_recipe_versions',
    'supplier_invoices',
    'supplier_invoice_lines',
    'nomenclature_components'
  ]
  loop
    if not exists (
      select 1
      from pg_trigger
      where tgname = 'set_' || table_name || '_updated_at'
        and tgrelid = ('public.' || table_name)::regclass
    ) then
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_nomenclature_updated_at()',
        'set_' || table_name || '_updated_at',
        table_name
      );
    end if;
  end loop;
end
$triggers$;

-- Operación transaccional: conserva histórico y actualiza el coste vigente.
create or replace function public.record_nomenclature_flower_cost(
  p_flower_supplier_id uuid,
  p_unit_cost numeric,
  p_valid_from date,
  p_source text,
  p_source_reference text default null,
  p_notes text default null,
  p_source_key text default null,
  p_invoice_id uuid default null,
  p_invoice_line_id uuid default null,
  p_invoice_number text default null,
  p_invoice_date date default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  relation_row public.nomenclature_flower_suppliers%rowtype;
  existing_id uuid;
  history_id uuid;
  line_invoice_id uuid;
begin
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'El coste debe ser un número igual o superior a cero';
  end if;
  if p_valid_from is null then
    raise exception 'valid_from es obligatorio';
  end if;

  select *
    into relation_row
    from public.nomenclature_flower_suppliers
   where id = p_flower_supplier_id
   for update;
  if not found then
    raise exception 'No existe la relación flor/proveedor %', p_flower_supplier_id;
  end if;

  if p_source_key is not null then
    select id into existing_id
      from public.flower_cost_history
     where source_key = p_source_key;
    if existing_id is not null then
      return existing_id;
    end if;
  end if;

  if p_invoice_line_id is not null then
    select invoice_id into line_invoice_id
      from public.supplier_invoice_lines
     where id = p_invoice_line_id;
    if line_invoice_id is null then
      raise exception 'No existe la línea de factura %', p_invoice_line_id;
    end if;
    if p_invoice_id is not null and p_invoice_id <> line_invoice_id then
      raise exception 'La línea de factura no pertenece a la factura indicada';
    end if;
    p_invoice_id := line_invoice_id;
  end if;

  if exists (
    select 1
      from public.flower_cost_history
     where flower_supplier_id = p_flower_supplier_id
       and valid_to is null
       and valid_from >= p_valid_from
  ) then
    raise exception 'Ya existe un coste vigente con la misma fecha o una fecha posterior';
  end if;

  update public.flower_cost_history
     set valid_to = p_valid_from - 1
   where flower_supplier_id = p_flower_supplier_id
     and valid_to is null
     and valid_from < p_valid_from;

  insert into public.flower_cost_history (
    flower_id, supplier_id, flower_supplier_id, unit_cost, currency,
    valid_from, source, source_reference, source_key,
    invoice_id, invoice_line_id, invoice_number, invoice_date,
    notes, created_by
  )
  values (
    relation_row.flower_id, relation_row.supplier_id, relation_row.id,
    p_unit_cost, relation_row.currency, p_valid_from, p_source,
    p_source_reference, p_source_key,
    p_invoice_id, p_invoice_line_id, p_invoice_number, p_invoice_date,
    p_notes, auth.uid()
  )
  returning id into history_id;

  update public.nomenclature_flower_suppliers
     set current_unit_cost = p_unit_cost,
         cost_updated_at = now(),
         source = p_source,
         updated_by = auth.uid()
   where id = p_flower_supplier_id;

  return history_id;
end;
$$;

-- Operación transaccional equivalente para el PVP vigente y su histórico.
create or replace function public.record_nomenclature_sale_price(
  p_variant_id uuid,
  p_sale_price numeric,
  p_vat_rate numeric,
  p_valid_from date,
  p_source text,
  p_source_reference text default null,
  p_notes text default null,
  p_source_key text default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  existing_id uuid;
  history_id uuid;
begin
  if p_sale_price is null or p_sale_price < 0 then
    raise exception 'El PVP debe ser un número igual o superior a cero';
  end if;
  if p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    raise exception 'El IVA debe estar entre 0 y 100';
  end if;
  perform 1 from public.nomenclature_variants where id = p_variant_id for update;
  if not found then raise exception 'No existe la variante %', p_variant_id; end if;

  if p_source_key is not null then
    select id into existing_id
      from public.product_sale_price_history
     where source_key = p_source_key;
    if existing_id is not null then return existing_id; end if;
  end if;

  if exists (
    select 1 from public.product_sale_price_history
     where variant_id = p_variant_id and valid_to is null and valid_from >= p_valid_from
  ) then
    raise exception 'Ya existe un PVP vigente con la misma fecha o una fecha posterior';
  end if;

  update public.product_sale_price_history
     set valid_to = p_valid_from - 1
   where variant_id = p_variant_id and valid_to is null and valid_from < p_valid_from;

  insert into public.product_sale_price_history (
    variant_id, sale_price, vat_rate, valid_from, source,
    source_reference, source_key, notes, created_by
  )
  values (
    p_variant_id, p_sale_price, p_vat_rate, p_valid_from, p_source,
    p_source_reference, p_source_key, p_notes, auth.uid()
  )
  returning id into history_id;

  update public.nomenclature_variants
     set sale_price = p_sale_price,
         vat_rate = p_vat_rate,
         updated_by = auth.uid()
   where id = p_variant_id;
  return history_id;
end;
$$;

-- RLS: usuarios autenticados pueden leer todo. No se crean políticas DELETE.
do $rls$
declare
  table_name text;
  mutable_tables text[] := array[
    'nomenclature_products',
    'nomenclature_variants',
    'nomenclature_flowers',
    'suppliers',
    'nomenclature_flower_suppliers',
    'nomenclature_recipe_versions',
    'nomenclature_components',
    'supplier_invoices',
    'supplier_invoice_lines'
  ];
  append_tables text[] := array[
    'flower_cost_history',
    'product_sale_price_history',
    'product_cost_snapshots'
  ];
begin
  foreach table_name in array array[
    'nomenclature_products',
    'nomenclature_variants',
    'nomenclature_flowers',
    'suppliers',
    'nomenclature_flower_suppliers',
    'nomenclature_recipe_versions',
    'nomenclature_components',
    'supplier_invoices',
    'supplier_invoice_lines',
    'flower_cost_history',
    'product_sale_price_history',
    'product_cost_snapshots'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = table_name
         and policyname = 'Authenticated read ' || table_name
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated using (true)',
        'Authenticated read ' || table_name,
        table_name
      );
    end if;
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = table_name
         and policyname = 'Authenticated insert ' || table_name
    ) then
      if table_name = any(mutable_tables) then
        execute format(
          'create policy %I on public.%I for insert to authenticated with check ((created_by is null or created_by = auth.uid()) and (updated_by is null or updated_by = auth.uid()))',
          'Authenticated insert ' || table_name,
          table_name
        );
      else
        execute format(
          'create policy %I on public.%I for insert to authenticated with check (created_by is null or created_by = auth.uid())',
          'Authenticated insert ' || table_name,
          table_name
        );
      end if;
    end if;
  end loop;

  foreach table_name in array mutable_tables
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = table_name
         and policyname = 'Authenticated update ' || table_name
    ) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (true) with check (updated_by is null or updated_by = auth.uid())',
        'Authenticated update ' || table_name,
        table_name
      );
    end if;
  end loop;

  foreach table_name in array array['flower_cost_history', 'product_sale_price_history']
  loop
    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = table_name
         and policyname = 'Authenticated close validity ' || table_name
    ) then
      execute format(
        'create policy %I on public.%I for update to authenticated using (true) with check (true)',
        'Authenticated close validity ' || table_name,
        table_name
      );
    end if;
  end loop;
end
$rls$;

grant select, insert, update on
  public.nomenclature_products,
  public.nomenclature_variants,
  public.nomenclature_flowers,
  public.suppliers,
  public.nomenclature_flower_suppliers,
  public.nomenclature_recipe_versions,
  public.nomenclature_components,
  public.supplier_invoices,
  public.supplier_invoice_lines
to authenticated;

grant select, insert on
  public.flower_cost_history,
  public.product_sale_price_history,
  public.product_cost_snapshots
to authenticated;

grant update (valid_to, notes) on public.flower_cost_history to authenticated;
grant update (valid_to, notes) on public.product_sale_price_history to authenticated;
grant execute on function public.record_nomenclature_flower_cost(
  uuid, numeric, date, text, text, text, text, uuid, uuid, text, date
) to authenticated;
grant execute on function public.record_nomenclature_sale_price(
  uuid, numeric, numeric, date, text, text, text, text
) to authenticated;

revoke delete on
  public.nomenclature_products,
  public.nomenclature_variants,
  public.nomenclature_flowers,
  public.suppliers,
  public.nomenclature_flower_suppliers,
  public.nomenclature_recipe_versions,
  public.nomenclature_components,
  public.flower_cost_history,
  public.product_sale_price_history,
  public.product_cost_snapshots,
  public.supplier_invoices,
  public.supplier_invoice_lines
from authenticated;
