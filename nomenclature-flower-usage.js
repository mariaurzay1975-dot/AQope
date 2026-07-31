(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const RED_NAOMI_CANONICAL_NAME = 'ROSE RED NAOMI 40/50 CM';
  const CONFIRMED_FLOWER_ALIASES = new Map([
    ['ROSE RED NAOMI 4050 CM', RED_NAOMI_CANONICAL_NAME],
    ['ROSE RED NAOMI 40 50 CM', RED_NAOMI_CANONICAL_NAME]
  ]);

  function cleanText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function normalizeIdentity(value) {
    return cleanText(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleUpperCase('es-ES');
  }

  function confirmedFlowerCanonicalName(value) {
    return CONFIRMED_FLOWER_ALIASES.get(normalizeIdentity(value)) || '';
  }

  function canonicalFlowerName(value) {
    return confirmedFlowerCanonicalName(value) || cleanText(value);
  }

  function logicalFlowerKey(flower) {
    const confirmedName = confirmedFlowerCanonicalName(flower?.articleName);
    if (confirmedName) return `NAME:${normalizeIdentity(confirmedName)}`;
    const articleCode = normalizeIdentity(flower?.articleCode);
    if (articleCode) return `CODE:${articleCode}`;
    return `NAME:${normalizeIdentity(flower?.articleName)}`;
  }

  function mergeProviders(left = [], right = []) {
    const providers = new Map();
    [...left, ...right].forEach(provider => {
      const key = `${normalizeIdentity(provider?.supplier)}|${normalizeIdentity(provider?.supplierCode)}`;
      if (!key.replace('|', '')) return;
      const current = providers.get(key);
      if (!current) {
        providers.set(key, { ...provider });
        return;
      }
      const currentTime = new Date(current.updatedAt || 0).getTime();
      const nextTime = new Date(provider?.updatedAt || 0).getTime();
      const newest = nextTime >= currentTime ? provider : current;
      const oldest = newest === provider ? current : provider;
      const merged = { ...newest };
      ['supplier', 'supplierCode', 'price', 'unit', 'multiple', 'source', 'notes', 'updatedAt'].forEach(field => {
        if ((merged[field] === '' || merged[field] === null || merged[field] === undefined) && oldest?.[field] !== '') merged[field] = oldest?.[field];
      });
      providers.set(key, merged);
    });
    return [...providers.values()];
  }

  function mergeFlowerRecords(existing, incoming) {
    if (!existing) {
      return {
        ...incoming,
        articleName: canonicalFlowerName(incoming?.articleName),
        providers: mergeProviders([], incoming?.providers || [])
      };
    }
    const confirmedName = confirmedFlowerCanonicalName(existing.articleName) || confirmedFlowerCanonicalName(incoming?.articleName);
    const incomingIsCanonical = confirmedName && normalizeIdentity(incoming?.articleName) === normalizeIdentity(confirmedName);
    const merged = { ...existing };
    if (incomingIsCanonical && incoming?.id) merged.id = incoming.id;
    if (confirmedName) merged.articleName = confirmedName;
    ['articleCode', 'family', 'color', 'format', 'primarySupplier', 'unit', 'notes', 'photoDataUrl'].forEach(field => {
      if (!cleanText(merged[field]) && cleanText(incoming?.[field])) merged[field] = incoming[field];
    });
    merged.active = existing.active !== false || incoming?.active !== false;
    const existingTime = new Date(existing.updatedAt || 0).getTime();
    const incomingTime = new Date(incoming?.updatedAt || 0).getTime();
    if (incomingTime >= existingTime && incoming?.updatedAt) merged.updatedAt = incoming.updatedAt;
    merged.providers = mergeProviders(existing.providers || [], incoming?.providers || []);
    return merged;
  }

  function productStatus(lines) {
    if (lines.length && lines.every(line => !!line.deleted)) return 'deleted';
    return lines.some(line => line.active !== false && !line.deleted) ? 'active' : 'inactive';
  }

  function productSummariesFromNomenclatures(nomenclatures = []) {
    const products = new Map();
    nomenclatures.forEach(line => {
      const code = cleanText(line?.productCode);
      if (!code) return;
      if (!products.has(code)) products.set(code, { code, name: cleanText(line?.productName) || code, category: cleanText(line?.category), lines: [] });
      const product = products.get(code);
      product.lines.push(line);
      if (cleanText(line?.productName)) product.name = cleanText(line.productName);
      if (cleanText(line?.category)) product.category = cleanText(line.category);
    });
    products.forEach(product => { product.status = productStatus(product.lines); });
    return products;
  }

  function buildFlowerUsageEntries(flowers = [], nomenclatures = []) {
    const groups = new Map();
    flowers.forEach(flower => {
      const key = logicalFlowerKey(flower);
      if (!key || key === 'NAME:') return;
      if (!groups.has(key)) groups.set(key, { key, flower: null, names: new Set(), codes: new Set() });
      const group = groups.get(key);
      group.flower = mergeFlowerRecords(group.flower, flower);
      const canonicalName = normalizeIdentity(canonicalFlowerName(flower?.articleName));
      if (canonicalName) group.names.add(canonicalName);
      const code = normalizeIdentity(flower?.articleCode);
      if (code) group.codes.add(code);
    });

    const productSummaries = productSummariesFromNomenclatures(nomenclatures);
    return [...groups.values()].map(group => {
      const products = new Map();
      nomenclatures.forEach(line => {
        const lineName = normalizeIdentity(canonicalFlowerName(line?.articleName));
        const lineCode = normalizeIdentity(line?.articleCode);
        const matches = (lineCode && group.codes.has(lineCode)) || (lineName && group.names.has(lineName));
        if (!matches) return;
        const productCode = cleanText(line?.productCode);
        if (!productCode || products.has(productCode)) return;
        const summary = productSummaries.get(productCode);
        if (summary) products.set(productCode, { code: summary.code, name: summary.name, category: summary.category, status: summary.status });
      });
      return {
        key: group.key,
        flower: group.flower,
        products: [...products.values()].sort((a, b) => a.code.localeCompare(b.code, 'es', { numeric: true }))
      };
    });
  }

  function flowerUsageCountLabel(count) {
    if (!count) return 'No utilizada';
    return count === 1 ? '1 ramo' : `${count} ramos`;
  }

  async function navigateToFlowerUsageProduct(productCode, actions = {}) {
    const code = cleanText(productCode);
    if (!code) return false;
    actions.closeUsage?.();
    actions.selectProducts?.(code);
    actions.renderProducts?.();
    const product = actions.findProduct?.(code);
    if (!product) return false;
    await actions.openEditor?.(product);
    return true;
  }

  return {
    RED_NAOMI_CANONICAL_NAME,
    buildFlowerUsageEntries,
    canonicalFlowerName,
    flowerUsageCountLabel,
    navigateToFlowerUsageProduct
  };
});
