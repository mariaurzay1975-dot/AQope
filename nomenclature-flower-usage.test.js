'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildFlowerUsageEntries,
  flowerUsageCountLabel,
  navigateToFlowerUsageProduct
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
