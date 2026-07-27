(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) Object.assign(root, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const NOMENCLATURE_CATEGORIES = ['ROSAS', 'COMPUESTOS', 'SIMPLES', 'PLANTAS'];
  const MONEY_SCALE = 4;

  function cleanText(value) {
    return String(value ?? '').trim().replace(/\s+/g, ' ');
  }

  function businessKey(value) {
    return cleanText(value).toLocaleUpperCase('es-ES');
  }

  function supplierKey(value) {
    return cleanText(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[.,;:_/\\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleUpperCase('es-ES');
  }

  function normalizeFlowerIdentityText(value) {
    return cleanText(value)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^A-Za-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLocaleUpperCase('es-ES');
  }

  function flowerContentSignature(flower) {
    return [
      normalizeFlowerIdentityText(flower?.articleName),
      normalizeFlowerIdentityText(flower?.family),
      normalizeFlowerIdentityText(flower?.color),
      normalizeFlowerIdentityText(flower?.format)
    ].join('|');
  }

  function flowerMigrationMatchKey(flower) {
    const articleCode = cleanText(flower?.articleCode);
    if (articleCode) return `CODE:${businessKey(articleCode)}`;
    const signature = flowerContentSignature(flower);
    return signature.split('|')[0] ? `NAME:${signature}` : '';
  }

  function wordTokens(value, includeNumbers = true) {
    return normalizeFlowerIdentityText(value)
      .split(' ')
      .filter(token => token && (includeNumbers || !/^\d+(?:CM|MM)?$/.test(token)));
  }

  function tokenSimilarity(a, b, includeNumbers = true) {
    const left = new Set(wordTokens(a, includeNumbers));
    const right = new Set(wordTokens(b, includeNumbers));
    if (!left.size || !right.size) return 0;
    const intersection = [...left].filter(token => right.has(token)).length;
    return intersection / new Set([...left, ...right]).size;
  }

  function numericIdentityTokens(value) {
    return wordTokens(value).filter(token => /\d/.test(token)).sort();
  }

  function equivalentNumericTokens(left, right) {
    if (left.join('|') === right.join('|')) return true;
    const leftCompact = left.join('').replace(/\D/g, '');
    const rightCompact = right.join('').replace(/\D/g, '');
    return !!leftCompact && leftCompact === rightCompact;
  }

  function classifyFlowerDuplicates(flowerRows) {
    const safe = [];
    const possible = [];
    const distinct = [];
    const incompatible = [];
    const rows = (flowerRows || []).filter(row => cleanText(row?.articleName));
    for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < rows.length; rightIndex += 1) {
        const left = rows[leftIndex];
        const right = rows[rightIndex];
        const leftCode = businessKey(left.articleCode);
        const rightCode = businessKey(right.articleCode);
        const sameCode = leftCode && rightCode && leftCode === rightCode;
        const sameContent = flowerContentSignature(left) === flowerContentSignature(right);
        const context = {
          left: { articleCode: cleanText(left.articleCode) || null, articleName: cleanText(left.articleName), format: cleanText(left.format) || null },
          right: { articleCode: cleanText(right.articleCode) || null, articleName: cleanText(right.articleName), format: cleanText(right.format) || null }
        };
        if (sameCode && !sameContent) {
          incompatible.push({ ...context, reason: 'same_code_conflicting_description' });
          continue;
        }
        if (sameContent) {
          safe.push({ ...context, reason: sameCode ? 'same_code_and_identity' : 'same_normalized_identity' });
          continue;
        }
        const nameSimilarity = tokenSimilarity(left.articleName, right.articleName, false);
        if (nameSimilarity < 0.6) continue;
        const leftNumbers = numericIdentityTokens(`${left.articleName} ${left.format || ''}`);
        const rightNumbers = numericIdentityTokens(`${right.articleName} ${right.format || ''}`);
        const numbersConflict = leftNumbers.length && rightNumbers.length && !equivalentNumericTokens(leftNumbers, rightNumbers);
        const leftFormat = normalizeFlowerIdentityText(left.format);
        const rightFormat = normalizeFlowerIdentityText(right.format);
        const formatsConflict = leftFormat && rightFormat && leftFormat !== rightFormat;
        if (numbersConflict || formatsConflict) {
          distinct.push({ ...context, reason: numbersConflict ? 'different_length_or_number' : 'different_format', similarity: nameSimilarity });
        } else {
          possible.push({ ...context, reason: 'similar_name_incomplete_metadata', similarity: nameSimilarity });
        }
      }
    }
    return { safe, possible, distinct, incompatible };
  }

  function decimalToScaled(value, scale = MONEY_SCALE) {
    if (value === '' || value === null || value === undefined) return null;
    let raw = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) return null;
    const negative = raw.startsWith('-');
    if (/^[+-]/.test(raw)) raw = raw.slice(1);
    const [whole, fraction = ''] = raw.split('.');
    const kept = fraction.slice(0, scale).padEnd(scale, '0');
    let units = BigInt(whole || '0') * (10n ** BigInt(scale)) + BigInt(kept || '0');
    if (fraction.length > scale && Number(fraction[scale]) >= 5) units += 1n;
    return negative ? -units : units;
  }

  function roundDivide(numerator, denominator) {
    if (denominator === 0n) throw new Error('No se puede dividir entre cero.');
    const negative = (numerator < 0n) !== (denominator < 0n);
    const n = numerator < 0n ? -numerator : numerator;
    const d = denominator < 0n ? -denominator : denominator;
    const result = (n + d / 2n) / d;
    return negative ? -result : result;
  }

  function scaledToDecimal(units, scale = MONEY_SCALE) {
    if (units === null || units === undefined) return null;
    const negative = units < 0n;
    const absolute = negative ? -units : units;
    const factor = 10n ** BigInt(scale);
    const whole = absolute / factor;
    const fraction = String(absolute % factor).padStart(scale, '0');
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  function decimalString(value, scale = MONEY_SCALE) {
    const units = decimalToScaled(value, scale);
    return units === null ? null : scaledToDecimal(units, scale);
  }

  function toBoolean(value, defaultValue = true) {
    if (value === undefined || value === null || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    return !['0', 'false', 'no', 'inactive', 'inactivo'].includes(cleanText(value).toLowerCase());
  }

  function numberOrNull(value) {
    if (value === '' || value === null || value === undefined) return null;
    const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.');
    if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function priceNumber(line) {
    const candidates = [line?.priceNumber, line?.size, line?.variantName, line?.variantCode];
    for (const value of candidates) {
      const match = cleanText(value).match(/\d+/);
      if (!match) continue;
      const parsed = Number(match[0]);
      if (Number.isInteger(parsed) && parsed > 0) return Math.min(5, parsed);
    }
    return 1;
  }

  function inferredCategory(code, name = '') {
    const ref = [code, name].map(cleanText).find(value => /^[ACSP]-/i.test(value)) || cleanText(code || name);
    if (/^A-/i.test(ref)) return 'ROSAS';
    if (/^C-/i.test(ref)) return 'COMPUESTOS';
    if (/^S-/i.test(ref)) return 'SIMPLES';
    if (/^P-/i.test(ref)) return 'PLANTAS';
    return '';
  }

  function calculateTheoreticalEconomics({ salePrice, vatRate = 10, components = [] }) {
    const factor = 10n ** BigInt(MONEY_SCALE);
    let theoreticalCost = 0n;
    const missingCosts = [];
    for (const component of components) {
      const stems = decimalToScaled(component.stems ?? 0);
      const unitCost = decimalToScaled(component.unitCost);
      if (stems === null) throw new Error(`Número de tallos inválido: ${component.stems}`);
      if (unitCost === null) {
        if (stems !== 0n) missingCosts.push(component.articleCode || component.flowerKey || 'flor sin código');
        continue;
      }
      theoreticalCost += roundDivide(stems * unitCost, factor);
    }
    const sale = decimalToScaled(salePrice);
    const vat = decimalToScaled(vatRate);
    if (sale === null) {
      return {
        salePrice: null,
        vatRate: decimalString(vatRate),
        netSalePrice: null,
        theoreticalCost: scaledToDecimal(theoreticalCost),
        theoreticalMarginEur: null,
        theoreticalMarginPct: null,
        missingCosts
      };
    }
    if (vat === null || vat < 0n) throw new Error(`IVA inválido: ${vatRate}`);
    const netSalePrice = roundDivide(sale * (100n * factor), 100n * factor + vat);
    const margin = netSalePrice - theoreticalCost;
    const marginPct = netSalePrice === 0n ? null : roundDivide(margin * (100n * factor), netSalePrice);
    return {
      salePrice: scaledToDecimal(sale),
      vatRate: scaledToDecimal(vat),
      netSalePrice: scaledToDecimal(netSalePrice),
      theoreticalCost: scaledToDecimal(theoreticalCost),
      theoreticalMarginEur: scaledToDecimal(margin),
      theoreticalMarginPct: marginPct === null ? null : scaledToDecimal(marginPct),
      missingCosts
    };
  }

  function previousDate(dateText) {
    const date = new Date(`${dateText}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${dateText}`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  function appendCostHistory(history, entry) {
    const next = (history || []).map(item => ({ ...item }));
    const validFrom = cleanText(entry.validFrom);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error('validFrom debe tener formato YYYY-MM-DD.');
    const current = next
      .filter(item => !item.validTo)
      .sort((a, b) => cleanText(b.validFrom).localeCompare(cleanText(a.validFrom)))[0];
    if (current) {
      if (cleanText(current.validFrom) >= validFrom) throw new Error('El nuevo coste debe ser posterior al coste vigente.');
      current.validTo = previousDate(validFrom);
    }
    next.push({
      unitCost: decimalString(entry.unitCost),
      currency: cleanText(entry.currency || 'EUR'),
      validFrom,
      validTo: null,
      source: cleanText(entry.source || 'manual'),
      sourceReference: cleanText(entry.sourceReference),
      notes: cleanText(entry.notes)
    });
    return next.sort((a, b) => cleanText(a.validFrom).localeCompare(cleanText(b.validFrom)));
  }

  function appendSalePriceHistory(history, entry) {
    const next = (history || []).map(item => ({ ...item }));
    const validFrom = cleanText(entry.validFrom);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new Error('validFrom debe tener formato YYYY-MM-DD.');
    const current = next
      .filter(item => !item.validTo)
      .sort((a, b) => cleanText(b.validFrom).localeCompare(cleanText(a.validFrom)))[0];
    if (current) {
      if (cleanText(current.validFrom) >= validFrom) throw new Error('El nuevo PVP debe ser posterior al PVP vigente.');
      current.validTo = previousDate(validFrom);
    }
    next.push({
      salePrice: decimalString(entry.salePrice),
      vatRate: decimalString(entry.vatRate ?? 10),
      currency: cleanText(entry.currency || 'EUR'),
      validFrom,
      validTo: null,
      source: cleanText(entry.source || 'manual'),
      sourceReference: cleanText(entry.sourceReference),
      notes: cleanText(entry.notes)
    });
    return next.sort((a, b) => cleanText(a.validFrom).localeCompare(cleanText(b.validFrom)));
  }

  function transformSupplierInvoice(input) {
    const supplierName = cleanText(input?.supplierName);
    const invoiceNumber = cleanText(input?.invoiceNumber);
    const invoiceDate = cleanText(input?.invoiceDate);
    const errors = [];
    if (!supplierName) errors.push('La factura no tiene proveedor.');
    if (!invoiceNumber) errors.push('La factura no tiene número.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) errors.push('La fecha de factura no es válida.');
    const invoiceKey = `${supplierKey(supplierName)}|${businessKey(invoiceNumber)}`;
    const lines = (input?.lines || []).map((line, index) => {
      const quantity = decimalString(line.quantity);
      const unitCost = decimalString(line.unitCost);
      const suppliedTotal = decimalString(line.lineTotal);
      const computedTotal = quantity !== null && unitCost !== null
        ? scaledToDecimal(roundDivide(decimalToScaled(quantity) * decimalToScaled(unitCost), 10n ** BigInt(MONEY_SCALE)))
        : null;
      if (quantity === null) errors.push(`Línea ${index + 1}: cantidad inválida.`);
      if (unitCost === null) errors.push(`Línea ${index + 1}: coste unitario inválido.`);
      const flowerId = line.flowerId || null;
      const flowerSupplierId = line.flowerSupplierId || null;
      const hasConfirmedFlower = !!(flowerId || flowerSupplierId || line.flowerArticleCode);
      return {
        invoiceKey,
        lineNumber: Number(line.lineNumber || index + 1),
        supplierArticleCode: cleanText(line.supplierArticleCode),
        description: cleanText(line.description),
        normalizedDescription: normalizeFlowerIdentityText(line.description),
        quantity,
        unit: cleanText(line.unit),
        unitCost,
        lineTotal: suppliedTotal ?? computedTotal,
        flowerId,
        flowerSupplierId,
        flowerArticleCode: cleanText(line.flowerArticleCode),
        matchStatus: cleanText(line.matchStatus || (hasConfirmedFlower ? 'matched' : 'unmatched')),
        matchMethod: cleanText(line.matchMethod || (flowerId || flowerSupplierId ? 'manual' : (line.flowerArticleCode ? 'article_code' : ''))),
        matchConfidence: line.matchConfidence === undefined ? null : numberOrNull(line.matchConfidence),
        matchNotes: cleanText(line.matchNotes)
      };
    });
    return {
      errors,
      invoice: {
        supplierName,
        supplierNormalizedName: supplierKey(supplierName),
        invoiceNumber,
        invoiceDate,
        currency: cleanText(input.currency || 'EUR'),
        subtotal: decimalString(input.subtotal),
        tax: decimalString(input.tax),
        total: decimalString(input.total),
        documentName: cleanText(input.documentName),
        documentUrl: cleanText(input.documentUrl) || null,
        source: cleanText(input.source || 'manual'),
        processingStatus: cleanText(input.processingStatus || 'pending_review'),
        invoiceKey
      },
      lines
    };
  }

  function issueCollector() {
    const errors = [];
    const warnings = [];
    return {
      errors,
      warnings,
      error(code, message, context = {}) { errors.push({ code, message, context }); },
      warn(code, message, context = {}) { warnings.push({ code, message, context }); }
    };
  }

  function mapCatalog(state) {
    const result = new Map();
    Object.entries(state?.productPriceCatalog || {}).forEach(([code, value]) => {
      const key = businessKey(code);
      if (!key) return;
      const existing = result.get(key) || { priceCount: 1, prices: [], sourceCodes: [] };
      existing.sourceCodes.push(code);
      existing.priceCount = Math.max(existing.priceCount, Math.min(5, Number(value?.priceCount) || 1));
      (value?.prices || []).forEach((price, index) => {
        if (price !== '' && price !== null && price !== undefined) existing.prices[index] = price;
      });
      result.set(key, existing);
    });
    return result;
  }

  function buildNomenclatureMigrationPayload(state, options = {}) {
    const issues = issueCollector();
    const effectiveDate = cleanText(options.effectiveDate || new Date().toISOString().slice(0, 10));
    const userId = options.userId || null;
    const source = 'migration';
    const lines = Array.isArray(state?.nomenclatures) ? state.nomenclatures.map((line, index) => ({ ...line, _index: index })) : [];
    const flowerRows = Array.isArray(state?.flowers) ? state.flowers : [];
    const catalog = mapCatalog(state);
    const productsByKey = new Map();
    const quality = {
      emptyRowsIgnored: 0,
      productRowsWithoutCode: 0,
      productRowsWithDataWithoutCode: 0,
      orphanPriceCatalogs: 0,
      flowersWithArticleCode: 0,
      flowersWithoutArticleCode: 0,
      componentsLinked: 0,
      componentsLinkedWithoutArticleCode: 0,
      componentsOrphaned: 0,
      flowerSuppliersWithoutArticleCode: 0,
      variantsWithoutSalePrice: 0
    };
    const duplicateAnalysis = classifyFlowerDuplicates(flowerRows);
    duplicateAnalysis.incompatible.forEach(item => {
      issues.error('FLOWER_DUPLICATE_INCOMPATIBLE', 'El mismo código de flor tiene descripciones incompatibles.', item);
    });
    duplicateAnalysis.possible.forEach(item => {
      issues.warn('FLOWER_POSSIBLE_DUPLICATE', 'Hay dos flores parecidas que requieren revisión; no se han fusionado.', item);
    });

    for (const line of lines) {
      const code = cleanText(line.productCode);
      const key = businessKey(code);
      if (!key) {
        quality.productRowsWithoutCode += 1;
        const stemsValue = numberOrNull(line.stemsPerBouquet);
        const hasContent = [
          line.productName, line.variantCode, line.variantName, line.size,
          line.salePrice, line.articleCode, line.articleName, line.supplier,
          line.unitCost, line.notes, line.productNotes
        ].some(value => cleanText(value)) || (stemsValue !== null && stemsValue !== 0);
        if (hasContent) {
          quality.productRowsWithDataWithoutCode += 1;
          issues.error('PRODUCT_CODE_MISSING', 'Hay una línea con datos pero sin código de producto.', { line: line._index + 1 });
        } else {
          quality.emptyRowsIgnored += 1;
        }
        continue;
      }
      if (!productsByKey.has(key)) productsByKey.set(key, { key, code, lines: [], spellings: new Set() });
      const product = productsByKey.get(key);
      product.lines.push(line);
      product.spellings.add(code);
    }

    for (const [key, info] of catalog) {
      if (!productsByKey.has(key)) {
        quality.orphanPriceCatalogs += 1;
        issues.warn('ORPHAN_PRICE_CATALOG', 'El catálogo de precios contiene un producto sin líneas de nomenclatura.', { codes: info.sourceCodes });
      }
      if (info.sourceCodes.length > 1) {
        issues.warn('DUPLICATE_PRODUCT_CODE_CASE', 'Hay claves de catálogo equivalentes que solo difieren en mayúsculas o espacios.', { codes: info.sourceCodes });
      }
    }

    const products = [];
    const variants = [];
    const flowers = [];
    const suppliers = [];
    const flowerSuppliers = [];
    const recipeVersions = [];
    const components = [];
    const flowerCostHistory = [];
    const salePriceHistory = [];
    const costSnapshots = [];
    const flowersByKey = new Map();
    const flowerKeyByCode = new Map();
    const flowerKeysByName = new Map();
    const flowerKeyByContent = new Map();
    const suppliersByKey = new Map();
    const flowerSuppliersByKey = new Map();

    function addSupplier(provider, context = {}) {
      const name = cleanText(provider?.supplier);
      if (!name) {
        issues.warn('SUPPLIER_EMPTY', 'Se ha encontrado una relación de proveedor sin nombre.', context);
        return null;
      }
      const key = supplierKey(name);
      if (!suppliersByKey.has(key)) {
        suppliersByKey.set(key, {
          _key: key,
          supplier_code: cleanText(provider?.supplierCode) || null,
          normalized_name: key,
          supplier_name: name,
          active: toBoolean(provider?.active, true),
          notes: cleanText(provider?.notes),
          created_by: userId,
          updated_by: userId
        });
      } else {
        const existing = suppliersByKey.get(key);
        if (!existing.supplier_code && provider?.supplierCode) existing.supplier_code = cleanText(provider.supplierCode);
      }
      return key;
    }

    function addFlower(raw, derived = false) {
      const articleCode = cleanText(raw?.articleCode);
      const articleName = cleanText(raw?.articleName);
      if (!articleName) {
        issues.error('FLOWER_NAME_MISSING', 'Hay una flor sin nombre; no se puede crear una correspondencia segura.', { articleCode: articleCode || null });
        return null;
      }
      const normalizedCode = businessKey(articleCode);
      const normalizedName = normalizeFlowerIdentityText(articleName);
      const contentSignature = flowerContentSignature(raw);
      const codeMatch = normalizedCode ? flowerKeyByCode.get(normalizedCode) : null;
      const contentMatch = flowerKeyByContent.get(contentSignature);
      let key = codeMatch || contentMatch || flowerMigrationMatchKey(raw);
      if (codeMatch && contentMatch && codeMatch !== contentMatch) {
        issues.error('FLOWER_RELATION_CONTRADICTORY', 'El código y la descripción normalizada apuntan a flores diferentes.', {
          articleCode,
          articleName
        });
        return null;
      }
      if (contentMatch) {
        const existingCode = businessKey(flowersByKey.get(contentMatch)?.article_code);
        if (normalizedCode && existingCode && normalizedCode !== existingCode) {
          issues.error('FLOWER_DUPLICATE_INCOMPATIBLE', 'Dos códigos diferentes comparten exactamente la misma identidad de flor.', {
            codes: [flowersByKey.get(contentMatch)?.article_code, articleCode],
            articleName
          });
          key = flowerMigrationMatchKey(raw);
        }
      }
      if (!flowersByKey.has(key)) {
        flowersByKey.set(key, {
          _key: key,
          migration_match_key: key,
          article_code: articleCode || null,
          article_name: articleName,
          family: cleanText(raw?.family),
          color: cleanText(raw?.color),
          format: cleanText(raw?.format),
          active: toBoolean(raw?.active, true),
          notes: cleanText(raw?.notes),
          created_by: userId,
          updated_by: userId
        });
        if (derived) {
          issues.warn('FLOWER_DERIVED_FROM_COMPONENT', 'La flor no estaba en el catálogo y se ha preparado desde una composición.', {
            articleCode: articleCode || null,
            articleName
          });
        }
      } else {
        const existing = flowersByKey.get(key);
        if (!existing.article_code && articleCode) existing.article_code = articleCode;
        if (!existing.family && raw?.family) existing.family = cleanText(raw.family);
        if (!existing.color && raw?.color) existing.color = cleanText(raw.color);
        if (!existing.format && raw?.format) existing.format = cleanText(raw.format);
      }
      const flowerKey = key;
      if (normalizedCode) flowerKeyByCode.set(normalizedCode, flowerKey);
      flowerKeyByContent.set(contentSignature, flowerKey);
      if (!flowerKeysByName.has(normalizedName)) flowerKeysByName.set(normalizedName, new Set());
      flowerKeysByName.get(normalizedName).add(flowerKey);
      const rawProviders = Array.isArray(raw?.providers) ? raw.providers : [];
      const providers = rawProviders.filter(provider => {
        const hasPrice = provider?.price !== '' && provider?.price !== null && provider?.price !== undefined;
        const hasIdentity = cleanText(provider?.supplier) || cleanText(provider?.supplierCode);
        if (!hasIdentity && hasPrice) {
          const duplicateNamedPrice = rawProviders.some(candidate =>
            cleanText(candidate?.supplier)
            && decimalString(candidate?.price) === decimalString(provider?.price)
          );
          if (duplicateNamedPrice) return false;
        }
        return hasIdentity || hasPrice || cleanText(provider?.notes);
      });
      providers.sort((left, right) => new Date(left?.updatedAt || 0).getTime() - new Date(right?.updatedAt || 0).getTime());
      for (const originalProvider of providers) {
        const provider = {
          ...originalProvider,
          supplier: cleanText(originalProvider?.supplier) || cleanText(raw?.primarySupplier)
        };
        const supplierBusinessKey = addSupplier(provider, { articleCode: articleCode || null, articleName });
        if (!supplierBusinessKey) continue;
        const relationKey = `${flowerKey}|${supplierBusinessKey}`;
        const price = provider?.price === '' || provider?.price === undefined ? null : decimalString(provider.price);
        if (provider?.price !== '' && provider?.price !== undefined && price === null) {
          issues.error('FLOWER_COST_INVALID', 'El coste de una flor no es numérico.', { articleCode: articleCode || null, articleName, supplier: provider.supplier, value: provider.price });
        }
        const isPrimary = supplierKey(raw?.primarySupplier) === supplierBusinessKey;
        flowerSuppliersByKey.set(relationKey, {
          _key: relationKey,
          flower_key: flowerKey,
          supplier_key: supplierBusinessKey,
          supplier_article_code: cleanText(provider?.supplierArticleCode) || null,
          current_unit_cost: price,
          currency: 'EUR',
          purchase_unit: cleanText(provider?.unit || raw?.unit || 'tallo'),
          purchase_multiple: decimalString(provider?.multiple ?? 1),
          is_primary: isPrimary,
          active: toBoolean(provider?.active, true),
          source: cleanText(provider?.source || source),
          notes: cleanText(provider?.notes),
          cost_updated_at: provider?.updatedAt || raw?.updatedAt || null,
          created_by: userId,
          updated_by: userId
        });
      }
      if (![...flowerSuppliersByKey.values()].some(item => item.flower_key === flowerKey)) {
        issues.warn('FLOWER_NO_SUPPLIER', 'La flor no tiene ningún proveedor configurado.', {
          articleCode: articleCode || null,
          articleName
        });
      }
      return flowerKey;
    }

    flowerRows.forEach(raw => addFlower(raw, false));

    function resolveFlowerForComponent(line) {
      const articleCode = cleanText(line.articleCode);
      const articleName = cleanText(line.articleName);
      const normalizedCode = businessKey(articleCode);
      if (normalizedCode && flowerKeyByCode.has(normalizedCode)) return flowerKeyByCode.get(normalizedCode);
      const normalizedName = normalizeFlowerIdentityText(articleName);
      const candidates = normalizedName ? [...(flowerKeysByName.get(normalizedName) || [])] : [];
      if (candidates.length === 1) {
        if (articleCode && !flowersByKey.get(candidates[0]).article_code) {
          flowersByKey.get(candidates[0]).article_code = articleCode;
          flowerKeyByCode.set(normalizedCode, candidates[0]);
        }
        return candidates[0];
      }
      if (candidates.length > 1) {
        const exactContent = flowerKeyByContent.get(flowerContentSignature(line));
        if (exactContent && candidates.includes(exactContent)) return exactContent;
        issues.error('COMPONENT_FLOWER_AMBIGUOUS', 'El componente coincide con varias flores y no hay metadatos suficientes para elegir una.', {
          articleCode: articleCode || null,
          articleName,
          candidates
        });
        line._flowerResolutionError = true;
        return null;
      }
      if (!articleName) {
        issues.error('COMPONENT_FLOWER_UNRESOLVED', 'El componente no tiene código ni nombre de flor.', {
          productCode: cleanText(line.productCode) || null
        });
        line._flowerResolutionError = true;
        return null;
      }
      return addFlower({
        articleCode: articleCode || null,
        articleName,
        family: line.family,
        color: line.color,
        format: line.format,
        active: line.active,
        providers: line.supplier ? [{
          supplier: line.supplier,
          price: line.unitCost,
          unit: 'tallo',
          active: true,
          source
        }] : []
      }, true);
    }

    for (const line of lines) {
      if (!cleanText(line.articleCode) && !cleanText(line.articleName)) continue;
      line._resolvedFlowerKey = resolveFlowerForComponent(line);
    }

    for (const product of productsByKey.values()) {
      const first = product.lines[0] || {};
      const category = cleanText(first.category) || inferredCategory(product.code, first.productName);
      if (!NOMENCLATURE_CATEGORIES.includes(category)) {
        issues.error('PRODUCT_CATEGORY_INVALID', 'La categoría de producto no es válida.', { productCode: product.code, category });
      }
      if (product.spellings.size > 1) {
        issues.warn('DUPLICATE_PRODUCT_CODE_CASE', 'Dos códigos de producto solo difieren en mayúsculas o espacios.', { codes: [...product.spellings] });
      }
      const deletedValues = new Set(product.lines.map(line => !!line.deleted));
      if (deletedValues.size > 1) issues.warn('MIXED_PRODUCT_DELETED_STATE', 'El producto mezcla líneas en papelera y líneas vigentes.', { productCode: product.code });
      const deleted = product.lines.some(line => !!line.deleted);
      const active = !deleted && product.lines.some(line => toBoolean(line.active, true));
      products.push({
        _key: product.key,
        product_code: product.code,
        product_name: cleanText(first.productName) || product.code,
        category,
        active,
        deleted,
        notes: cleanText(first.productNotes),
        created_at: first.createdAt || first.updatedAt || undefined,
        updated_at: first.updatedAt || undefined,
        created_by: userId,
        updated_by: userId
      });

      const catalogInfo = catalog.get(product.key) || { priceCount: 1, prices: [] };
      const linePriceCount = Math.max(1, ...product.lines.map(priceNumber));
      const priceCount = Math.max(1, Math.min(5, Math.max(Number(catalogInfo.priceCount) || 1, linePriceCount)));
      if (priceCount < 1 || priceCount > 5) {
        issues.error('VARIANT_COUNT_INVALID', 'El número de variantes debe estar entre 1 y 5.', { productCode: product.code, priceCount });
      }
      for (let index = 1; index <= priceCount; index++) {
        const variantLines = product.lines.filter(line => priceNumber(line) === index);
        const representative = variantLines[0] || first;
        const rawSalePrice = variantLines.find(line => line.salePrice !== '' && line.salePrice !== undefined)?.salePrice
          ?? catalogInfo.prices[index - 1] ?? '';
        const salePrice = rawSalePrice === '' ? null : decimalString(rawSalePrice);
        const rawVat = representative.vat === '' || representative.vat === undefined ? 10 : representative.vat;
        const vatRate = decimalString(rawVat);
        if (rawSalePrice !== '' && salePrice === null) {
          issues.error('SALE_PRICE_INVALID', 'El PVP no es numérico.', { productCode: product.code, priceIndex: index, value: rawSalePrice });
        }
        if (salePrice === null) {
          issues.warn('SALE_PRICE_MISSING', 'La variante no tiene PVP; el margen inicial quedará incompleto.', { productCode: product.code, priceIndex: index });
          quality.variantsWithoutSalePrice += 1;
        }
        const variantKey = `${product.key}|${index}`;
        variants.push({
          _key: variantKey,
          product_key: product.key,
          variant_code: cleanText(representative.variantCode) || `${product.code}-P${index}`,
          variant_name: cleanText(representative.variantName) || `Precio ${index}`,
          size: cleanText(representative.size) || String(index),
          price_index: index,
          sale_price: salePrice,
          vat_rate: vatRate,
          active: !deleted && variantLines.some(line => toBoolean(line.active, true)),
          notes: '',
          created_by: userId,
          updated_by: userId
        });
        recipeVersions.push({
          _key: `${variantKey}|1`,
          product_key: product.key,
          variant_key: variantKey,
          version_number: 1,
          valid_from: effectiveDate,
          valid_to: null,
          reason: 'Migración inicial desde app_states/JSON',
          source,
          active: true,
          created_by: userId
        });

        const componentMap = new Map();
        for (const line of variantLines) {
          const stemsRaw = line.stemsPerBouquet ?? 0;
          const stems = decimalString(stemsRaw);
          if (stems === null || decimalToScaled(stems) < 0n) {
            issues.error('STEMS_INVALID', 'El número de tallos no es válido.', { productCode: product.code, priceIndex: index, value: stemsRaw });
            continue;
          }
          const flowerKey = line._resolvedFlowerKey || null;
          if (!flowerKey || !flowersByKey.has(flowerKey)) {
            if (decimalToScaled(stems) !== 0n || cleanText(line.articleCode) || cleanText(line.articleName)) {
              if (!line._flowerResolutionError) {
                issues.error('COMPONENT_FLOWER_UNRESOLVED', 'No se ha podido determinar qué flor representa el componente.', {
                  productCode: product.code,
                  priceIndex: index,
                  articleCode: cleanText(line.articleCode) || null,
                  articleName: cleanText(line.articleName) || null
                });
              }
              quality.componentsOrphaned += 1;
            }
            continue;
          }
          quality.componentsLinked += 1;
          if (!flowersByKey.get(flowerKey).article_code) quality.componentsLinkedWithoutArticleCode += 1;
          const componentKey = `${variantKey}|${flowerKey}`;
          if (componentMap.has(componentKey)) {
            issues.warn('DUPLICATE_COMPONENT', 'La misma flor aparece repetida en una variante; se conserva la última línea como hace la aplicación actual.', {
              productCode: product.code,
              priceIndex: index,
              articleCode: cleanText(line.articleCode) || null,
              articleName: cleanText(line.articleName) || null
            });
          }
          const preferredSupplierKey = supplierKey(line.supplier);
          if (preferredSupplierKey && !suppliersByKey.has(preferredSupplierKey)) {
            addSupplier({ supplier: line.supplier, active: true }, {
              productCode: product.code,
              articleCode: cleanText(line.articleCode) || null,
              articleName: cleanText(line.articleName) || null
            });
          }
          if (preferredSupplierKey) {
            const relationKey = `${flowerKey}|${preferredSupplierKey}`;
            if (!flowerSuppliersByKey.has(relationKey)) {
              const cost = line.unitCost === '' || line.unitCost === undefined ? null : decimalString(line.unitCost);
              if (line.unitCost !== '' && line.unitCost !== undefined && cost === null) {
                issues.error('FLOWER_COST_INVALID', 'El coste del componente no es numérico.', {
                  productCode: product.code,
                  articleCode: cleanText(line.articleCode) || null,
                  articleName: cleanText(line.articleName) || null,
                  value: line.unitCost
                });
              }
              flowerSuppliersByKey.set(relationKey, {
                _key: relationKey,
                flower_key: flowerKey,
                supplier_key: preferredSupplierKey,
                supplier_article_code: null,
                current_unit_cost: cost,
                currency: 'EUR',
                purchase_unit: 'tallo',
                purchase_multiple: decimalString(1),
                is_primary: ![...flowerSuppliersByKey.values()].some(item => item.flower_key === flowerKey && item.is_primary),
                active: true,
                source,
                notes: '',
                cost_updated_at: line.updatedAt || null,
                created_by: userId,
                updated_by: userId
              });
            }
          }
          componentMap.set(componentKey, {
            _key: componentKey,
            recipe_version_key: `${variantKey}|1`,
            product_key: product.key,
            variant_key: variantKey,
            flower_key: flowerKey,
            preferred_supplier_key: preferredSupplierKey || null,
            stems,
            active: toBoolean(line.active, true) && !line.deleted,
            notes: cleanText(line.notes),
            created_by: userId,
            updated_by: userId
          });
        }
        components.push(...componentMap.values());
      }
    }

    flowers.push(...flowersByKey.values());
    suppliers.push(...suppliersByKey.values());
    flowerSuppliers.push(...flowerSuppliersByKey.values());
    quality.flowersWithArticleCode = flowers.filter(row => !!row.article_code).length;
    quality.flowersWithoutArticleCode = flowers.length - quality.flowersWithArticleCode;
    quality.flowerSuppliersWithoutArticleCode = flowerSuppliers.filter(row => !row.supplier_article_code).length;

    for (const relation of flowerSuppliers) {
      if (relation.current_unit_cost === null) {
        issues.warn('FLOWER_COST_MISSING', 'La relación flor/proveedor no tiene coste vigente.', {
          flowerKey: relation.flower_key,
          supplierKey: relation.supplier_key
        });
        continue;
      }
      flowerCostHistory.push({
        _key: `migration|${relation._key}`,
        flower_key: relation.flower_key,
        supplier_key: relation.supplier_key,
        flower_supplier_key: relation._key,
        unit_cost: relation.current_unit_cost,
        currency: relation.currency || 'EUR',
        valid_from: effectiveDate,
        valid_to: null,
        source,
        source_reference: 'Migración inicial desde app_states/JSON',
        source_key: `migration:${relation._key}`,
        notes: 'La fecha histórica anterior es desconocida; la vigencia comienza en la fecha de migración.',
        created_by: userId
      });
    }

    const relationsByFlowerSupplier = new Map(flowerSuppliers.map(row => [`${row.flower_key}|${row.supplier_key}`, row]));
    for (const variant of variants) {
      const variantComponents = components.filter(component => component.variant_key === variant._key && component.active);
      const economicsComponents = variantComponents.map(component => {
        let relation = null;
        if (component.preferred_supplier_key) {
          relation = relationsByFlowerSupplier.get(`${component.flower_key}|${component.preferred_supplier_key}`) || null;
        }
        if (!relation) relation = flowerSuppliers.find(item => item.flower_key === component.flower_key && item.is_primary)
          || flowerSuppliers.find(item => item.flower_key === component.flower_key) || null;
        return {
          stems: component.stems,
          unitCost: relation?.current_unit_cost,
          articleCode: flowersByKey.get(component.flower_key)?.article_code
        };
      });
      const economics = calculateTheoreticalEconomics({
        salePrice: variant.sale_price,
        vatRate: variant.vat_rate,
        components: economicsComponents
      });
      if (economics.missingCosts.length) {
        issues.warn('SNAPSHOT_COST_INCOMPLETE', 'El coste teórico inicial está incompleto por falta de costes de flores.', {
          variantKey: variant._key,
          flowers: economics.missingCosts
        });
      }
      if (variant.sale_price !== null) {
        salePriceHistory.push({
          _key: `migration|${variant._key}`,
          variant_key: variant._key,
          sale_price: variant.sale_price,
          vat_rate: variant.vat_rate,
          currency: 'EUR',
          valid_from: effectiveDate,
          valid_to: null,
          source,
          source_reference: 'Migración inicial desde app_states/JSON',
          source_key: `migration:${variant._key}`,
          notes: 'La fecha histórica anterior es desconocida; la vigencia comienza en la fecha de migración.',
          created_by: userId
        });
      }
      costSnapshots.push({
        _key: `migration|${variant._key}`,
        product_key: variant.product_key,
        variant_key: variant._key,
        effective_date: effectiveDate,
        sale_price: economics.salePrice,
        vat_rate: economics.vatRate,
        currency: 'EUR',
        net_sale_price: economics.netSalePrice,
        theoretical_cost: economics.missingCosts.length ? null : economics.theoreticalCost,
        real_cost: null,
        theoretical_margin_eur: economics.missingCosts.length ? null : economics.theoreticalMarginEur,
        theoretical_margin_pct: economics.missingCosts.length ? null : economics.theoreticalMarginPct,
        real_margin_eur: null,
        real_margin_pct: null,
        source,
        trigger_reason: 'initial_migration',
        source_key: `migration:${variant._key}`,
        notes: economics.missingCosts.length ? `Coste incompleto: ${economics.missingCosts.join(', ')}` : '',
        created_by: userId
      });
    }

    const payload = {
      metadata: { source, effectiveDate, generatedAt: new Date().toISOString() },
      products,
      variants,
      flowers,
      suppliers,
      flowerSuppliers,
      recipeVersions,
      components,
      flowerCostHistory,
      salePriceHistory,
      costSnapshots,
      issues: { errors: issues.errors, warnings: issues.warnings },
      quality: {
        ...quality,
        safeFlowerMatches: duplicateAnalysis.safe,
        possibleFlowerDuplicates: duplicateAnalysis.possible,
        distinctSimilarFlowers: duplicateAnalysis.distinct,
        incompatibleFlowerDuplicates: duplicateAnalysis.incompatible
      }
    };
    payload.preview = {
      products: products.length,
      variants: variants.length,
      flowers: flowers.length,
      suppliers: suppliers.length,
      components: components.length,
      initialCosts: flowerCostHistory.length,
      initialSalePrices: salePriceHistory.length,
      initialSnapshots: costSnapshots.length,
      errors: issues.errors.length,
      warnings: issues.warnings.length,
      information: {
        flowersWithArticleCode: quality.flowersWithArticleCode,
        flowersWithoutArticleCode: quality.flowersWithoutArticleCode,
        componentsLinkedWithoutArticleCode: quality.componentsLinkedWithoutArticleCode,
        componentsOrphaned: quality.componentsOrphaned,
        emptyRowsIgnored: quality.emptyRowsIgnored,
        productRowsWithoutCode: quality.productRowsWithoutCode,
        productRowsWithDataWithoutCode: quality.productRowsWithDataWithoutCode,
        orphanPriceCatalogs: quality.orphanPriceCatalogs,
        safeFlowerMatches: duplicateAnalysis.safe.length,
        possibleFlowerDuplicates: duplicateAnalysis.possible.length,
        distinctSimilarFlowers: duplicateAnalysis.distinct.length,
        flowerSuppliersWithoutArticleCode: quality.flowerSuppliersWithoutArticleCode,
        variantsWithoutSalePrice: quality.variantsWithoutSalePrice
      },
      canMigrate: issues.errors.length === 0
    };
    return payload;
  }

  function currentNomenclatureState() {
    return {
      nomenclatures: typeof nomenclatures !== 'undefined' ? nomenclatures : [],
      flowers: typeof flowers !== 'undefined' ? flowers : [],
      productPriceCatalog: typeof productPriceCatalog !== 'undefined' ? productPriceCatalog : {}
    };
  }

  function previewNomenclatureMigration(options = {}) {
    return buildNomenclatureMigrationPayload(options.state || currentNomenclatureState(), {
      effectiveDate: options.effectiveDate,
      userId: options.userId || (typeof supabaseUser !== 'undefined' ? supabaseUser?.id : null)
    });
  }

  function supabaseContext() {
    const client = typeof supabaseClient !== 'undefined' ? supabaseClient : null;
    const user = typeof supabaseUser !== 'undefined' ? supabaseUser : null;
    if (!client) throw new Error('El cliente de Supabase no está disponible.');
    if (!user) throw new Error('Inicia sesión antes de usar la copia relacional de Nomenclaturas.');
    return { client, user };
  }

  async function fetchAllRows(table, columns = '*', configure = query => query) {
    const { client } = supabaseContext();
    const rows = [];
    const pageSize = 1000;
    for (let offset = 0; ; offset += pageSize) {
      const query = configure(client.from(table).select(columns).range(offset, offset + pageSize - 1));
      const { data, error } = await query;
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    return rows;
  }

  function loadProductsFromSupabase() {
    return fetchAllRows('nomenclature_products');
  }

  function loadFlowersFromSupabase() {
    return fetchAllRows('nomenclature_flowers');
  }

  function loadSuppliersFromSupabase() {
    return fetchAllRows('suppliers');
  }

  async function loadNomenclatureDataFromSupabase(options = {}) {
    try {
      const [products, variants, flowers, suppliers, flowerSuppliers, recipeVersions, components] = await Promise.all([
        loadProductsFromSupabase(),
        fetchAllRows('nomenclature_variants'),
        loadFlowersFromSupabase(),
        loadSuppliersFromSupabase(),
        fetchAllRows('nomenclature_flower_suppliers'),
        fetchAllRows('nomenclature_recipe_versions'),
        fetchAllRows('nomenclature_components')
      ]);
      return { available: true, products, variants, flowers, suppliers, flowerSuppliers, recipeVersions, components };
    } catch (error) {
      if (!options.silent) console.warn('La copia relacional de Nomenclaturas no está disponible; se mantiene el sistema actual.', error);
      return { available: false, error, products: [], variants: [], flowers: [], suppliers: [], flowerSuppliers: [], recipeVersions: [], components: [] };
    }
  }

  async function saveProductToSupabase(product) {
    const { client, user } = supabaseContext();
    const row = { ...product, updated_by: user.id };
    delete row.id;
    const { data, error } = await client.from('nomenclature_products').upsert(row, { onConflict: 'product_code' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveVariantToSupabase(variant) {
    const { client, user } = supabaseContext();
    const row = { ...variant, updated_by: user.id };
    delete row.id;
    const { data, error } = await client.from('nomenclature_variants').upsert(row, { onConflict: 'product_id,price_index' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveFlowerToSupabase(flower) {
    const { client, user } = supabaseContext();
    const row = {
      ...flower,
      article_code: cleanText(flower.article_code ?? flower.articleCode) || null,
      article_name: cleanText(flower.article_name ?? flower.articleName),
      migration_match_key: flower.migration_match_key || flowerMigrationMatchKey({
        articleCode: flower.article_code ?? flower.articleCode,
        articleName: flower.article_name ?? flower.articleName,
        family: flower.family,
        color: flower.color,
        format: flower.format
      }),
      updated_by: user.id
    };
    delete row.id;
    delete row.articleCode;
    delete row.articleName;
    const { data, error } = await client.from('nomenclature_flowers')
      .upsert(row, { onConflict: 'migration_match_key' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveSupplierToSupabase(supplier) {
    const { client, user } = supabaseContext();
    const name = cleanText(supplier.supplier_name || supplier.supplierName);
    const row = {
      ...supplier,
      supplier_name: name,
      normalized_name: supplier.normalized_name || supplierKey(name),
      updated_by: user.id
    };
    delete row.id;
    delete row.supplierName;
    const { data, error } = await client.from('suppliers').upsert(row, { onConflict: 'normalized_name' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveFlowerSupplierToSupabase(relation) {
    const { client, user } = supabaseContext();
    const row = { ...relation, updated_by: user.id };
    delete row.id;
    const { data, error } = await client.from('nomenclature_flower_suppliers')
      .upsert(row, { onConflict: 'flower_id,supplier_id' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveComponentToSupabase(component) {
    const { client, user } = supabaseContext();
    const row = { ...component, updated_by: user.id };
    delete row.id;
    const { data, error } = await client.from('nomenclature_components').upsert(row, { onConflict: 'recipe_version_id,flower_id' }).select().single();
    if (error) throw error;
    return data;
  }

  async function saveFlowerCostToSupabase(cost) {
    const { client } = supabaseContext();
    const { data, error } = await client.rpc('record_nomenclature_flower_cost', {
      p_flower_supplier_id: cost.flowerSupplierId,
      p_unit_cost: decimalString(cost.unitCost),
      p_valid_from: cost.validFrom,
      p_source: cleanText(cost.source || 'manual'),
      p_source_reference: cleanText(cost.sourceReference) || null,
      p_notes: cleanText(cost.notes) || null,
      p_source_key: cleanText(cost.sourceKey) || null,
      p_invoice_id: cost.invoiceId || null,
      p_invoice_line_id: cost.invoiceLineId || null,
      p_invoice_number: cleanText(cost.invoiceNumber) || null,
      p_invoice_date: cost.invoiceDate || null
    });
    if (error) throw error;
    return data;
  }

  async function saveSalePriceToSupabase(price) {
    const { client } = supabaseContext();
    const { data, error } = await client.rpc('record_nomenclature_sale_price', {
      p_variant_id: price.variantId,
      p_sale_price: decimalString(price.salePrice),
      p_vat_rate: decimalString(price.vatRate ?? 10),
      p_valid_from: price.validFrom,
      p_source: cleanText(price.source || 'manual'),
      p_source_reference: cleanText(price.sourceReference) || null,
      p_notes: cleanText(price.notes) || null,
      p_source_key: cleanText(price.sourceKey) || null
    });
    if (error) throw error;
    return data;
  }

  async function createProductCostSnapshot(snapshot) {
    const { client, user } = supabaseContext();
    const row = { ...snapshot, created_by: snapshot.created_by || user.id };
    delete row.id;
    if (!row.source_key) {
      const { data: previous, error: readError } = await client.from('product_cost_snapshots')
        .select('*')
        .eq('variant_id', row.variant_id)
        .order('calculated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      const economicFields = [
        'sale_price', 'vat_rate', 'net_sale_price', 'theoretical_cost', 'real_cost',
        'theoretical_margin_eur', 'theoretical_margin_pct', 'real_margin_eur', 'real_margin_pct'
      ];
      if (previous && economicFields.every(field => comparableDecimal(previous[field]) === comparableDecimal(row[field]))) {
        return { ...previous, snapshot_skipped: true };
      }
      const { data, error } = await client.from('product_cost_snapshots').insert(row).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await client.from('product_cost_snapshots')
      .upsert(row, { onConflict: 'source_key' }).select().single();
    if (error) throw error;
    return data;
  }

  function stripInternal(row) {
    const internalKeys = new Set([
      '_key',
      'product_key',
      'variant_key',
      'flower_key',
      'supplier_key',
      'flower_supplier_key',
      'recipe_version_key',
      'preferred_supplier_key'
    ]);
    return Object.fromEntries(Object.entries(row).filter(([key, value]) => !internalKeys.has(key) && value !== undefined));
  }

  async function upsertBatches(table, rows, onConflict) {
    if (!rows.length) return [];
    const { client } = supabaseContext();
    const saved = [];
    for (let offset = 0; offset < rows.length; offset += 250) {
      const batch = rows.slice(offset, offset + 250).map(stripInternal);
      const { data, error } = await client.from(table).upsert(batch, { onConflict }).select();
      if (error) throw new Error(`${table}: ${error.message || error}`);
      saved.push(...(data || []));
    }
    return saved;
  }

  function idMap(rows, keyBuilder) {
    return new Map(rows.map(row => [keyBuilder(row), row.id]));
  }

  async function migrateNomenclaturesToSupabase(options = {}) {
    const payload = previewNomenclatureMigration(options);
    if (options.dryRun !== false) return payload;
    if (options.confirmed !== true) throw new Error('La migración real requiere { dryRun:false, confirmed:true }. Revisa antes la previsualización.');
    if (!payload.preview.canMigrate) throw new Error(`Migración bloqueada: ${payload.preview.errors} errores críticos.`);
    supabaseContext();

    const savedProducts = await upsertBatches('nomenclature_products', payload.products, 'product_code');
    const productIds = idMap(savedProducts, row => businessKey(row.product_code));
    const savedFlowers = await upsertBatches('nomenclature_flowers', payload.flowers, 'migration_match_key');
    const flowerIds = idMap(savedFlowers, row => row.migration_match_key);
    const savedSuppliers = await upsertBatches('suppliers', payload.suppliers, 'normalized_name');
    const supplierIds = idMap(savedSuppliers, row => row.normalized_name);

    const variants = payload.variants.map(row => ({
      ...row,
      product_id: productIds.get(row.product_key)
    }));
    const savedVariants = await upsertBatches('nomenclature_variants', variants, 'product_id,price_index');
    const productCodeById = new Map(savedProducts.map(row => [row.id, businessKey(row.product_code)]));
    const variantIds = idMap(savedVariants, row => `${productCodeById.get(row.product_id)}|${row.price_index}`);

    const flowerSuppliers = payload.flowerSuppliers.map(row => ({
      ...row,
      flower_id: flowerIds.get(row.flower_key),
      supplier_id: supplierIds.get(row.supplier_key)
    }));
    const savedFlowerSuppliers = await upsertBatches('nomenclature_flower_suppliers', flowerSuppliers, 'flower_id,supplier_id');
    const flowerMatchKeyById = new Map(savedFlowers.map(row => [row.id, row.migration_match_key]));
    const supplierKeyById = new Map(savedSuppliers.map(row => [row.id, row.normalized_name]));
    const flowerSupplierIds = idMap(savedFlowerSuppliers, row => `${flowerMatchKeyById.get(row.flower_id)}|${supplierKeyById.get(row.supplier_id)}`);

    const recipes = payload.recipeVersions.map(row => ({
      ...row,
      product_id: productIds.get(row.product_key),
      variant_id: variantIds.get(row.variant_key)
    }));
    const savedRecipes = await upsertBatches('nomenclature_recipe_versions', recipes, 'variant_id,version_number');
    const variantKeyById = new Map([...variantIds].map(([key, id]) => [id, key]));
    const recipeIds = idMap(savedRecipes, row => `${variantKeyById.get(row.variant_id)}|${row.version_number}`);

    const components = payload.components.map(row => ({
      ...row,
      recipe_version_id: recipeIds.get(row.recipe_version_key),
      product_id: productIds.get(row.product_key),
      variant_id: variantIds.get(row.variant_key),
      flower_id: flowerIds.get(row.flower_key),
      preferred_supplier_id: row.preferred_supplier_key ? supplierIds.get(row.preferred_supplier_key) : null
    }));
    await upsertBatches('nomenclature_components', components, 'recipe_version_id,flower_id');

    const costs = payload.flowerCostHistory.map(row => ({
      ...row,
      flower_id: flowerIds.get(row.flower_key),
      supplier_id: supplierIds.get(row.supplier_key),
      flower_supplier_id: flowerSupplierIds.get(row.flower_supplier_key)
    }));
    await upsertBatches('flower_cost_history', costs, 'source_key');

    const salePrices = payload.salePriceHistory.map(row => ({
      ...row,
      variant_id: variantIds.get(row.variant_key)
    }));
    await upsertBatches('product_sale_price_history', salePrices, 'source_key');

    const snapshots = payload.costSnapshots.map(row => ({
      ...row,
      product_id: productIds.get(row.product_key),
      variant_id: variantIds.get(row.variant_key)
    }));
    await upsertBatches('product_cost_snapshots', snapshots, 'source_key');
    return { migrated: true, preview: payload.preview };
  }

  function comparableDecimal(value) {
    return value === null || value === undefined || value === '' ? null : decimalString(value);
  }

  function compareNomenclaturePayload(local, remote) {
    const differences = [];
    const add = (entity, key, field, localValue, remoteValue, kind = 'different') => {
      differences.push({ entity, key, field, local: localValue, supabase: remoteValue, kind });
    };
    const addDecimalDifference = (entity, key, field, localValue, remoteValue) => {
      const localDecimal = comparableDecimal(localValue);
      const remoteDecimal = comparableDecimal(remoteValue);
      if (localDecimal === remoteDecimal) return;
      let kind = 'different';
      if (localDecimal !== null && remoteDecimal !== null) {
        const distance = decimalToScaled(localDecimal) - decimalToScaled(remoteDecimal);
        const absolute = distance < 0n ? -distance : distance;
        if (absolute <= 100n) kind = 'rounding';
      }
      add(entity, key, field, localValue, remoteValue, kind);
    };
    const remoteProducts = new Map((remote.products || []).map(row => [businessKey(row.product_code), row]));
    const remoteFlowers = new Map((remote.flowers || []).map(row => [
      row.migration_match_key || flowerMigrationMatchKey({
        articleCode: row.article_code,
        articleName: row.article_name,
        family: row.family,
        color: row.color,
        format: row.format
      }),
      row
    ]));
    const remoteSuppliers = new Map((remote.suppliers || []).map(row => [row.normalized_name || supplierKey(row.supplier_name), row]));
    const productKeyById = new Map((remote.products || []).map(row => [row.id, businessKey(row.product_code)]));
    const flowerKeyById = new Map((remote.flowers || []).map(row => [
      row.id,
      row.migration_match_key || flowerMigrationMatchKey({
        articleCode: row.article_code,
        articleName: row.article_name,
        family: row.family,
        color: row.color,
        format: row.format
      })
    ]));
    const supplierKeyById = new Map((remote.suppliers || []).map(row => [row.id, row.normalized_name || supplierKey(row.supplier_name)]));
    const variantKeyById = new Map();
    const remoteVariants = new Map((remote.variants || []).map(row => {
      const key = `${productKeyById.get(row.product_id)}|${row.price_index}`;
      variantKeyById.set(row.id, key);
      return [key, row];
    }));
    const remoteFlowerSuppliers = new Map((remote.flowerSuppliers || []).map(row => [
      `${flowerKeyById.get(row.flower_id)}|${supplierKeyById.get(row.supplier_id)}`, row
    ]));
    const remoteRelationsByFlower = new Map();
    for (const row of remote.flowerSuppliers || []) {
      const flowerKey = flowerKeyById.get(row.flower_id);
      if (!remoteRelationsByFlower.has(flowerKey)) remoteRelationsByFlower.set(flowerKey, []);
      remoteRelationsByFlower.get(flowerKey).push(row);
    }
    const recipeVariantById = new Map((remote.recipeVersions || []).map(row => [row.id, variantKeyById.get(row.variant_id)]));
    const remoteComponents = new Map((remote.components || []).map(row => [
      `${recipeVariantById.get(row.recipe_version_id)}|${flowerKeyById.get(row.flower_id)}`, row
    ]));
    const remoteComponentsByVariant = new Map();
    for (const row of remote.components || []) {
      const variantKey = recipeVariantById.get(row.recipe_version_id);
      if (!remoteComponentsByVariant.has(variantKey)) remoteComponentsByVariant.set(variantKey, []);
      remoteComponentsByVariant.get(variantKey).push(row);
    }

    for (const row of local.products) {
      const other = remoteProducts.get(row._key);
      if (!other) { add('product', row._key, '*', row, null, 'missing'); continue; }
      ['product_name', 'category', 'active', 'deleted'].forEach(field => {
        if (row[field] !== other[field]) add('product', row._key, field, row[field], other[field]);
      });
    }
    for (const row of local.variants) {
      const other = remoteVariants.get(row._key);
      if (!other) { add('variant', row._key, '*', row, null, 'missing'); continue; }
      ['sale_price', 'vat_rate'].forEach(field => {
        addDecimalDifference('variant', row._key, field, row[field], other[field]);
      });
      if (row.active !== other.active) add('variant', row._key, 'active', row.active, other.active);
    }
    for (const row of local.flowers) {
      const other = remoteFlowers.get(row._key);
      if (!other) { add('flower', row._key, '*', row, null, 'missing'); continue; }
      if (row.active !== other.active) add('flower', row._key, 'active', row.active, other.active);
    }
    for (const row of local.suppliers) {
      if (!remoteSuppliers.has(row._key)) add('supplier', row._key, '*', row, null, 'missing');
    }
    for (const row of local.flowerSuppliers) {
      const other = remoteFlowerSuppliers.get(row._key);
      if (!other) { add('flower_supplier', row._key, '*', row, null, 'missing'); continue; }
      addDecimalDifference('flower_supplier', row._key, 'current_unit_cost', row.current_unit_cost, other.current_unit_cost);
    }
    for (const row of local.components) {
      const other = remoteComponents.get(row._key);
      if (!other) { add('component', row._key, '*', row, null, 'missing'); continue; }
      addDecimalDifference('component', row._key, 'stems', row.stems, other.stems);
      const remoteSupplierKey = other.preferred_supplier_id ? supplierKeyById.get(other.preferred_supplier_id) : null;
      if ((row.preferred_supplier_key || null) !== (remoteSupplierKey || null)) {
        add('component', row._key, 'preferred_supplier', row.preferred_supplier_key, remoteSupplierKey);
      }
    }

    const localSnapshots = new Map((local.costSnapshots || []).map(row => [row.variant_key, row]));
    for (const [variantKey, snapshot] of localSnapshots) {
      const remoteVariant = remoteVariants.get(variantKey);
      if (!remoteVariant) continue;
      const economicsComponents = (remoteComponentsByVariant.get(variantKey) || [])
        .filter(row => row.active !== false)
        .map(row => {
          const flowerKey = flowerKeyById.get(row.flower_id);
          let relation = null;
          if (row.preferred_supplier_id) {
            relation = remoteFlowerSuppliers.get(`${flowerKey}|${supplierKeyById.get(row.preferred_supplier_id)}`) || null;
          }
          if (!relation) {
            const candidates = remoteRelationsByFlower.get(flowerKey) || [];
            relation = candidates.find(item => item.is_primary && item.active !== false)
              || candidates.find(item => item.active !== false)
              || null;
          }
          return {
            stems: row.stems,
            unitCost: relation?.current_unit_cost,
            flowerKey
          };
        });
      const remoteEconomics = calculateTheoreticalEconomics({
        salePrice: remoteVariant.sale_price,
        vatRate: remoteVariant.vat_rate,
        components: economicsComponents
      });
      if (remoteEconomics.missingCosts.length) {
        if (snapshot.theoretical_cost !== null) {
          add('economics', variantKey, 'theoretical_cost', snapshot.theoretical_cost, null, 'missing_cost');
        }
        continue;
      }
      addDecimalDifference('economics', variantKey, 'net_sale_price', snapshot.net_sale_price, remoteEconomics.netSalePrice);
      addDecimalDifference('economics', variantKey, 'theoretical_cost', snapshot.theoretical_cost, remoteEconomics.theoreticalCost);
      addDecimalDifference('economics', variantKey, 'theoretical_margin_eur', snapshot.theoretical_margin_eur, remoteEconomics.theoreticalMarginEur);
      addDecimalDifference('economics', variantKey, 'theoretical_margin_pct', snapshot.theoretical_margin_pct, remoteEconomics.theoreticalMarginPct);
    }
    return {
      matches: differences.length === 0,
      differences,
      counts: {
        local: {
          products: local.products.length,
          variants: local.variants.length,
          flowers: local.flowers.length,
          suppliers: local.suppliers.length,
          components: local.components.length
        },
        supabase: {
          products: (remote.products || []).length,
          variants: (remote.variants || []).length,
          flowers: (remote.flowers || []).length,
          suppliers: (remote.suppliers || []).length,
          components: (remote.components || []).length
        }
      }
    };
  }

  async function compareNomenclaturesWithSupabase(options = {}) {
    const local = buildNomenclatureMigrationPayload(options.state || currentNomenclatureState(), {
      effectiveDate: options.effectiveDate,
      userId: typeof supabaseUser !== 'undefined' ? supabaseUser?.id : null
    });
    const remote = await loadNomenclatureDataFromSupabase({ silent: options.silent !== false });
    if (!remote.available) return { matches: false, unavailable: true, error: remote.error, localPreview: local.preview, differences: [] };
    return compareNomenclaturePayload(local, remote);
  }

  return {
    NOMENCLATURE_CATEGORIES,
    appendCostHistory,
    appendSalePriceHistory,
    buildNomenclatureMigrationPayload,
    calculateTheoreticalEconomics,
    classifyFlowerDuplicates,
    compareNomenclaturePayload,
    compareNomenclaturesWithSupabase,
    createProductCostSnapshot,
    decimalString,
    loadFlowersFromSupabase,
    loadNomenclatureDataFromSupabase,
    loadProductsFromSupabase,
    loadSuppliersFromSupabase,
    migrateNomenclaturesToSupabase,
    flowerMigrationMatchKey,
    normalizeFlowerIdentityText,
    previewNomenclatureMigration,
    saveComponentToSupabase,
    saveFlowerCostToSupabase,
    saveFlowerSupplierToSupabase,
    saveFlowerToSupabase,
    saveProductToSupabase,
    saveSalePriceToSupabase,
    saveSupplierToSupabase,
    saveVariantToSupabase,
    transformSupplierInvoice
  };
});
