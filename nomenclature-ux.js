(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_MINIMUM_MARGIN_PERCENT = 70;
  const HIGH_MARGIN_PERCENT = 79;

  function text(value) {
    return String(value ?? '').trim();
  }

  function numberOr(value, fallback = 0) {
    if (value === '' || value === null || value === undefined) return fallback;
    const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeMinimumMarginPercent(value) {
    if (value === '' || value === null || value === undefined) return DEFAULT_MINIMUM_MARGIN_PERCENT;
    const parsed = numberOr(value, NaN);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : DEFAULT_MINIMUM_MARGIN_PERCENT;
  }

  function calculateVariantEconomics(input = {}) {
    const minimumMarginPercent = normalizeMinimumMarginPercent(input.minimumMarginPercent);
    const vatRate = Math.max(0, numberOr(input.vatRate, 10));
    const cost = Math.max(0, numberOr(input.cost, 0));
    const hasPvp = input.pvp !== '' && input.pvp !== null && input.pvp !== undefined && Number.isFinite(numberOr(input.pvp, NaN)) && numberOr(input.pvp, 0) > 0;
    const pvp = hasPvp ? numberOr(input.pvp, 0) : '';
    const pvpNet = hasPvp ? pvp / (1 + vatRate / 100) : '';
    const marginAmount = hasPvp ? pvpNet - cost : '';
    const marginPercent = hasPvp && pvpNet ? (marginAmount / pvpNet) * 100 : '';
    const differencePoints = marginPercent === '' ? '' : marginPercent - minimumMarginPercent;
    return {
      pvp,
      pvpNet,
      cost,
      marginAmount,
      marginPercent,
      minimumMarginPercent,
      differencePoints,
      calculable: hasPvp,
      lowMargin: marginPercent !== '' && marginPercent < minimumMarginPercent
    };
  }

  function compositionCost(lines = [], priceNumber = 1) {
    return lines.filter(line => line?.active !== false).reduce((sum, line) => {
      const stems = numberOr(line?.stems?.[priceNumber], 0);
      const unitCost = numberOr(line?.unitCost, 0);
      return sum + Math.max(0, stems) * Math.max(0, unitCost);
    }, 0);
  }

  function analyzeProductEconomics(model = {}) {
    const priceCount = Math.max(1, Math.min(5, parseInt(model.priceCount || 1, 10) || 1));
    const minimumMarginPercent = normalizeMinimumMarginPercent(model.minimumMarginPercent);
    const variants = Array.from({ length: priceCount }, (_, index) => {
      const priceNumber = index + 1;
      return {
        priceNumber,
        ...calculateVariantEconomics({
          pvp: model.prices?.[index] ?? '',
          cost: compositionCost(model.flowers || [], priceNumber),
          minimumMarginPercent,
          vatRate: model.vatRate ?? 10
        })
      };
    });
    return {
      minimumMarginPercent,
      variants,
      lowMarginVariants: variants.filter(variant => variant.lowMargin),
      hasLowMargin: variants.some(variant => variant.lowMargin),
      withoutCalculableMargin: variants.filter(variant => !variant.calculable).length
    };
  }

  function analyzeProductNomenclatureQuality(model = {}, options = {}) {
    const warnings = [];
    const errors = [];
    const priceCount = Math.max(1, Math.min(5, parseInt(model.priceCount || 1, 10) || 1));
    const lines = Array.isArray(model.flowers) ? model.flowers : [];
    const isKnownFlower = typeof options.isKnownFlower === 'function' ? options.isKnownFlower : () => true;
    if (!text(model.productCode)) errors.push('Producto sin codigo');
    if (!text(model.productName)) warnings.push('Producto sin nombre');

    for (let priceNumber = 1; priceNumber <= priceCount; priceNumber += 1) {
      const pvp = model.prices?.[priceNumber - 1];
      if (pvp === '' || pvp === null || pvp === undefined || numberOr(pvp, 0) <= 0) warnings.push(`Precio ${priceNumber} sin PVP`);
      const composed = lines.some(line => line?.active !== false && numberOr(line?.stems?.[priceNumber], 0) > 0);
      if (!composed) warnings.push(`Precio ${priceNumber} sin composicion`);
    }

    lines.forEach((line, index) => {
      const label = text(line?.articleName) || text(line?.articleCode) || `Linea ${index + 1}`;
      const stemValues = Object.values(line?.stems || {});
      const hasStems = stemValues.some(value => numberOr(value, 0) !== 0);
      if (hasStems && !text(line?.articleName) && !text(line?.articleCode)) errors.push(`Linea ${index + 1} con tallos y sin flor`);
      if ((text(line?.articleName) || text(line?.articleCode)) && !isKnownFlower(line)) errors.push(`${label}: componente sin flor maestra asociada`);
      stemValues.forEach(value => {
        if (value === '' || value === null || value === undefined) return;
        const parsed = numberOr(value, NaN);
        if (!Number.isFinite(parsed) || parsed < 0) errors.push(`${label}: tallos invalidos`);
      });
      if (hasStems && (line?.unitCost === '' || line?.unitCost === null || line?.unitCost === undefined || !Number.isFinite(numberOr(line.unitCost, NaN)))) warnings.push(`${label} sin coste`);
      if (hasStems && line?.active === false) warnings.push(`${label} esta inactiva`);
    });

    const uniqueWarnings = [...new Set(warnings)];
    const uniqueErrors = [...new Set(errors)];
    return {
      status: uniqueErrors.length ? 'error' : (uniqueWarnings.length ? 'incomplete' : 'complete'),
      warnings: uniqueWarnings,
      errors: uniqueErrors
    };
  }

  function analyzeProduct(model = {}, options = {}) {
    return {
      productCode: text(model.productCode),
      productName: text(model.productName),
      category: text(model.category),
      quality: analyzeProductNomenclatureQuality(model, options),
      economy: analyzeProductEconomics(model)
    };
  }

  function classifyVariantMargin(variant = {}) {
    if (!variant.calculable || variant.marginPercent === '') return 'no-data';
    if (variant.marginPercent < normalizeMinimumMarginPercent(variant.minimumMarginPercent)) return 'low';
    if (variant.marginPercent >= HIGH_MARGIN_PERCENT) return 'high';
    return 'normal';
  }

  function classifyProductMargin(economy = {}) {
    const variants = (economy.variants || []).map(variant => ({
      ...variant,
      marginStatus: classifyVariantMargin(variant)
    }));
    const calculable = variants.filter(variant => variant.marginStatus !== 'no-data');
    const hasLow = calculable.some(variant => variant.marginStatus === 'low');
    const hasNormal = calculable.some(variant => variant.marginStatus === 'normal');
    const status = !calculable.length ? 'no-data' : (hasLow ? 'low' : (hasNormal ? 'normal' : 'high'));
    return {
      status,
      variants,
      incompleteData: calculable.length > 0 && calculable.length < variants.length,
      lowestMarginPercent: calculable.length ? Math.min(...calculable.map(variant => variant.marginPercent)) : '',
      minimumMarginPercent: normalizeMinimumMarginPercent(economy.minimumMarginPercent)
    };
  }

  function buildMarginDashboardItems(analyses = []) {
    return analyses.map(analysis => ({
      productCode: text(analysis.productCode),
      productName: text(analysis.productName),
      category: text(analysis.category),
      quality: analysis.quality || { status: 'complete', warnings: [], errors: [] },
      economy: analysis.economy || { variants: [] },
      margin: classifyProductMargin(analysis.economy || {})
    }));
  }

  function summarizeMarginDashboard(items = []) {
    const summary = { total: items.length, high: 0, normal: 0, low: 0, noData: 0 };
    items.forEach(item => {
      if (item.margin?.status === 'high') summary.high += 1;
      else if (item.margin?.status === 'normal') summary.normal += 1;
      else if (item.margin?.status === 'low') summary.low += 1;
      else summary.noData += 1;
    });
    return summary;
  }

  function filterMarginDashboardItems(items = [], filters = {}) {
    const status = text(filters.status).toLowerCase();
    const category = text(filters.category).toLowerCase();
    const query = text(filters.query).toLowerCase();
    return items.filter(item => {
      if (status && item.margin?.status !== status) return false;
      if (category && text(item.category).toLowerCase() !== category) return false;
      if (query && ![item.productCode, item.productName, item.category].map(text).join(' ').toLowerCase().includes(query)) return false;
      return true;
    });
  }

  function sortMarginDashboardItems(items = [], order = 'margin-asc') {
    const result = items.slice();
    const lowest = item => item.margin?.lowestMarginPercent === '' ? null : item.margin.lowestMarginPercent;
    result.sort((a, b) => {
      if (order === 'name') return a.productName.localeCompare(b.productName, 'es', { numeric: true });
      if (order === 'code') return a.productCode.localeCompare(b.productCode, 'es', { numeric: true });
      const av = lowest(a);
      const bv = lowest(b);
      if (av === null && bv === null) return a.productCode.localeCompare(b.productCode, 'es', { numeric: true });
      if (av === null) return 1;
      if (bv === null) return -1;
      return (order === 'margin-desc' ? bv - av : av - bv) || a.productCode.localeCompare(b.productCode, 'es', { numeric: true });
    });
    return result;
  }

  function buildOperationalProductModels(state = {}, options = {}) {
    const groups = new Map();
    const productKey = typeof options.productKey === 'function' ? options.productKey : line => text(line?.productCode);
    const canonicalizeFlowerLine = typeof options.canonicalizeFlowerLine === 'function' ? options.canonicalizeFlowerLine : line => ({ ...line });
    const priceNumber = line => {
      const candidates = [line?.priceNumber, line?.size, line?.variantName, line?.variantCode];
      for (const value of candidates) {
        const match = String(value ?? '').match(/\d+/);
        if (match) return Math.max(1, Math.min(5, parseInt(match[0], 10) || 1));
      }
      return 1;
    };
    (state.nomenclatures || []).filter(line => !line?.deleted).forEach(line => {
      const key = productKey(line);
      if (!key) return;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(line);
    });
    return [...groups.entries()].map(([code, lines]) => {
      const catalog = state.productPriceCatalog?.[code] || {};
      const priceCount = Math.max(1, Math.min(5, parseInt(catalog.priceCount || 1, 10) || 1), ...lines.map(priceNumber));
      const flowerMap = new Map();
      lines.forEach(line => {
        const canonical = canonicalizeFlowerLine({
          articleCode: text(line.articleCode),
          articleName: text(line.articleName),
          supplier: text(line.supplier),
          unitCost: line.unitCost,
          active: line.active !== false,
          notes: text(line.notes),
          stems: { [priceNumber(line)]: line.stemsPerBouquet }
        });
        const key = text(canonical._masterFlowerKey) || `${text(canonical.articleCode)}|${text(canonical.articleName).toLocaleUpperCase('es')}`;
        if (!key.replace('|', '')) return;
        if (!flowerMap.has(key)) flowerMap.set(key, canonical);
        else flowerMap.get(key).stems[priceNumber(line)] = line.stemsPerBouquet;
      });
      const first = lines[0] || {};
      return {
        productCode: code,
        productName: text(first.productName) || code,
        category: text(first.category),
        priceCount,
        prices: Array.from({ length: priceCount }, (_, index) => {
          const stored = lines.find(line => priceNumber(line) === index + 1 && line.salePrice !== '' && line.salePrice !== undefined && line.salePrice !== null);
          return stored ? stored.salePrice : (catalog.prices?.[index] ?? '');
        }),
        manufacturingRates: Array.from({ length: priceCount }, (_, index) => {
          const value = catalog.manufacturingRates?.[index];
          if (value === '' || value === null || value === undefined) return null;
          const number = Number(String(value).replace(',', '.'));
          return Number.isFinite(number) && number > 0 ? number : null;
        }),
        active: lines.some(line => line.active !== false),
        notes: text(first.productNotes),
        photoDataUrl: text(catalog.photoDataUrl),
        minimumMarginPercent: normalizeMinimumMarginPercent(catalog.minimumMarginPercent),
        flowers: [...flowerMap.values()]
      };
    });
  }

  function filterProductsByQuality(products = [], analyses = new Map(), filter = '') {
    if (!filter) return products.slice();
    return products.filter(product => analyses.get(product.key || product.productCode)?.quality?.status === filter);
  }

  function groupMarginAlerts(analyses = []) {
    return analyses.filter(analysis => analysis?.economy?.hasLowMargin).map(analysis => ({
      productCode: analysis.productCode,
      productName: analysis.productName,
      minimumMarginPercent: analysis.economy.minimumMarginPercent,
      variants: analysis.economy.lowMarginVariants.map(variant => ({
        priceNumber: variant.priceNumber,
        marginPercent: variant.marginPercent,
        minimumMarginPercent: variant.minimumMarginPercent,
        differencePoints: variant.differencePoints
      }))
    }));
  }

  function summarizeProductAnalyses(analyses = []) {
    return analyses.reduce((summary, analysis) => {
      summary.products += 1;
      if (analysis.quality.status === 'complete') summary.complete += 1;
      else if (analysis.quality.status === 'error') summary.errors += 1;
      else summary.incomplete += 1;
      if (analysis.economy.hasLowMargin) summary.lowMargin += 1;
      if (analysis.economy.variants.every(variant => !variant.calculable)) summary.withoutCalculableMargin += 1;
      return summary;
    }, { products: 0, complete: 0, incomplete: 0, errors: 0, lowMargin: 0, withoutCalculableMargin: 0 });
  }

  function canonicalSnapshotValue(value) {
    if (Array.isArray(value)) return value.map(canonicalSnapshotValue);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      if (key.startsWith('_')) return result;
      result[key] = canonicalSnapshotValue(value[key]);
      return result;
    }, {});
  }

  function createEditorSnapshot(state = {}) {
    return JSON.stringify(canonicalSnapshotValue(clone(state)));
  }

  function isEditorDirty(initialSnapshot, currentState = {}) {
    if (!initialSnapshot) return false;
    return initialSnapshot !== createEditorSnapshot(currentState);
  }

  function duplicateProductModel(model = {}, options = {}) {
    const copyComposition = options.copyComposition !== false;
    const copyPrices = options.copyPrices !== false;
    const copyNotes = options.copyNotes !== false;
    return {
      productCode: text(options.productCode),
      productName: text(options.productName),
      category: text(options.category),
      priceCount: Math.max(1, parseInt(model.priceCount || 1, 10) || 1),
      prices: copyPrices ? clone(model.prices || []) : Array.from({ length: Math.max(1, parseInt(model.priceCount || 1, 10) || 1) }, () => ''),
      manufacturingRates: clone(model.manufacturingRates || Array.from({ length: Math.max(1, parseInt(model.priceCount || 1, 10) || 1) }, () => null)),
      active: true,
      deleted: false,
      notes: copyNotes ? text(model.notes) : '',
      photoDataUrl: '',
      minimumMarginPercent: normalizeMinimumMarginPercent(model.minimumMarginPercent),
      flowers: copyComposition ? clone(model.flowers || []) : []
    };
  }

  function copyCompositionBetweenPrices(lines = [], sourcePrice, targetPrices = [], options = {}) {
    const source = Math.max(1, parseInt(sourcePrice, 10) || 1);
    const targets = [...new Set(targetPrices.map(value => Math.max(1, parseInt(value, 10) || 1)).filter(value => value !== source))];
    const conflicts = targets.filter(target => lines.some(line => numberOr(line?.stems?.[target], 0) !== 0));
    if (conflicts.length && options.replace !== true) return { applied: false, requiresConfirmation: true, conflicts, lines: clone(lines) };
    const copied = clone(lines);
    copied.forEach(line => {
      line.stems = line.stems || {};
      targets.forEach(target => { line.stems[target] = numberOr(line.stems[source], 0); });
    });
    return { applied: true, requiresConfirmation: false, conflicts, lines: copied };
  }

  function moveCompositionLine(lines = [], index = 0, direction = 0) {
    const moved = clone(lines);
    const from = parseInt(index, 10);
    const to = from + (direction < 0 ? -1 : 1);
    if (!Number.isInteger(from) || from < 0 || from >= moved.length || to < 0 || to >= moved.length) return moved;
    [moved[from], moved[to]] = [moved[to], moved[from]];
    return moved;
  }

  function lineMatchesFlower(line = {}, flowerKey = '') {
    if (line._masterFlowerKey) return line._masterFlowerKey === flowerKey;
    const normalizedName = text(line.articleName).normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase();
    return flowerKey === `NAME:${normalizedName}`;
  }

  function replaceFlowerInModel(model = {}, originKey = '', destination = {}) {
    const result = clone(model);
    const lines = result.flowers || [];
    const originIndexes = lines.map((line, index) => lineMatchesFlower(line, originKey) ? index : -1).filter(index => index >= 0);
    if (!originIndexes.length) return result;
    const destinationKey = destination.key || '';
    let destinationIndex = lines.findIndex(line => lineMatchesFlower(line, destinationKey));
    if (destinationIndex < 0) {
      destinationIndex = originIndexes[0];
      const original = lines[destinationIndex];
      lines[destinationIndex] = {
        ...original,
        articleCode: destination.articleCode || '',
        articleName: destination.articleName || '',
        supplier: destination.supplier || '',
        unitCost: destination.unitCost === undefined ? '' : destination.unitCost,
        _masterFlowerKey: destinationKey,
        _masterFlowerActive: true
      };
    }
    originIndexes.forEach(index => {
      if (index === destinationIndex) return;
      const origin = lines[index];
      const target = lines[destinationIndex];
      target.stems = target.stems || {};
      Object.keys(origin.stems || {}).forEach(price => {
        target.stems[price] = numberOr(target.stems[price], 0) + numberOr(origin.stems[price], 0);
      });
    });
    result.flowers = lines.filter((line, index) => !originIndexes.includes(index) || index === destinationIndex);
    return result;
  }

  function previewFlowerSubstitution(models = [], originKey = '', destination = {}, selectedCodes = []) {
    const selected = new Set(selectedCodes.map(text));
    const products = models.filter(model => selected.has(text(model.productCode))).map(model => {
      const before = analyzeProductEconomics(model);
      const resultModel = replaceFlowerInModel(model, originKey, destination);
      const after = analyzeProductEconomics(resultModel);
      return {
        productCode: text(model.productCode),
        productName: text(model.productName),
        before,
        after,
        resultModel,
        newlyLow: after.variants.filter((variant, index) => variant.lowMargin && !before.variants[index]?.lowMargin).map(variant => variant.priceNumber)
      };
    });
    return { originKey, destinationKey: destination.key || '', products, hasNewLowMargin: products.some(product => product.newlyLow.length) };
  }

  function applyFlowerSubstitution(preview = {}, options = {}) {
    if (options.confirmed !== true) return { applied: false, models: [] };
    return { applied: true, models: (preview.products || []).map(product => clone(product.resultModel)) };
  }

  function previewFlowerCostImpact(models = [], flowerKey = '', newUnitCost = '') {
    const nextCost = newUnitCost === '' || newUnitCost === null || newUnitCost === undefined ? '' : numberOr(newUnitCost, 0);
    const products = models.filter(model => (model.flowers || []).some(line => lineMatchesFlower(line, flowerKey))).map(model => {
      const before = analyzeProductEconomics(model);
      const resultModel = clone(model);
      resultModel.flowers.forEach(line => { if (lineMatchesFlower(line, flowerKey)) line.unitCost = nextCost; });
      const after = analyzeProductEconomics(resultModel);
      return {
        productCode: text(model.productCode),
        productName: text(model.productName),
        before,
        after,
        resultModel,
        newlyLow: after.variants.filter((variant, index) => variant.lowMargin && !before.variants[index]?.lowMargin).map(variant => variant.priceNumber)
      };
    });
    return { flowerKey, newUnitCost: nextCost, products, affectedProducts: products.length, newlyLowProducts: products.filter(product => product.newlyLow.length).length };
  }

  return {
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
    compositionCost,
    copyCompositionBetweenPrices,
    createEditorSnapshot,
    duplicateProductModel,
    buildMarginDashboardItems,
    filterMarginDashboardItems,
    filterProductsByQuality,
    groupMarginAlerts,
    isEditorDirty,
    moveCompositionLine,
    normalizeMinimumMarginPercent,
    previewFlowerCostImpact,
    previewFlowerSubstitution,
    replaceFlowerInModel,
    sortMarginDashboardItems,
    summarizeMarginDashboard,
    summarizeProductAnalyses
  };
});
