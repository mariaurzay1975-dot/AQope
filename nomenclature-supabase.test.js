'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  appendCostHistory,
  appendSalePriceHistory,
  buildNomenclatureMigrationPayload,
  calculateTheoreticalEconomics,
  classifyFlowerDuplicates,
  compareNomenclaturePayload,
  migrateNomenclaturesToSupabase,
  transformSupplierInvoice
} = require('./nomenclature-supabase.js');

function line(overrides = {}) {
  return {
    productCode: 'A-TEST-5',
    productName: 'Ramo de prueba',
    category: 'ROSAS',
    variantCode: 'A-TEST-5',
    variantName: `Precio ${overrides.priceNumber || 1}`,
    size: String(overrides.priceNumber || 1),
    priceNumber: overrides.priceNumber || 1,
    salePrice: overrides.salePrice ?? 33,
    vat: 10,
    productNotes: '',
    articleCode: 'ROS001',
    articleName: 'Rosa Freedom',
    stemsPerBouquet: 10,
    supplier: 'Hoorn',
    unitCost: 0.42,
    active: true,
    deleted: false,
    notes: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-07-15T00:00:00.000Z',
    ...overrides
  };
}

function sampleState() {
  const prices = [33, 40, 50, 60, 70];
  const nomenclatures = [];
  for (let priceNumber = 1; priceNumber <= 5; priceNumber += 1) {
    nomenclatures.push(line({
      priceNumber,
      salePrice: prices[priceNumber - 1],
      stemsPerBouquet: 8 + priceNumber * 2
    }));
    nomenclatures.push(line({
      priceNumber,
      salePrice: prices[priceNumber - 1],
      articleCode: '',
      articleName: 'Eucalyptus',
      stemsPerBouquet: 4 + priceNumber,
      supplier: 'Flora Verde',
      unitCost: 0.18
    }));
  }
  // Duplicado deliberado: la aplicación actual conserva la última línea.
  nomenclatures.push(line({
    priceNumber: 1,
    articleCode: '',
    articleName: 'Eucalyptus',
    stemsPerBouquet: 5,
    supplier: 'Flora Verde',
    unitCost: 0.18
  }));
  nomenclatures.push(line({
    productCode: 'C-UNO',
    productName: 'Producto de un tamaño',
    category: 'COMPUESTOS',
    priceNumber: 1,
    size: '1',
    salePrice: 22,
    stemsPerBouquet: 0,
    active: false
  }));
  nomenclatures.push(line({
    productCode: 'S-PAPELERA',
    productName: 'Producto en papelera',
    category: 'SIMPLES',
    priceNumber: 1,
    size: '1',
    salePrice: 10,
    articleCode: '',
    articleName: 'Eucalyptus',
    stemsPerBouquet: 3,
    supplier: 'Flora Verde',
    unitCost: 0.18,
    active: false,
    deleted: true
  }));
  nomenclatures.push(line({
    productCode: 'P-SIN-FLOR',
    productName: 'Producto sin composición',
    category: 'PLANTAS',
    priceNumber: 1,
    size: '1',
    salePrice: '',
    articleCode: '',
    articleName: '',
    stemsPerBouquet: 0,
    supplier: '',
    unitCost: '',
    active: true
  }));
  return {
    nomenclatures,
    productPriceCatalog: {
      'A-TEST-5': { priceCount: 5, prices },
      'a-test-5': { priceCount: 5, prices },
      'C-UNO': { priceCount: 1, prices: [22] },
      'S-PAPELERA': { priceCount: 1, prices: [10] },
      'P-SIN-FLOR': { priceCount: 1, prices: [''] }
    },
    flowers: [
      {
        articleCode: 'ROS001',
        articleName: 'Rosa Freedom',
        family: 'Rosa',
        color: 'Rojo',
        format: '60 cm',
        primarySupplier: 'Hoorn',
        active: true,
        providers: [
          { supplier: 'Hoorn', supplierCode: 'HOO', price: 0.42, unit: 'tallo', multiple: 10, active: true, source: 'manual' },
          { supplier: 'Hoorn Alternativo', supplierCode: 'HOO-2', price: 0.43, unit: 'tallo', multiple: 10, active: true, source: 'manual' }
        ]
      },
      {
        articleCode: '',
        articleName: 'Eucalyptus',
        primarySupplier: 'Flora Verde',
        active: false,
        providers: [
          { supplier: 'Flora Verde', price: 0.18, unit: 'tallo', multiple: 5, active: true, source: 'excel_import' }
        ]
      },
      {
        articleCode: '',
        articleName: 'Flor sin proveedor',
        active: true,
        providers: []
      }
    ]
  };
}

function remoteFromPayload(payload) {
  const products = payload.products.map((row, index) => ({ ...row, id: `p-${index}` }));
  const productIds = new Map(products.map(row => [row._key, row.id]));
  const flowers = payload.flowers.map((row, index) => ({ ...row, id: `f-${index}` }));
  const flowerIds = new Map(flowers.map(row => [row._key, row.id]));
  const suppliers = payload.suppliers.map((row, index) => ({ ...row, id: `s-${index}` }));
  const supplierIds = new Map(suppliers.map(row => [row._key, row.id]));
  const variants = payload.variants.map((row, index) => ({
    ...row,
    id: `v-${index}`,
    product_id: productIds.get(row.product_key)
  }));
  const variantIds = new Map(variants.map(row => [row._key, row.id]));
  const flowerSuppliers = payload.flowerSuppliers.map((row, index) => ({
    ...row,
    id: `fs-${index}`,
    flower_id: flowerIds.get(row.flower_key),
    supplier_id: supplierIds.get(row.supplier_key)
  }));
  const recipeVersions = payload.recipeVersions.map((row, index) => ({
    ...row,
    id: `r-${index}`,
    product_id: productIds.get(row.product_key),
    variant_id: variantIds.get(row.variant_key)
  }));
  const recipeIds = new Map(recipeVersions.map(row => [row._key, row.id]));
  const components = payload.components.map((row, index) => ({
    ...row,
    id: `c-${index}`,
    recipe_version_id: recipeIds.get(row.recipe_version_key),
    product_id: productIds.get(row.product_key),
    variant_id: variantIds.get(row.variant_key),
    flower_id: flowerIds.get(row.flower_key),
    preferred_supplier_id: row.preferred_supplier_key ? supplierIds.get(row.preferred_supplier_key) : null
  }));
  return { products, variants, flowers, suppliers, flowerSuppliers, recipeVersions, components };
}

test('transforma productos, variantes, flores, proveedores y composiciones sin perder relaciones', () => {
  const payload = buildNomenclatureMigrationPayload(sampleState(), { effectiveDate: '2026-07-27' });
  assert.equal(payload.preview.canMigrate, true);
  assert.equal(payload.preview.products, 4);
  assert.equal(payload.preview.variants, 8);
  assert.equal(payload.preview.flowers, 3);
  assert.equal(payload.preview.suppliers, 3);
  assert.equal(payload.preview.components, 12);
  assert.equal(payload.preview.initialCosts, 3);
  assert.equal(payload.preview.initialSalePrices, 7);
  assert.equal(payload.preview.initialSnapshots, 8);
  assert.equal(payload.preview.errors, 0);
  assert.ok(payload.preview.warnings >= 4);
  assert.ok(payload.issues.warnings.some(issue => issue.code === 'DUPLICATE_PRODUCT_CODE_CASE'));
  assert.ok(payload.issues.warnings.some(issue => issue.code === 'DUPLICATE_COMPONENT'));
  assert.ok(payload.issues.warnings.some(issue => issue.code === 'FLOWER_NO_SUPPLIER'));
  assert.ok(payload.issues.warnings.some(issue => issue.code === 'SALE_PRICE_MISSING'));

  const products = new Map(payload.products.map(row => [row.product_code, row]));
  assert.equal(products.get('C-UNO').active, false);
  assert.equal(products.get('S-PAPELERA').deleted, true);
  assert.equal(payload.flowers.find(row => row.article_name === 'Eucalyptus').article_code, null);
  assert.equal(payload.flowers.find(row => row.article_name === 'Eucalyptus').active, false);
  assert.equal(payload.variants.filter(row => row.product_key === 'A-TEST-5').length, 5);
  assert.equal(payload.components.find(row => row._key === 'A-TEST-5|1|NAME:EUCALYPTUS|||').stems, '5.0000');
  assert.equal(payload.flowerSuppliers.find(row => row._key === 'CODE:ROS001|HOORN').current_unit_cost, '0.4200');
  assert.equal(payload.preview.information.flowersWithoutArticleCode, 2);
  assert.ok(payload.preview.information.componentsLinkedWithoutArticleCode > 0);
  const noSaleSnapshot = payload.costSnapshots.find(row => row.variant_key === 'P-SIN-FLOR|1');
  assert.equal(noSaleSnapshot.sale_price, null);
  assert.equal(noSaleSnapshot.net_sale_price, null);
  assert.equal(noSaleSnapshot.theoretical_margin_eur, null);
  assert.equal(noSaleSnapshot.theoretical_margin_pct, null);

  const productKeys = new Set(payload.products.map(row => row._key));
  const variantKeys = new Set(payload.variants.map(row => row._key));
  const flowerKeys = new Set(payload.flowers.map(row => row._key));
  const supplierKeys = new Set(payload.suppliers.map(row => row._key));
  payload.variants.forEach(row => assert.ok(productKeys.has(row.product_key)));
  payload.components.forEach(row => {
    assert.ok(productKeys.has(row.product_key));
    assert.ok(variantKeys.has(row.variant_key));
    assert.ok(flowerKeys.has(row.flower_key));
    if (row.preferred_supplier_key) assert.ok(supplierKeys.has(row.preferred_supplier_key));
  });
});

test('deduplica flores sin código solo cuando la coincidencia es segura', () => {
  const duplicates = classifyFlowerDuplicates([
    { articleCode: '', articleName: '  Rosa-Freedom  ', family: 'Rosa', color: 'Rojo', format: '40 cm' },
    { articleCode: null, articleName: 'ROSA FREEDOM', family: 'rosa', color: 'rojo', format: '40 CM' },
    { articleCode: '', articleName: 'Rosa Freedom 60', family: 'Rosa', color: 'Rojo', format: '60 cm' },
    { articleCode: '', articleName: 'Rosa Freedom Roja', family: '', color: '', format: '' }
  ]);
  assert.equal(duplicates.safe.length, 1);
  assert.ok(duplicates.distinct.some(item => item.reason === 'different_length_or_number' || item.reason === 'different_format'));
  assert.ok(duplicates.possible.length >= 1);

  const state = sampleState();
  state.flowers.push({
    articleCode: null,
    articleName: 'EUCALYPTUS',
    primarySupplier: 'Flora Verde',
    active: false,
    providers: []
  });
  const payload = buildNomenclatureMigrationPayload(state, { effectiveDate: '2026-07-27' });
  assert.equal(payload.preview.canMigrate, true);
  assert.equal(payload.flowers.filter(row => row.article_name.toUpperCase() === 'EUCALYPTUS').length, 1);
  assert.equal(payload.quality.safeFlowerMatches.length, 1);
  assert.equal(payload.flowers.some(row => /^FL-\d+$/i.test(row.article_code || '')), false);
  assert.ok(payload.flowerSuppliers.some(row => row.supplier_article_code === null));
});

test('calcula coste, PVP neto y margen con precisión decimal', () => {
  const result = calculateTheoreticalEconomics({
    salePrice: 33,
    vatRate: 10,
    components: [
      { articleCode: 'ROS001', stems: 10, unitCost: 0.42 },
      { articleCode: 'VER001', stems: 5, unitCost: 0.18 }
    ]
  });
  assert.equal(result.theoreticalCost, '5.1000');
  assert.equal(result.netSalePrice, '30.0000');
  assert.equal(result.theoreticalMarginEur, '24.9000');
  assert.equal(result.theoreticalMarginPct, '83.0000');
  assert.deepEqual(result.missingCosts, []);
});

test('conserva histórico de costes y cierra la vigencia anterior', () => {
  let history = appendCostHistory([], {
    unitCost: 0.40,
    validFrom: '2026-01-01',
    source: 'manual'
  });
  history = appendCostHistory(history, {
    unitCost: 0.50,
    validFrom: '2026-02-01',
    source: 'manual'
  });
  assert.equal(history.length, 2);
  assert.deepEqual(history.map(row => [row.unitCost, row.validFrom, row.validTo]), [
    ['0.4000', '2026-01-01', '2026-01-31'],
    ['0.5000', '2026-02-01', null]
  ]);
});

test('conserva histórico de PVP y cierra la vigencia anterior', () => {
  let history = appendSalePriceHistory([], {
    salePrice: 30,
    vatRate: 10,
    validFrom: '2026-01-01',
    source: 'manual'
  });
  history = appendSalePriceHistory(history, {
    salePrice: 33,
    vatRate: 10,
    validFrom: '2026-02-01',
    source: 'manual'
  });
  assert.deepEqual(history.map(row => [row.salePrice, row.validFrom, row.validTo]), [
    ['30.0000', '2026-01-01', '2026-01-31'],
    ['33.0000', '2026-02-01', null]
  ]);
});

test('prepara una factura futura y deja trazable su línea', () => {
  const result = transformSupplierInvoice({
    supplierName: 'Hoorn',
    invoiceNumber: 'F2026-001',
    invoiceDate: '2026-07-15',
    currency: 'EUR',
    lines: [{
      supplierArticleCode: 'ROS001',
      description: 'Rosa Freedom',
      quantity: 500,
      unit: 'tallo',
      unitCost: 0.475
    }, {
      supplierArticleCode: '',
      description: 'Flor sin código asignada manualmente',
      quantity: 10,
      unit: 'tallo',
      unitCost: 0.25,
      flowerId: '11111111-1111-1111-1111-111111111111'
    }]
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.invoice.invoiceKey, 'HOORN|F2026-001');
  assert.equal(result.lines[0].quantity, '500.0000');
  assert.equal(result.lines[0].unitCost, '0.4750');
  assert.equal(result.lines[0].lineTotal, '237.5000');
  assert.equal(result.lines[0].matchStatus, 'unmatched');
  assert.equal(result.lines[1].flowerArticleCode, '');
  assert.equal(result.lines[1].flowerId, '11111111-1111-1111-1111-111111111111');
  assert.equal(result.lines[1].matchStatus, 'matched');
  assert.equal(result.lines[1].matchMethod, 'manual');
  assert.equal(result.lines[1].normalizedDescription, 'FLOR SIN CODIGO ASIGNADA MANUALMENTE');
});

test('detecta datos críticos y bloquea la migración', () => {
  const state = sampleState();
  state.nomenclatures.push(line({
    productCode: 'C-ERROR',
    productName: 'Error',
    category: 'NO_VALIDA',
    articleCode: '',
    articleName: 'Flor sin código',
    stemsPerBouquet: 'abc',
    salePrice: 'mal'
  }));
  const payload = buildNomenclatureMigrationPayload(state, { effectiveDate: '2026-07-27' });
  assert.equal(payload.preview.canMigrate, false);
  assert.ok(payload.issues.errors.some(issue => issue.code === 'PRODUCT_CATEGORY_INVALID'));
  assert.ok(payload.issues.errors.some(issue => issue.code === 'SALE_PRICE_INVALID'));
  assert.ok(payload.issues.errors.some(issue => issue.code === 'STEMS_INVALID'));
});

test('compara la copia local con la forma relacional de Supabase', () => {
  const payload = buildNomenclatureMigrationPayload(sampleState(), { effectiveDate: '2026-07-27' });
  const remote = remoteFromPayload(payload);
  assert.equal(compareNomenclaturePayload(payload, remote).matches, true);
  remote.variants[0].sale_price = '33.0001';
  const rounded = compareNomenclaturePayload(payload, remote);
  assert.ok(rounded.differences.some(diff => diff.entity === 'variant' && diff.field === 'sale_price' && diff.kind === 'rounding'));
  remote.variants[0].sale_price = payload.variants[0].sale_price;
  remote.components[0].stems = '999.0000';
  remote.flowerSuppliers[0].current_unit_cost = '9.9999';
  const changed = compareNomenclaturePayload(payload, remote);
  assert.equal(changed.matches, false);
  assert.ok(changed.differences.some(diff => diff.entity === 'component' && diff.field === 'stems'));
  assert.ok(changed.differences.some(diff => diff.entity === 'flower_supplier' && diff.field === 'current_unit_cost'));
  assert.ok(changed.differences.some(diff => diff.entity === 'economics' && diff.field === 'theoretical_cost'));
});

test('la migración es manual y dry-run por defecto', async () => {
  const preview = await migrateNomenclaturesToSupabase({
    state: sampleState(),
    effectiveDate: '2026-07-27'
  });
  assert.equal(preview.preview.canMigrate, true);
  assert.equal(preview.preview.products, 4);
  await assert.rejects(
    migrateNomenclaturesToSupabase({ state: sampleState(), dryRun: false }),
    /requiere.*confirmed:true/i
  );
  const invalid = sampleState();
  invalid.nomenclatures.push(line({
    productCode: 'C-HUERFANO',
    productName: 'Componente huérfano',
    category: 'COMPUESTOS',
    articleCode: '',
    articleName: '',
    stemsPerBouquet: 5
  }));
  await assert.rejects(
    migrateNomenclaturesToSupabase({ state: invalid, dryRun: false, confirmed: true }),
    /migración bloqueada/i
  );
});

test('previsualiza los datos operativos actuales sin exigir códigos de flor', { skip: !fs.existsSync(path.join(__dirname, 'Datos', 'aquarelle-stock-datos.json')) }, () => {
  const current = JSON.parse(fs.readFileSync(path.join(__dirname, 'Datos', 'aquarelle-stock-datos.json'), 'utf8'));
  const payload = buildNomenclatureMigrationPayload(current, { effectiveDate: '2026-07-27' });
  assert.equal(payload.preview.products, 19);
  assert.equal(payload.preview.variants, 57);
  assert.equal(current.flowers.length, 51);
  assert.equal(current.flowers.every(flower => !String(flower.articleCode || '').trim()), true);
  assert.equal(payload.preview.flowers, 51);
  assert.equal(payload.preview.components, 247);
  assert.equal(payload.preview.errors, 0);
  assert.equal(payload.preview.canMigrate, true);
  assert.equal(payload.preview.information.flowersWithoutArticleCode, 51);
  assert.equal(payload.preview.information.componentsLinkedWithoutArticleCode, 247);
  assert.equal(payload.preview.information.componentsOrphaned, 0);
  assert.equal(payload.preview.information.emptyRowsIgnored, 3);
  assert.equal(payload.preview.information.productRowsWithoutCode, 3);
  assert.equal(payload.preview.information.productRowsWithDataWithoutCode, 0);
  assert.equal(payload.preview.information.orphanPriceCatalogs, 3);
  assert.equal(payload.preview.information.variantsWithoutSalePrice, 2);
});

test('el SQL es no destructivo y contiene el contrato relacional completo', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'supabase-nomenclatures.sql'), 'utf8');
  const expectedTables = [
    'nomenclature_products',
    'nomenclature_variants',
    'nomenclature_flowers',
    'suppliers',
    'nomenclature_flower_suppliers',
    'nomenclature_recipe_versions',
    'nomenclature_components',
    'flower_cost_history',
    'product_sale_price_history',
    'product_cost_snapshots',
    'supplier_invoices',
    'supplier_invoice_lines'
  ];
  expectedTables.forEach(tableName => {
    assert.match(sql, new RegExp(`create table if not exists public\\.${tableName}\\b`, 'i'));
    assert.match(sql, new RegExp(`alter table public\\.%I enable row level security|${tableName}`, 'i'));
  });
  assert.doesNotMatch(sql, /^\s*drop\s+table\b/im);
  assert.doesNotMatch(sql, /^\s*delete\s+from\b/im);
  assert.doesNotMatch(sql, /create\s+policy[\s\S]{0,120}\bfor\s+delete\b/i);
  assert.match(sql, /record_nomenclature_flower_cost/i);
  assert.match(sql, /record_nomenclature_sale_price/i);
  assert.match(sql, /source_key text unique/i);
  assert.match(sql, /migration_match_key text not null unique/i);
  assert.doesNotMatch(sql, /article_code text not null/i);
  assert.match(sql, /article_code text unique/i);
  assert.equal((sql.match(/\$\$/g) || []).length % 2, 0);
  assert.equal((sql.match(/\$[a-z_]+\$/gi) || []).length % 2, 0);
});
