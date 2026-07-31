'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  applyMasterFlowerToLine,
  buildMasterFlowerCatalog,
  buildFlowerUsageEntries,
  canonicalizeExistingFlowerLine,
  cloneProductEditorDraft,
  deleteUnusedFlower,
  findMasterFlowerEntry,
  flowerUsageCountLabel,
  flowerUsagePresentation,
  navigateToFlowerUsageProduct,
  planFlowerDeletion,
  resolveSelectableFlowerForLine,
  restoreProductEditorDraft,
  searchMasterFlowerCatalog,
  setFlowerActiveByIdentity
} = require('./nomenclature-flower-usage.js');

function flower(articleName, overrides = {}) {
  return { id: articleName, articleCode: '', articleName, active: true, providers: [], ...overrides };
}

function line(productCode, articleName, overrides = {}) {
  return {
    productCode,
    productName: `Ramo ${productCode}`,
    category: 'COMPUESTOS',
    articleCode: '',
    articleName,
    priceNumber: 1,
    active: true,
    deleted: false,
    ...overrides
  };
}

test('cuenta productos únicos sin duplicar variantes y mantiene flores no utilizadas', () => {
  const entries = buildFlowerUsageEntries(
    [flower('Rosa Freedom'), flower('Eucalyptus'), flower('Flor sin uso')],
    [
      line('100', 'Rosa Freedom', { priceNumber: 1 }),
      line('100', 'Rosa Freedom', { priceNumber: 2 }),
      line('200', 'Rosa Freedom'),
      line('100', 'Eucalyptus')
    ]
  );
  const rose = entries.find(entry => entry.flower.articleName === 'Rosa Freedom');
  const eucalyptus = entries.find(entry => entry.flower.articleName === 'Eucalyptus');
  const unused = entries.find(entry => entry.flower.articleName === 'Flor sin uso');
  assert.deepEqual(rose.products.map(product => product.code), ['100', '200']);
  assert.equal(new Set(rose.products.map(product => product.code)).size, rose.products.length);
  assert.equal(eucalyptus.products.length, 1);
  assert.equal(unused.products.length, 0);
  assert.equal(flowerUsageCountLabel(0), 'No utilizada');
  assert.equal(flowerUsageCountLabel(1), '1 ramo');
  assert.equal(flowerUsageCountLabel(2), '2 ramos');
  const listingPresentation = flowerUsagePresentation(rose);
  const modalPresentation = flowerUsagePresentation(rose);
  assert.deepEqual(modalPresentation.products, listingPresentation.products);
  assert.equal(modalPresentation.label, '2 ramos');
});

test('muestra productos activos, inactivos y en papelera', () => {
  const entries = buildFlowerUsageEntries(
    [flower('Rosa Freedom')],
    [
      line('ACT', 'Rosa Freedom'),
      line('INA', 'Rosa Freedom', { active: false }),
      line('DEL', 'Rosa Freedom', { active: false, deleted: true })
    ]
  );
  const statuses = Object.fromEntries(entries[0].products.map(product => [product.code, product.status]));
  assert.deepEqual(statuses, { ACT: 'active', DEL: 'deleted', INA: 'inactive' });
});

test('consolida Red Naomi y reúne productos de ambas denominaciones', () => {
  const entries = buildFlowerUsageEntries(
    [
      flower('ROSE RED NAOMI 4050 CM', { family: 'Rosa GR', color: 'Rojo' }),
      flower('ROSE RED NAOMI 40/50 CM', { family: '', color: '' })
    ],
    [
      line('37006', 'ROSE RED NAOMI 4050 CM'),
      line('37006', 'ROSE RED NAOMI 40/50 CM', { priceNumber: 2 }),
      line('32486', 'ROSE RED NAOMI 40/50 CM')
    ]
  );
  assert.equal(entries.length, 1);
  assert.equal(entries[0].flower.articleName, 'ROSE RED NAOMI 40/50 CM');
  assert.equal(entries[0].flower.family, 'Rosa GR');
  assert.equal(entries[0].flower.color, 'Rojo');
  assert.deepEqual(entries[0].products.map(product => product.code), ['32486', '37006']);
});

test('navega desde el detalle de flor al editor existente del producto', async () => {
  const calls = [];
  const summary = { key: '35641', productName: 'Ramo Toscana' };
  const opened = await navigateToFlowerUsageProduct('35641', {
    closeUsage: () => calls.push('close'),
    selectProducts: code => calls.push(`tab:${code}`),
    renderProducts: () => calls.push('render'),
    findProduct: code => code === '35641' ? summary : null,
    openEditor: product => calls.push(`edit:${product.key}`)
  });
  assert.equal(opened, true);
  assert.deepEqual(calls, ['close', 'tab:35641', 'render', 'edit:35641']);
});

test('el modal de flor reutiliza la misma lista y navegación de Ramos por flor', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /id="flowerEditorUsageSection"/);
  assert.match(html, /function renderFlowerEditorUsage\(usageEntry\)[\s\S]*flowerUsagePresentation\(usageEntry\)/);
  assert.match(html, /openFlowerEditor\(entry\.flower,entry\)/);
  assert.match(html, /data-flower-editor-product[\s\S]*editFlowerUsageProduct\(btn\.dataset\.flowerEditorProduct\)/);
  assert.match(html, /\.flower-editor-grid textarea\{height:64px;min-height:64px;max-height:160px/);
  assert.match(html, /\.flower-editor-usage-list\{[\s\S]*max-height:112px;overflow-y:auto/);
});

test('el selector maestro ofrece flores activas y Red Naomi una sola vez', () => {
  const flowers = [
    flower('ROSE RED NAOMI 4050 CM'),
    flower('ROSE RED NAOMI 40/50 CM'),
    flower('Rosa Freedom'),
    flower('Flor inactiva', { active: false })
  ];
  const catalog = buildMasterFlowerCatalog(flowers);
  assert.deepEqual(catalog.map(entry => entry.flower.articleName), ['Rosa Freedom', 'ROSE RED NAOMI 40/50 CM']);
  assert.equal(catalog.filter(entry => entry.flower.articleName.includes('RED NAOMI')).length, 1);
  assert.deepEqual(searchMasterFlowerCatalog(catalog, 'naomi').map(entry => entry.flower.articleName), ['ROSE RED NAOMI 40/50 CM']);
  assert.equal(findMasterFlowerEntry(catalog, 'ROSE RED NAOMI 4050 CM').flower.articleName, 'ROSE RED NAOMI 40/50 CM');
});

test('una flor inactiva existente se conserva pero no se ofrece para líneas nuevas', () => {
  const flowers = [flower('Flor activa'), flower('Flor inactiva', { active: false })];
  const existing = canonicalizeExistingFlowerLine({ articleName: 'Flor inactiva', stems: { 1: 7 }, notes: 'Conservar' }, flowers);
  assert.equal(buildMasterFlowerCatalog(flowers).some(entry => entry.flower.articleName === 'Flor inactiva'), false);
  assert.equal(resolveSelectableFlowerForLine(existing, flowers).flower.articleName, 'Flor inactiva');
  assert.equal(resolveSelectableFlowerForLine({ articleName: 'Flor inactiva' }, flowers), null);
  assert.deepEqual(existing.stems, { 1: 7 });
  assert.equal(existing.notes, 'Conservar');
});

test('seleccionar o crear una flor aplica proveedor y coste sin perder tallos ni observaciones', () => {
  const entry = buildMasterFlowerCatalog([
    flower('Flor nueva', {
      primarySupplier: 'Proveedor Uno',
      providers: [{ supplier: 'Proveedor Uno', price: 0.35, unit: 'tallo' }]
    })
  ])[0];
  const line = { articleName: '', stems: { 1: 5, 2: 8 }, notes: 'Pendiente', active: true };
  const selected = applyMasterFlowerToLine(line, entry);
  assert.equal(selected.articleName, 'Flor nueva');
  assert.equal(selected.supplier, 'Proveedor Uno');
  assert.equal(selected.unitCost, 0.35);
  assert.deepEqual(selected.stems, { 1: 5, 2: 8 });
  assert.equal(selected.notes, 'Pendiente');
});

test('guardar o cancelar Nueva flor restaura el borrador sin mutarlo', () => {
  const draft = cloneProductEditorDraft({
    originalKey: '35641',
    fields: { productCode: '35641', productName: 'Ramo Toscana', notes: 'Sin guardar' },
    prices: [33, 40],
    lines: [{ articleName: '', stems: { 1: 4 }, notes: 'Línea pendiente' }],
    targetLineIndex: 0
  });
  const cancelled = restoreProductEditorDraft(draft);
  assert.deepEqual(cancelled, draft);
  const entry = buildMasterFlowerCatalog([flower('Flor recién creada')])[0];
  const saved = restoreProductEditorDraft(draft, entry);
  assert.equal(saved.originalKey, '35641');
  assert.deepEqual(saved.prices, [33, 40]);
  assert.equal(saved.fields.notes, 'Sin guardar');
  assert.equal(saved.lines[0].articleName, 'Flor recién creada');
  assert.deepEqual(saved.lines[0].stems, { 1: 4 });
  assert.equal(draft.lines[0].articleName, '');
});

test('el flujo Nueva flor del editor restringe el catálogo y reutiliza el modal existente', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /buildMasterFlowerCatalog\(flowers\)/);
  assert.match(html, /data-editor-action="new-flower"/);
  assert.match(html, /openFlowerEditor\(null\)/);
  assert.match(html, /restoreProductEditorAfterFlower/);
  assert.match(html, /resolveSelectableFlowerForLine/);
  assert.match(html, /findMasterFlowerEntry/);
});

test('elimina una flor activa o inactiva solamente cuando no tiene usos y hay confirmacion', () => {
  for (const active of [true, false]) {
    const flowers = [flower('Flor eliminable', { active }), flower('Flor conservada')];
    const cancelled = deleteUnusedFlower(flowers, [], 'NAME:FLOR ELIMINABLE');
    assert.equal(cancelled.deleted, false);
    assert.equal(cancelled.reason, 'confirmation-required');
    assert.equal(cancelled.flowers.length, 2);
    const deleted = deleteUnusedFlower(flowers, [], 'NAME:FLOR ELIMINABLE', { confirmed: true });
    assert.equal(deleted.deleted, true);
    assert.deepEqual(deleted.flowers.map(item => item.articleName), ['Flor conservada']);
    assert.equal(buildMasterFlowerCatalog(deleted.flowers, { includeInactive: true }).some(entry => entry.flower.articleName === 'Flor eliminable'), false);
  }
});

test('bloquea la eliminacion con uno o varios ramos, aunque la flor este inactiva', () => {
  const one = planFlowerDeletion([flower('Flor usada')], [line('100', 'Flor usada')], 'NAME:FLOR USADA');
  assert.equal(one.canDelete, false);
  assert.equal(one.reason, 'in-use');
  assert.deepEqual(one.usage.products.map(product => product.code), ['100']);
  const several = deleteUnusedFlower(
    [flower('Flor usada', { active: false })],
    [line('100', 'Flor usada'), line('200', 'Flor usada')],
    'NAME:FLOR USADA',
    { confirmed: true }
  );
  assert.equal(several.deleted, false);
  assert.equal(several.usage.count, 2);
  assert.equal(several.flowers[0].active, false);
});

test('Red Naomi bloquea el borrado contando usos de su denominacion historica', () => {
  const flowers = [flower('ROSE RED NAOMI 4050 CM'), flower('ROSE RED NAOMI 40/50 CM')];
  const result = deleteUnusedFlower(flowers, [line('37006', 'ROSE RED NAOMI 4050 CM')], 'NAME:ROSE RED NAOMI 40 50 CM', { confirmed: true });
  assert.equal(result.deleted, false);
  assert.equal(result.usage.count, 1);
  assert.equal(result.entry.flower.articleName, 'ROSE RED NAOMI 40/50 CM');
  assert.equal(result.flowers.length, 2);
});

test('la alternativa segura inactiva toda la identidad logica sin borrar informacion', () => {
  const flowers = [flower('ROSE RED NAOMI 4050 CM'), flower('ROSE RED NAOMI 40/50 CM'), flower('Otra flor')];
  const updated = setFlowerActiveByIdentity(flowers, 'NAME:ROSE RED NAOMI 40 50 CM', false);
  assert.equal(updated.filter(item => item.articleName.includes('RED NAOMI')).every(item => item.active === false), true);
  assert.equal(updated.find(item => item.articleName === 'Otra flor').active, true);
  assert.equal(flowers.every(item => item.active === true), true);
});

test('listado y modal comparten la eliminacion segura y refrescan el catalogo local', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  assert.match(html, /data-flower-action="delete"/);
  assert.match(html, /id="btnFlowerEditorDelete"/);
  assert.match(html, /requestDeleteFlower\(/);
  assert.match(html, /deleteUnusedFlower\(flowers,nomenclatures/);
  assert.match(html, /renderNomenclatures\(\)/);
  assert.match(html, /openFlowerUsageDetail/);
});
