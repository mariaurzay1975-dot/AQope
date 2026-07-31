'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_MINIMUM_MARGIN_PERCENT,
  HIGH_MARGIN_PERCENT,
  analyzeProduct,
  analyzeProductEconomics,
  analyzeProductNomenclatureQuality,
  applyFlowerSubstitution,
  buildOperationalProductModels,
  calculateVariantEconomics,
  classifyProductMargin,
  classifyVariantMargin,
  copyCompositionBetweenPrices,
  createEditorSnapshot,
  duplicateProductModel,
  buildMarginDashboardItems,
  filterProductsByQuality,
  filterMarginDashboardItems,
  groupMarginAlerts,
  isEditorDirty,
  moveCompositionLine,
  normalizeMinimumMarginPercent,
  previewFlowerCostImpact,
  previewFlowerSubstitution,
  sortMarginDashboardItems,
  summarizeMarginDashboard,
  summarizeProductAnalyses
} = require('./nomenclature-ux.js');
const {
  buildMasterFlowerCatalog,
  canonicalizeExistingFlowerLine,
  findMasterFlowerEntry
} = require('./nomenclature-flower-usage.js');

function product(overrides = {}) {
  return {
    productCode: '100',
    productName: 'Ramo prueba',
    priceCount: 2,
    prices: [33, 44],
    minimumMarginPercent: 70,
    flowers: [{ articleName: 'Rosa', unitCost: 1, active: true, stems: { 1: 5, 2: 7 }, _masterFlowerKey: 'NAME:ROSA' }],
    ...overrides
  };
}

test('dirty-state detecta cambios reales y no confunde propiedades transitorias', () => {
  const initial = product();
  const snapshot = createEditorSnapshot(initial);
  assert.equal(isEditorDirty(snapshot, product()), false);
  assert.equal(isEditorDirty(snapshot, product({ productName: 'Otro nombre' })), true);
  assert.equal(isEditorDirty(snapshot, { ...product(), _temporary: true }), false);
  assert.equal(isEditorDirty(snapshot, product({ flowers: [{ ...product().flowers[0], stems: { 1: 6, 2: 7 } }] })), true);
});

test('dirty-state conserva el viaje interno Nueva flor y permite descartar', () => {
  const current = product({ notes: 'Cambio sin guardar' });
  const snapshot = createEditorSnapshot(current);
  const internalRoundTrip = JSON.parse(JSON.stringify(current));
  assert.equal(isEditorDirty(snapshot, internalRoundTrip), false);
  internalRoundTrip.flowers.push({ articleName: 'Nueva', stems: { 1: 1 } });
  assert.equal(isEditorDirty(snapshot, internalRoundTrip), true);
  assert.equal(isEditorDirty(snapshot, JSON.parse(snapshot)), false);
});

test('calidad separa completa, incompleta, error y advertencia por flor inactiva', () => {
  const complete = analyzeProductNomenclatureQuality(product(), { isKnownFlower: () => true });
  assert.equal(complete.status, 'complete');
  const incomplete = analyzeProductNomenclatureQuality(product({ prices: [33, ''], flowers: [{ ...product().flowers[0], unitCost: '' }] }), { isKnownFlower: () => true });
  assert.equal(incomplete.status, 'incomplete');
  assert.match(incomplete.warnings.join(' | '), /sin PVP|sin coste/);
  const error = analyzeProductNomenclatureQuality(product({ flowers: [{ articleName: 'Desconocida', stems: { 1: -1 } }] }), { isKnownFlower: () => false });
  assert.equal(error.status, 'error');
  const inactive = analyzeProductNomenclatureQuality(product({ flowers: [{ ...product().flowers[0], active: false }] }), { isKnownFlower: () => true });
  assert.equal(inactive.status, 'incomplete');
  assert.match(inactive.warnings.join(' | '), /inactiva/);
});

test('filtro de calidad se combina sin alterar la lista original', () => {
  const products = [{ key: '1' }, { key: '2' }, { key: '3' }];
  const analyses = new Map([
    ['1', { quality: { status: 'complete' } }],
    ['2', { quality: { status: 'incomplete' } }],
    ['3', { quality: { status: 'error' } }]
  ]);
  assert.deepEqual(filterProductsByQuality(products, analyses, 'incomplete').map(item => item.key), ['2']);
  assert.equal(products.length, 3);
});

test('margen minimo usa 70 por defecto y valida el rango', () => {
  assert.equal(DEFAULT_MINIMUM_MARGIN_PERCENT, 70);
  assert.equal(normalizeMinimumMarginPercent(''), 70);
  assert.equal(normalizeMinimumMarginPercent(undefined), 70);
  assert.equal(normalizeMinimumMarginPercent(-1), 70);
  assert.equal(normalizeMinimumMarginPercent(101), 70);
  assert.equal(normalizeMinimumMarginPercent('75'), 75);
  assert.equal(normalizeMinimumMarginPercent(0), 0);
  assert.equal(normalizeMinimumMarginPercent(100), 100);
});

test('economia calcula PVP neto, coste, margen y actualiza tallos, PVP y coste', () => {
  const base = analyzeProductEconomics(product({ priceCount: 1, prices: [33] })).variants[0];
  assert.ok(Math.abs(base.pvpNet - 30) < 1e-9);
  assert.equal(base.cost, 5);
  assert.ok(Math.abs(base.marginAmount - 25) < 1e-9);
  assert.ok(Math.abs(base.marginPercent - 83.33333333333334) < 1e-9);
  const stems = analyzeProductEconomics(product({ priceCount: 1, prices: [33], flowers: [{ ...product().flowers[0], stems: { 1: 10 } }] })).variants[0];
  const pvp = analyzeProductEconomics(product({ priceCount: 1, prices: [44] })).variants[0];
  const cost = analyzeProductEconomics(product({ priceCount: 1, prices: [33], flowers: [{ ...product().flowers[0], unitCost: 2 }] })).variants[0];
  assert.equal(stems.cost, 10);
  assert.ok(pvp.pvpNet > base.pvpNet);
  assert.equal(cost.cost, 10);
});

test('margen bajo compara estrictamente contra el minimo y reacciona al cambio', () => {
  const atMinimum = calculateVariantEconomics({ pvp: 110, cost: 25, minimumMarginPercent: 75 });
  assert.equal(atMinimum.marginPercent, 75);
  assert.equal(atMinimum.lowMargin, false);
  const below = calculateVariantEconomics({ pvp: 110, cost: 25.1, minimumMarginPercent: 75 });
  assert.equal(below.lowMargin, true);
  assert.ok(below.marginPercent < 75);
  const relaxed = calculateVariantEconomics({ pvp: 110, cost: 25.1, minimumMarginPercent: 70 });
  assert.equal(relaxed.lowMargin, false);
});

test('clasificacion economica respeta 79 alto y el minimo individual', () => {
  assert.equal(HIGH_MARGIN_PERCENT, 79);
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 79, minimumMarginPercent: 70 }), 'high');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 78.9, minimumMarginPercent: 70 }), 'normal');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 70, minimumMarginPercent: 70 }), 'normal');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 69.9, minimumMarginPercent: 70 }), 'low');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 74.9, minimumMarginPercent: 75 }), 'low');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 75, minimumMarginPercent: 75 }), 'normal');
  assert.equal(classifyVariantMargin({ calculable: true, marginPercent: 80, minimumMarginPercent: 85 }), 'low');
  assert.equal(classifyVariantMargin({ calculable: false, marginPercent: '', minimumMarginPercent: 70 }), 'no-data');
});

test('clasificacion de producto aplica la peor variante e informa datos parciales', () => {
  const v = (marginPercent, minimumMarginPercent = 70) => ({ calculable: true, marginPercent, minimumMarginPercent });
  assert.equal(classifyProductMargin({ variants: [v(82), v(79)] }).status, 'high');
  assert.equal(classifyProductMargin({ variants: [v(82), v(75)] }).status, 'normal');
  assert.equal(classifyProductMargin({ variants: [v(82), v(69)] }).status, 'low');
  assert.equal(classifyProductMargin({ variants: [{ calculable: false, marginPercent: '', minimumMarginPercent: 70 }] }).status, 'no-data');
  const partial = classifyProductMargin({ variants: [v(80), { calculable: false, marginPercent: '', minimumMarginPercent: 70 }] });
  assert.equal(partial.status, 'high');
  assert.equal(partial.incompleteData, true);
  assert.equal(partial.lowestMarginPercent, 80);
});

test('dashboard resume, filtra, busca y ordena sin mutar los analisis', () => {
  const analysis = (code, name, category, marginPercent, minimumMarginPercent = 70) => ({
    productCode: code,
    productName: name,
    category,
    quality: { status: 'complete', warnings: [], errors: [] },
    economy: { minimumMarginPercent, variants: marginPercent === null ? [{ calculable: false, marginPercent: '', minimumMarginPercent }] : [{ calculable: true, marginPercent, minimumMarginPercent }] }
  });
  const source = [analysis('20', 'Alto', 'ROSAS', 80), analysis('3', 'Normal', 'SIMPLES', 75), analysis('1', 'Bajo', 'ROSAS', 65), analysis('4', 'Sin PVP', 'PLANTAS', null)];
  const items = buildMarginDashboardItems(source);
  assert.deepEqual(summarizeMarginDashboard(items), { total: 4, high: 1, normal: 1, low: 1, noData: 1 });
  assert.deepEqual(filterMarginDashboardItems(items, { status: 'low' }).map(item => item.productCode), ['1']);
  assert.deepEqual(filterMarginDashboardItems(items, { category: 'ROSAS' }).map(item => item.productCode), ['20', '1']);
  assert.deepEqual(filterMarginDashboardItems(items, { query: 'sin pvp' }).map(item => item.productCode), ['4']);
  assert.deepEqual(sortMarginDashboardItems(items, 'margin-asc').map(item => item.productCode), ['1', '3', '20', '4']);
  assert.deepEqual(sortMarginDashboardItems(items, 'margin-desc').map(item => item.productCode), ['20', '3', '1', '4']);
  assert.deepEqual(sortMarginDashboardItems(items, 'code').map(item => item.productCode), ['1', '3', '4', '20']);
  assert.equal(source[0].margin, undefined);
});

test('alertas de margen agrupan variantes por producto', () => {
  const analyses = [
    analyzeProduct(product({ productCode: '1', productName: 'Uno', minimumMarginPercent: 90 })),
    analyzeProduct(product({ productCode: '2', productName: 'Dos', minimumMarginPercent: 10 }))
  ];
  const alerts = groupMarginAlerts(analyses);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].productCode, '1');
  assert.deepEqual(alerts[0].variants.map(item => item.priceNumber), [1, 2]);
  assert.deepEqual(summarizeProductAnalyses(analyses), { products: 2, complete: 2, incomplete: 0, errors: 0, lowMargin: 1, withoutCalculableMargin: 0 });
});

test('duplicacion avanzada respeta opciones, copia margen y no crea flores nuevas', () => {
  const original = product({ notes: 'Privado', minimumMarginPercent: 77 });
  const full = duplicateProductModel(original, { productCode: '200', productName: 'Copia', copyComposition: true, copyPrices: true, copyNotes: true });
  assert.equal(full.minimumMarginPercent, 77);
  assert.deepEqual(full.flowers, original.flowers);
  assert.notEqual(full.flowers, original.flowers);
  assert.deepEqual(full.prices, original.prices);
  assert.equal(full.notes, 'Privado');
  assert.equal(full.active, true);
  const empty = duplicateProductModel(original, { productCode: '201', productName: 'Vacia', copyComposition: false, copyPrices: false, copyNotes: false });
  assert.deepEqual(empty.flowers, []);
  assert.deepEqual(empty.prices, ['', '']);
  assert.equal(empty.notes, '');
});

test('copia composicion exacta a varios precios y exige confirmar sobrescritura', () => {
  const lines = [
    { articleName: 'A', stems: { 1: 5, 2: 9, 3: 0 } },
    { articleName: 'B', stems: { 1: 2, 2: 0, 3: 0 } }
  ];
  const blocked = copyCompositionBetweenPrices(lines, 1, [2, 3]);
  assert.equal(blocked.applied, false);
  assert.deepEqual(blocked.conflicts, [2]);
  const applied = copyCompositionBetweenPrices(lines, 1, [2, 3], { replace: true });
  assert.deepEqual(applied.lines.map(line => [line.stems[2], line.stems[3]]), [[5, 5], [2, 2]]);
  assert.deepEqual(applied.lines.map(line => line.articleName), ['A', 'B']);
});

test('orden mueve arriba y abajo conservando tallos y coste', () => {
  const lines = [
    { articleName: 'A', unitCost: 1, stems: { 1: 2 } },
    { articleName: 'B', unitCost: 3, stems: { 1: 4 } }
  ];
  const moved = moveCompositionLine(lines, 1, -1);
  assert.deepEqual(moved.map(line => line.articleName), ['B', 'A']);
  assert.deepEqual(moved.find(line => line.articleName === 'A').stems, { 1: 2 });
  assert.equal(analyzeProductEconomics(product({ priceCount: 1, flowers: lines })).variants[0].cost, analyzeProductEconomics(product({ priceCount: 1, flowers: moved })).variants[0].cost);
});

test('impacto de coste calcula antes/despues y detecta cruce de margen', () => {
  const models = [
    product({ productCode: '1', priceCount: 1, prices: [110], minimumMarginPercent: 70, flowers: [{ articleName: 'Rosa', unitCost: 1, stems: { 1: 20 }, _masterFlowerKey: 'NAME:ROSA' }] }),
    product({ productCode: '2', priceCount: 1, prices: [110], minimumMarginPercent: 70, flowers: [{ articleName: 'Rosa', unitCost: 1, stems: { 1: 10 }, _masterFlowerKey: 'NAME:ROSA' }] })
  ];
  const impact = previewFlowerCostImpact(models, 'NAME:ROSA', 4);
  assert.equal(impact.affectedProducts, 2);
  assert.equal(impact.products[0].before.variants[0].cost, 20);
  assert.equal(impact.products[0].after.variants[0].cost, 80);
  assert.equal(impact.products[0].newlyLow[0], 1);
  assert.equal(impact.newlyLowProducts, 2);
});

test('sustitucion parcial conserva tallos y suma cuando el destino ya existe', () => {
  const models = [
    product({ productCode: '1', flowers: [
      { articleName: 'Origen', unitCost: 1, stems: { 1: 10, 2: 4 }, _masterFlowerKey: 'NAME:ORIGEN' },
      { articleName: 'Destino', unitCost: 2, stems: { 1: 5, 2: 1 }, _masterFlowerKey: 'NAME:DESTINO' }
    ] }),
    product({ productCode: '2', flowers: [{ articleName: 'Origen', unitCost: 1, stems: { 1: 3 }, _masterFlowerKey: 'NAME:ORIGEN' }] })
  ];
  const destination = { key: 'NAME:DESTINO', articleName: 'Destino', unitCost: 2 };
  const preview = previewFlowerSubstitution(models, 'NAME:ORIGEN', destination, ['1']);
  assert.equal(preview.products.length, 1);
  const resultLine = preview.products[0].resultModel.flowers.find(line => line.articleName === 'Destino');
  assert.deepEqual(resultLine.stems, { 1: 15, 2: 5 });
  assert.equal(applyFlowerSubstitution(preview).applied, false);
  const applied = applyFlowerSubstitution(preview, { confirmed: true });
  assert.equal(applied.models.length, 1);
  assert.equal(applied.models[0].productCode, '1');
});

test('UX integra proteccion, calidad, economia, operaciones e historicos sin inventarlos', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="unsavedProductModal"/);
  assert.match(html, /id="nomenclatureQualityFilter"/);
  assert.match(html, /id="productEditMinimumMargin"/);
  assert.match(html, /id="productEconomicsTable"/);
  assert.match(html, /id="nomenclatureMarginAlerts"/);
  assert.match(html, /id="btnViewMargins"/);
  assert.match(html, /id="nomenclatureMarginsView"/);
  assert.match(html, /id="marginDashboardKpis"/);
  assert.match(html, /id="marginDistributionBar"/);
  assert.match(html, /id="marginDashboardStatusFilter"/);
  assert.match(html, /id="marginDashboardCategoryFilter"/);
  assert.match(html, /id="marginDashboardSearch"/);
  assert.match(html, /id="marginDashboardSort"/);
  assert.match(html, /id="marginDashboardList"/);
  assert.match(html, /id="marginDetailModal"/);
  assert.match(html, /id="btnMarginsBack"/);
  assert.match(html, /data-margin-action="edit"/);
  assert.match(html, /openProductEditorSafely\(summary\)/);
  assert.match(html, /id="flowerCostImpactModal"/);
  assert.match(html, /id="duplicateProductModal"/);
  assert.match(html, /id="flowerSubstitutionModal"/);
  assert.match(html, /id="copyCompositionModal"/);
  assert.match(html, /data-editor-action="move-up"/);
  assert.match(html, /id="btnProductUndo"/);
  assert.match(html, /Sin historico registrado/);
  assert.match(html, /event\.key\.toLowerCase\(\) === 's'/);
});

test('modelo operativo conserva variantes declaradas y detecta PVP ausentes', () => {
  const state = {
    nomenclatures: [{
      productCode: '56058', productName: 'C-Lys_champetre', category: 'COMPUESTOS',
      priceNumber: 1, size: '1', salePrice: 31,
      articleName: 'Eucalyptus', stemsPerBouquet: 5, unitCost: 0.2, active: true
    }],
    productPriceCatalog: { '56058': { priceCount: 3, prices: [31, '', ''] } }
  };
  const models = buildOperationalProductModels(state);
  assert.equal(models.length, 1);
  assert.equal(models[0].priceCount, 3);
  assert.deepEqual(models[0].prices, [31, '', '']);
  const analysis = analyzeProduct(models[0], { isKnownFlower: () => true });
  assert.deepEqual(analysis.economy.variants.map(variant => variant.priceNumber), [1, 2, 3]);
  assert.equal(analysis.economy.withoutCalculableMargin, 2);
});

test('analiza los datos operativos sin modificar el JSON', { skip: !fs.existsSync(path.join(__dirname, 'Datos', 'aquarelle-stock-datos.json')) }, () => {
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, 'Datos', 'aquarelle-stock-datos.json'), 'utf8'));
  const visibleFlowers = buildMasterFlowerCatalog(state.flowers || []);
  assert.ok(visibleFlowers.length <= (state.flowers || []).length);
  assert.equal(new Set(visibleFlowers.map(entry => entry.key)).size, visibleFlowers.length);
  assert.equal(visibleFlowers.filter(entry => entry.flower.articleName === 'ROSE RED NAOMI 40/50 CM').length, 1);
  assert.equal(visibleFlowers.some(entry => entry.flower.articleName === 'ROSE RED NAOMI 4050 CM'), false);
  const allFlowers = buildMasterFlowerCatalog(state.flowers || [], { includeInactive: true });
  const models = buildOperationalProductModels(state, { canonicalizeFlowerLine: line => canonicalizeExistingFlowerLine(line, state.flowers || []) });
  const analyses = models.map(model => analyzeProduct(model, { isKnownFlower: line => !!findMasterFlowerEntry(allFlowers, line) }));
  const summary = summarizeProductAnalyses(analyses);
  const sourceProductCodes = new Set((state.nomenclatures || []).filter(line => !line.deleted).map(line => String(line.productCode || '').trim()).filter(Boolean));
  assert.deepEqual(new Set(models.map(model => model.productCode)), sourceProductCodes);
  assert.equal(summary.products, models.length);
  assert.equal(summary.complete + summary.incomplete + summary.errors, models.length);
  assert.equal(summary.withoutCalculableMargin, analyses.reduce((count, analysis) => count + analysis.economy.variants.filter(variant => !variant.calculable).length, 0));
});
