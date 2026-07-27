# Preparación de Nomenclaturas para Supabase

Esta fase no cambia la fuente de verdad. La interfaz, `app_states`, el JSON principal,
OneDrive, la importación y la exportación actuales continúan funcionando. El modelo
relacional se prepara como copia de validación y no se usa automáticamente.

## Modelo actual analizado

Las estructuras que realmente persisten dentro del estado general son:

- `nomenclatures`: líneas desnormalizadas de producto × precio/tamaño × flor.
- `flowers`: catálogo de flores con una matriz `providers`.
- `productPriceCatalog`: número de precios y PVP por código de producto.
- `nomenclatureMeta` y `flowerMeta`: fechas generales de importación/modificación.

Las últimas definiciones JavaScript son las efectivas cuando existen funciones
duplicadas en `index.html`.

### A. Datos maestros

- Producto: código, nombre, categoría, activo, papelera, observaciones.
- Variante: `priceNumber`/`size`, PVP e IVA.
- Flor: nombre, código opcional, familia, color, formato, unidad y activo.
- Proveedor de flor: nombre/código, coste, unidad, múltiplo, activo y principal.
- Composición: flor, proveedor seleccionado y tallos para cada precio.

### B. Datos derivados

- `productSummaries()` agrupa las líneas por producto.
- `collectProductModel()` recompone precios y flores para el editor.
- `structuredNomenclatureProducts()` genera el modelo técnico/exportable.
- `buildNomenclatureTechnicalState()` crea la copia específica de Nomenclaturas.
- Coste: suma de tallos × precio por tallo.
- PVP neto: PVP / (1 + IVA).
- Margen: PVP neto − coste teórico.

### C. Históricos actuales

No existe un histórico relacional. Las líneas solo conservan `createdAt`,
`updatedAt` e `importedAt`. El Excel técnico contempla conceptualmente
`priceHistory`, pero los datos operativos actuales no contienen entradas y la
edición de precios sustituye el valor vigente.

### D. Estado de interfaz

- `nomenclatureTab`, `pendingNomenclatureImport`, `pendingFlowerImport`.
- `productEditorLines`, `productEditorPrices`, `productEditorOriginalKey`.
- `nomenclatureDirty`, filtros, búsqueda y estado del guardado.

Estos datos no se trasladan a tablas relacionales.

### E. Duplicaciones actuales

- Código/nombre/categoría/estado del producto repetidos en cada componente.
- PVP e IVA repetidos en las líneas de una variante.
- Flor, proveedor y coste repetidos entre productos.
- Coste vigente repetido entre la línea y `flowers.providers`.
- Claves de `productPriceCatalog` equivalentes salvo mayúsculas/minúsculas.
- Varias generaciones de funciones con el mismo nombre en `index.html`.

La transformación agrupa productos por claves de negocio y flores por una clave
interna de correspondencia no visible. Conserva cualquier código existente, pero
no lo exige ni genera códigos artificiales. Los componentes repetidos conservan la
línea más reciente/última, igual que el modelo efectivo de la aplicación, pero
siempre generan una advertencia.

## Operaciones actuales conservadas

- Importación Excel: `parseNomenclatureRows()`, `applyNomenclatureImport()`,
  `parseFlowerRows()` y `applyFlowerImport()`.
- Exportación Excel/PDF: `buildNomenclatureWorkbook()`,
  `exportNomenclaturesExcel()` y funciones de fichas.
- Duplicar: `duplicateProductFromSummary()`.
- Activo/inactivo y papelera: banderas `active` y `deleted`.
- Borrado definitivo actual: `hardDeleteProduct()` elimina del JSON. No se
  traslada a Supabase; el nuevo SQL no concede `DELETE`.
- Número de precios: 1–5 mediante `productPriceCatalog` y `priceNumber`.
- Tallos por precio: líneas desnormalizadas que `collectProductModel()` recompone.

## Modelo relacional propuesto

```text
nomenclature_products
  └─ nomenclature_variants
       ├─ product_sale_price_history
       ├─ nomenclature_recipe_versions
       │    └─ nomenclature_components ── nomenclature_flowers
       └─ product_cost_snapshots

nomenclature_flowers
  └─ nomenclature_flower_suppliers ── suppliers
       └─ flower_cost_history

suppliers
  └─ supplier_invoices
       └─ supplier_invoice_lines
            ├─ nomenclature_flowers (asociación opcional)
            └─ nomenclature_flower_suppliers (asociación opcional)
```

Las claves internas son UUID. Los códigos existentes se conservan como metadata
de negocio opcional en las flores. Una variante se identifica de forma repetible por
`product_id + price_index`; no se presupone que siempre existan cinco.

Las recetas se asocian a una versión. La migración crea la versión 1 de cada
variante. Las versiones posteriores podrán cerrar `valid_to` y crear una nueva
receta sin perder la composición anterior.

## Coste, PVP y margen

- `nomenclature_flower_suppliers.current_unit_cost` agiliza la operativa.
- `flower_cost_history` justifica cada cambio y es append-only.
- `nomenclature_variants.sale_price` contiene el PVP vigente.
- `product_sale_price_history` conserva todos los PVP anteriores.
- `product_cost_snapshots` conserva la fotografía económica ante un evento.
- `theoretical_cost` usa receta × último coste conocido.
- `real_cost` queda `NULL` si no existe factura u otra evidencia real.
- Los importes usan `numeric`, nunca `float`; el coste por tallo conserva cuatro
  decimales.

Las funciones SQL `record_nomenclature_flower_cost()` y
`record_nomenclature_sale_price()` cierran la vigencia anterior, insertan el
histórico y actualizan el valor actual dentro de una misma operación.

## Facturas futuras

`supplier_invoices` conserva cabecera/documento y
`supplier_invoice_lines` conserva cantidades, unidades, costes y estado del
emparejamiento. Una línea puede quedar `unmatched`, `suggested`, `matched` o
`ignored`. Cuando una asociación se confirme, el histórico de coste podrá
referenciar `invoice_id` e `invoice_line_id`.

El modelo permite buscar coincidencias sucesivamente por código del proveedor,
código interno opcional, descripción normalizada, proveedor, nombre y formato.
También permite asignar directamente `flower_id` de forma manual aunque ambos
códigos sean `NULL`. Las líneas confirmadas conservan `normalized_description` y
`match_method`, por lo que podrán reutilizarse como antecedente del mismo proveedor.

No se implementan OCR, IA ni carga documental en esta fase.

## Migración manual preparada

`buildNomenclatureMigrationPayload()`:

1. Agrupa productos por código normalizado.
2. Crea las variantes reales (1–5).
3. Deduplica flores localmente usando código cuando existe o identidad normalizada
   (nombre + familia + color + formato) cuando no existe.
4. Clasifica coincidencias seguras, posibles duplicados y artículos distintos.
5. Normaliza proveedores sin duplicarlos por espacios/mayúsculas.
6. Genera relaciones flor/proveedor y composiciones versionadas por UUID.
7. Genera históricos iniciales con `source = 'migration'`.
8. Usa la fecha de migración como `valid_from` y documenta que la fecha anterior
   es desconocida.
9. Genera un snapshot inicial con `real_cost = NULL`.
10. Devuelve errores, advertencias, información de calidad y `canMigrate`.

`migrateNomenclaturesToSupabase()` es `dry-run` por defecto. La escritura solo se
intenta con:

```js
await migrateNomenclaturesToSupabase({
  dryRun: false,
  confirmed: true,
  effectiveDate: 'AAAA-MM-DD'
});
```

No debe ejecutarse hasta crear las tablas, revisar la previsualización y resolver
todos los errores críticos. Los `source_key` y `upsert` hacen repetible la
migración sin duplicar maestros ni históricos iniciales.

## Comparación y fallback

`compareNomenclaturesWithSupabase()` compara:

- productos, variantes, flores, proveedores y componentes;
- activo/papelera;
- PVP, IVA, coste por tallo, tallos y proveedor preferido;
- coste y margen teóricos recalculados desde la copia relacional.

Una diferencia de hasta 0,01 se etiqueta como `rounding`; una flor o coste ausente
se informa como dato faltante, no como coincidencia.

`loadNomenclatureDataFromSupabase()` solo devuelve una copia estructurada. Si las
tablas no existen o no son accesibles, devuelve `available: false` y nunca vacía
`nomenclatures`, `flowers` ni `productPriceCatalog`.

## Incidencias reales detectadas antes de migrar

En la copia operativa revisada:

- hay 261 líneas de nomenclatura;
- hay 19 productos y tres líneas completamente vacías que se ignoran;
- hay 51 flores y sus 51 códigos de artículo están vacíos;
- los 51 nombres normalizados son únicos;
- los 247 componentes coinciden de forma segura con una flor por nombre normalizado;
- no hay componentes huérfanos;
- existe un posible duplicado no fusionado: `ROSE RED NAOMI 4050 CM` frente a
  `ROSE RED NAOMI 40/50 CM`;
- no existen entradas de histórico de costes;
- existen claves equivalentes de catálogo que difieren por mayúsculas/minúsculas.

La previsualización puede continuar sin `article_code`. Cada flor se inserta con un
UUID de Supabase y `article_code = NULL`. `migration_match_key` solo hace repetible
la carga inicial y nunca se muestra como código. Las dos variantes sin PVP se
migran con `sale_price = NULL` y margen nulo.

El dry-run actual prepara 19 productos, 57 variantes, 51 flores, 247 componentes,
51 costes iniciales, 55 PVP y 57 snapshots. Resultado: 0 errores críticos y 6
advertencias (un posible duplicado, tres catálogos de precio huérfanos y dos
variantes sin PVP).

## Orden de una futura ejecución real

1. Ejecutar manualmente `supabase-nomenclatures.sql`.
2. Comprobar acceso autenticado y RLS.
3. Ejecutar solo la previsualización (`dry-run`).
4. Revisar recuentos, errores, advertencias y posibles duplicados.
5. Ejecutar la migración manual confirmada.
6. Ejecutar `compareNomenclaturesWithSupabase()`.
7. Validar muestras en Supabase y la interfaz actual.
8. Mantener JSON, `app_states`, OneDrive y backups hasta una fase posterior.
