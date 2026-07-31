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

  function flowerUsagePresentation(entry) {
    const products = Array.isArray(entry?.products) ? entry.products : [];
    return { products, count: products.length, label: flowerUsageCountLabel(products.length) };
  }

  function findFlowerUsageEntry(flowers = [], nomenclatures = [], identity = {}) {
    const entries = buildFlowerUsageEntries(flowers, nomenclatures);
    if (typeof identity === 'string') return entries.find(entry => entry.key === identity) || null;
    return findMasterFlowerEntry(entries, identity);
  }

  function planFlowerDeletion(flowers = [], nomenclatures = [], identity = {}) {
    const entry = findFlowerUsageEntry(flowers, nomenclatures, identity);
    if (!entry) return { canDelete: false, reason: 'not-found', entry: null, usage: { products: [], count: 0, label: 'No utilizada' } };
    const usage = flowerUsagePresentation(entry);
    return {
      canDelete: usage.count === 0,
      reason: usage.count ? 'in-use' : 'unused',
      entry,
      flower: entry.flower,
      usage
    };
  }

  function deleteUnusedFlower(flowers = [], nomenclatures = [], identity = {}, options = {}) {
    const plan = planFlowerDeletion(flowers, nomenclatures, identity);
    if (!plan.entry) return { ...plan, deleted: false, flowers: flowers.slice() };
    if (!plan.canDelete) return { ...plan, deleted: false, flowers: flowers.slice() };
    if (options.confirmed !== true) return { ...plan, deleted: false, reason: 'confirmation-required', flowers: flowers.slice() };
    return {
      ...plan,
      deleted: true,
      reason: 'deleted',
      flowers: flowers.filter(flower => logicalFlowerKey(flower) !== plan.entry.key)
    };
  }

  function setFlowerActiveByIdentity(flowers = [], identity = {}, active = false) {
    const entry = findFlowerUsageEntry(flowers, [], identity);
    if (!entry) return flowers.slice();
    return flowers.map(flower => logicalFlowerKey(flower) === entry.key ? { ...flower, active: !!active } : flower);
  }

  function buildMasterFlowerCatalog(flowers = [], options = {}) {
    const includeInactive = options.includeInactive === true;
    return buildFlowerUsageEntries(flowers, [])
      .filter(entry => includeInactive || entry.flower.active !== false)
      .sort((left, right) => cleanText(left.flower.articleName).localeCompare(cleanText(right.flower.articleName), 'es'));
  }

  function findMasterFlowerEntry(catalog = [], value = {}) {
    const articleName = typeof value === 'string' ? value : value?.articleName;
    const articleCode = typeof value === 'string' ? value : value?.articleCode;
    const normalizedName = normalizeIdentity(canonicalFlowerName(articleName));
    const normalizedCode = normalizeIdentity(articleCode);
    return catalog.find(entry => {
      const flowerName = normalizeIdentity(canonicalFlowerName(entry.flower?.articleName));
      const flowerCode = normalizeIdentity(entry.flower?.articleCode);
      return (normalizedCode && flowerCode === normalizedCode) || (normalizedName && flowerName === normalizedName);
    }) || null;
  }

  function searchMasterFlowerCatalog(catalog = [], query = '') {
    const normalizedQuery = normalizeIdentity(query);
    if (!normalizedQuery) return catalog.slice();
    return catalog.filter(entry => normalizeIdentity(entry.flower?.articleName).includes(normalizedQuery));
  }

  function canonicalizeExistingFlowerLine(line = {}, flowers = []) {
    const catalog = buildMasterFlowerCatalog(flowers, { includeInactive: true });
    const entry = findMasterFlowerEntry(catalog, line);
    if (!entry) return { ...line, _masterFlowerKey: '' };
    return {
      ...line,
      articleCode: entry.flower.articleCode || line.articleCode || '',
      articleName: entry.flower.articleName,
      _masterFlowerKey: entry.key,
      _masterFlowerActive: entry.flower.active !== false
    };
  }

  function primaryFlowerProvider(flower) {
    const providers = Array.isArray(flower?.providers) ? flower.providers : [];
    return providers.find(provider => cleanText(provider?.supplier) === cleanText(flower?.primarySupplier)) || providers[0] || {};
  }

  function applyMasterFlowerToLine(line = {}, entry) {
    if (!entry?.flower) return { ...line };
    const provider = primaryFlowerProvider(entry.flower);
    return {
      ...line,
      articleCode: entry.flower.articleCode || '',
      articleName: entry.flower.articleName,
      supplier: cleanText(provider.supplier) || cleanText(entry.flower.primarySupplier),
      unitCost: provider.price === undefined || provider.price === null ? '' : provider.price,
      _masterFlowerKey: entry.key,
      _masterFlowerActive: entry.flower.active !== false
    };
  }

  function resolveSelectableFlowerForLine(line = {}, flowers = []) {
    const activeCatalog = buildMasterFlowerCatalog(flowers);
    const activeEntry = findMasterFlowerEntry(activeCatalog, line);
    if (activeEntry) return activeEntry;
    if (!line._masterFlowerKey) return null;
    const existingEntry = buildMasterFlowerCatalog(flowers, { includeInactive: true })
      .find(entry => entry.key === line._masterFlowerKey);
    return existingEntry || null;
  }

  function cloneProductEditorDraft(draft = {}) {
    return JSON.parse(JSON.stringify(draft));
  }

  function restoreProductEditorDraft(draft = {}, newFlowerEntry = null) {
    const restored = cloneProductEditorDraft(draft);
    const targetLineIndex = Number.isInteger(restored.targetLineIndex) ? restored.targetLineIndex : -1;
    if (newFlowerEntry && targetLineIndex >= 0 && restored.lines?.[targetLineIndex]) {
      restored.lines[targetLineIndex] = applyMasterFlowerToLine(restored.lines[targetLineIndex], newFlowerEntry);
    }
    return restored;
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
    applyMasterFlowerToLine,
    buildMasterFlowerCatalog,
    buildFlowerUsageEntries,
    canonicalFlowerName,
    canonicalizeExistingFlowerLine,
    cloneProductEditorDraft,
    deleteUnusedFlower,
    findMasterFlowerEntry,
    findFlowerUsageEntry,
    flowerUsageCountLabel,
    flowerUsagePresentation,
    navigateToFlowerUsageProduct,
    planFlowerDeletion,
    resolveSelectableFlowerForLine,
    restoreProductEditorDraft,
    searchMasterFlowerCatalog,
    setFlowerActiveByIdentity
  };
});
