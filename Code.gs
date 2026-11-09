// Code.gs
// Core operational logic - End users should not modify this file

/**
 * Main entry point for the Google Ads Script.
 */
function main() {
  Logger.log("Starting Script v" + META.version);
  const logs = [];

  // 1. Establish Settings
  const isDryRun = CONFIG.GENERAL.DRY_RUN === true;
  if (isDryRun) {
    Logger.log("--- DRY RUN MODE ENABLED ---");
    logs.push([new Date(), 'INFO', 'DRY RUN MODE ENABLED: Live feeds and permanent villains will not be modified.']);
  }

  const daysBack = CONFIG.GENERAL.DAYS_BACK || 30;
  const daysBackOffset = (CONFIG.GENERAL && CONFIG.GENERAL.DAYS_BACK_OFFSET)
    ? Math.max(0, parseInt(CONFIG.GENERAL.DAYS_BACK_OFFSET, 10) || 0)
    : 0;
  const endDate = getFormattedDate(1 + daysBackOffset);
  const startDate = getFormattedDate(daysBack + daysBackOffset);

  const windowMsg = daysBackOffset > 0
    ? `Performance lookback window: ${startDate} to ${endDate} (${daysBack} days, offset by ${daysBackOffset} days for conversion lag)`
    : `Performance lookback window: ${startDate} to ${endDate} (${daysBack} days)`;
  Logger.log(windowMsg);
  logs.push([new Date(), 'INFO', windowMsg]);
  const minSalesForCpa = (CONFIG.GENERAL && CONFIG.GENERAL.MIN_SALES_FOR_CPA !== undefined)
    ? CONFIG.GENERAL.MIN_SALES_FOR_CPA
    : 0.5;

  const evalMode = resolveEvaluationMode();
  const modeCfg = getActiveModeConfig(evalMode);
  const distributionMode = (CONSTANTS.DISTRIBUTION_MODE || 'STRICT').toUpperCase();
  const modeMsg = `Active Evaluation Mode: ${evalMode} | Distribution Mode: ${distributionMode}`;
  Logger.log(modeMsg);
  logs.push([new Date(), 'INFO', modeMsg]);

  // 1.1 Fetch Margin and Permanent Villains Data
  const shouldLoadMarginSheet = (evalMode === 'VARIABLE_MARGIN' || evalMode === 'HYBRID_MARGIN');
  const marginData = shouldLoadMarginSheet ? getMarginData(logs) : new Map();
  
  const usePermanentVillains = Boolean(
    CONSTANTS.PERMANENT_VILLAINS_SHEET &&
    (CONSTANTS.PERMANENT_VILLAINS_SHEET.USE_PERMANENT_LIST === true ||
     CONSTANTS.PERMANENT_VILLAINS_SHEET.use_permanent_list === true)
  );
  let permanentVillains = new Set();
  if (usePermanentVillains) {
    const msg = 'Permanent villains list is enabled.';
    Logger.log(msg);
    logs.push([new Date(), 'INFO', msg]);
    permanentVillains = getPermanentVillains(logs);
  } else {
    const msg = 'Permanent villains list is disabled. Evaluating villains based on lookback performance only.';
    Logger.log(msg);
    logs.push([new Date(), 'INFO', msg]);
  }
  const newVillains = [];

  // 2. Open the Spreadsheet and prepare the sheet
  const ss = SpreadsheetApp.openByUrl(CONSTANTS.OUTPUT_SHEET.URL);
  ensureTabOrder(ss, isDryRun);

  const tabName = isDryRun ? `${CONSTANTS.OUTPUT_SHEET.TAB_NAME} - Dry Run` : CONSTANTS.OUTPUT_SHEET.TAB_NAME;
  let sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  sheet.clear();
  const labelColumn = CONSTANTS.OUTPUT_SHEET.LABEL_COLUMN || 'custom_label_0';

  const headers = [
    'id',
    labelColumn,
    '_price',
    '_margin',
    '_sales',
    '_cost',
    '_conv_value',
    '_cpa',
    '_roas',
    '_cpa/margin',
    '_cost/margin',
    '_clicks',
    '_impressions'
  ];

  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  // If in dry run mode, also ensure the primary live tab has headers if newly created
  if (isDryRun) {
    const liveSheet = ss.getSheetByName(CONSTANTS.OUTPUT_SHEET.TAB_NAME);
    if (liveSheet && liveSheet.getLastRow() === 0) {
      liveSheet.appendRow(headers);
      liveSheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }

  // 3. Query Base Performance via GAQL
  const products = [];
  const formatProductId = createProductIdFormatter(logs);
  const rawConvActionId = CONSTANTS.CONVERSION_ACTION_ID;
  const convActionId = rawConvActionId ? String(rawConvActionId).trim() : '';
  const hasSpecificConvAction = Boolean(convActionId && convActionId !== 'REPLACE_WITH_YOUR_CONVERSION_ID');

  if (hasSpecificConvAction) {
    // 1. Resolve Conversion Action details dynamically from the Google Ads account
    let convResourceName = convActionId;
    let convActionName = '';
    let isPrimaryMetric = true;

    try {
      const cleanId = String(convActionId).trim().replace(/['"]/g, '');
      const idMatch = cleanId.match(/(\d+)$/);
      const numericId = idMatch ? idMatch[1] : cleanId;

      const caQuery = `
        SELECT
          conversion_action.id,
          conversion_action.name,
          conversion_action.resource_name,
          conversion_action.include_in_conversions_metric,
          conversion_action.status
        FROM conversion_action
        WHERE conversion_action.id = ${numericId}
      `;
      const caReport = AdsApp.search(caQuery);
      if (caReport.hasNext()) {
        const caRow = caReport.next();
        convResourceName = caRow.conversionAction.resourceName;
        convActionName = caRow.conversionAction.name || '';
        isPrimaryMetric = caRow.conversionAction.includeInConversionsMetric !== false;
        const foundMsg = `Found Conversion Action: "${convActionName}" (${convResourceName}) | Primary: ${isPrimaryMetric}`;
        Logger.log(foundMsg);
        logs.push([new Date(), 'INFO', foundMsg]);
      } else {
        const notFoundMsg = `WARNING: Conversion Action with ID ${convActionId} was not found in account conversion_action view. Using fallback resource name.`;
        Logger.log(notFoundMsg);
        logs.push([new Date(), 'WARNING', notFoundMsg]);
      }
    } catch (e) {
      const warnMsg = `NOTICE: Could not query conversion_action view directly (${e.message}). Proceeding with constructed resource name.`;
      Logger.log(warnMsg);
      logs.push([new Date(), 'INFO', warnMsg]);
    }

    if (!convResourceName || !convResourceName.startsWith('customers/')) {
      const customerId = AdsApp.currentAccount().getCustomerId().replace(/-/g, '');
      const cleanNumericId = String(convActionId).trim().replace(/[^\d]/g, '');
      convResourceName = `customers/${customerId}/conversionActions/${cleanNumericId}`;
    }

    const infoMsg = `Querying performance for Conversion Action: ${convResourceName}`;
    Logger.log(infoMsg);
    logs.push([new Date(), 'INFO', infoMsg]);

    // Query 1: Base performance (clicks, impressions, cost) across all products
    const baseQuery = `
      SELECT
        segments.product_item_id,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;
    const baseReport = AdsApp.search(baseQuery);
    const productMap = new Map();

    while (baseReport.hasNext()) {
      const row = baseReport.next();
      if (!row.segments || !row.segments.productItemId) continue;
      const id = formatProductId(row.segments.productItemId);
      const metrics = row.metrics || {};
      const cost = Number(metrics.costMicros || 0) / 1000000;
      const clicks = Number(metrics.clicks || 0);
      const impressions = Number(metrics.impressions || 0);

      if (productMap.has(id)) {
        const existing = productMap.get(id);
        existing.cost += cost;
        existing.clicks += clicks;
        existing.impressions += impressions;
      } else {
        productMap.set(id, {
          id: id,
          sales: 0,
          cost: cost,
          cpa: 0,
          clicks: clicks,
          impressions: impressions,
          revenue: 0
        });
      }
    }

    // Query 2: Segmented conversion performance for the specific conversion action
    // Select both 'conversions' (Primary) and 'all_conversions' (Secondary/Observational)
    const convQuery = `
      SELECT
        segments.product_item_id,
        segments.conversion_action,
        metrics.conversions,
        metrics.conversions_value,
        metrics.all_conversions,
        metrics.all_conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
        AND segments.conversion_action = '${convResourceName}'
    `;
    let convMatchCount = 0;
    let totalConvsSum = 0;
    let totalRevenueSum = 0;

    try {
      const convReport = AdsApp.search(convQuery);
      while (convReport.hasNext()) {
        const row = convReport.next();
        if (!row.segments || !row.segments.productItemId) continue;
        const id = formatProductId(row.segments.productItemId);
        const metrics = row.metrics || {};
        
        // Support both Primary (conversions) and Secondary/Observational (allConversions)
        // all_conversions includes both primary and secondary conversions across campaigns
        const sales = Math.max(Number(metrics.allConversions || 0), Number(metrics.conversions || 0));
        const revenue = Math.round(Math.max(Number(metrics.allConversionsValue || 0), Number(metrics.conversionsValue || 0)) * 100) / 100;

        convMatchCount++;
        totalConvsSum += sales;
        totalRevenueSum += revenue;

        if (productMap.has(id)) {
          const prod = productMap.get(id);
          prod.sales += sales;
          prod.revenue = Math.round((prod.revenue + revenue) * 100) / 100;
        } else {
          productMap.set(id, {
            id: id,
            sales: sales,
            cost: 0,
            cpa: 0,
            clicks: 0,
            impressions: 0,
            revenue: revenue
          });
        }
      }
      const matchMsg = `Filtered conversion query matched ${convMatchCount} rows for conversion action "${convActionName || convActionId}". Total conversions: ${totalConvsSum.toFixed(2)}, Total value: $${totalRevenueSum.toFixed(2)}.`;
      Logger.log(matchMsg);
      logs.push([new Date(), 'INFO', matchMsg]);

      if (convMatchCount === 0) {
        const zeroMsg = `WARNING: 0 rows returned for conversion action "${convResourceName}". Verify that the Conversion Action ID is correct and that it has recorded conversions between ${startDate} and ${endDate}.`;
        Logger.log(zeroMsg);
        logs.push([new Date(), 'WARNING', zeroMsg]);
      }
    } catch (e) {
      const errMsg = `ERROR querying conversion action (${convResourceName}): ${e.message}`;
      Logger.log(errMsg);
      logs.push([new Date(), 'ERROR', errMsg]);
    }

    productMap.forEach(product => {
      product.cpa = (product.sales >= minSalesForCpa) ? product.cost / Math.max(1, product.sales) : 0;
      products.push(product);
    });
  } else {
    // Fallback: Query all conversions at default account level
    const baseQuery = `
      SELECT
        segments.product_item_id,
        metrics.conversions,
        metrics.clicks,
        metrics.impressions,
        metrics.cost_micros,
        metrics.conversions_value
      FROM shopping_performance_view
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;
    const baseReport = AdsApp.search(baseQuery);
    const productMap = new Map();

    while (baseReport.hasNext()) {
      const row = baseReport.next();
      if (!row.segments || !row.segments.productItemId) continue;
      const id = formatProductId(row.segments.productItemId);
      const metrics = row.metrics || {};
      const cost = Number(metrics.costMicros || 0) / 1000000;
      const sales = Number(metrics.conversions || 0);
      const revenue = Math.round(Number(metrics.conversionsValue || 0) * 100) / 100;
      const clicks = Number(metrics.clicks || 0);
      const impressions = Number(metrics.impressions || 0);

      if (productMap.has(id)) {
        const existing = productMap.get(id);
        existing.sales += sales;
        existing.cost += cost;
        existing.clicks += clicks;
        existing.impressions += impressions;
        existing.revenue = Math.round((existing.revenue + revenue) * 100) / 100;
      } else {
        productMap.set(id, {
          id: id,
          sales: sales,
          cost: cost,
          cpa: 0,
          clicks: clicks,
          impressions: impressions,
          revenue: revenue
        });
      }
    }

    productMap.forEach(product => {
      product.cpa = (product.sales >= minSalesForCpa) ? product.cost / Math.max(1, product.sales) : 0;
      products.push(product);
    });
  }

  // 3.1 Fetch Missing Live Prices from shopping_product
  const defaultMarginRate = (modeCfg.DEFAULT_MARGIN_RATE !== undefined && modeCfg.DEFAULT_MARGIN_RATE !== null)
    ? (Number(modeCfg.DEFAULT_MARGIN_RATE) > 1 ? Number(modeCfg.DEFAULT_MARGIN_RATE) / 100 : Number(modeCfg.DEFAULT_MARGIN_RATE))
    : null;

  const marginType = (CONSTANTS.MARGIN_SHEET && CONSTANTS.MARGIN_SHEET.MARGIN_TYPE
    ? CONSTANTS.MARGIN_SHEET.MARGIN_TYPE
    : 'ABSOLUTE').toUpperCase();

  if (evalMode === 'FLAT_MARGIN' && (defaultMarginRate === null || defaultMarginRate <= 0)) {
    const warnMsg = `WARNING: EVALUATION_MODE is set to 'FLAT_MARGIN' but DEFAULT_MARGIN_RATE is not configured. Falling back to account-level ROAS and spend thresholds.`;
    Logger.log(warnMsg);
    logs.push([new Date(), 'WARNING', warnMsg]);
  }

  const usesMargins = evalMode !== 'ROAS';

  let missingPriceCount = 0;
  products.forEach(p => {
    const margins = shouldLoadMarginSheet ? getMarginsForId(marginData, p.id) : null;
    p.price = (margins && margins.price > 0) ? margins.price : (p.price || 0);
    if (p.price <= 0) missingPriceCount++;
  });

  if (missingPriceCount > 0) {
    if (shouldLoadMarginSheet) {
      const warnReason = !marginData.hasPriceCol
        ? `WARNING: PRICE column is not declared or not found in the margin sheet. Fetching live prices for ${missingPriceCount} products from shopping_product...`
        : `WARNING: ${missingPriceCount} products are missing prices in the margin sheet. Fetching live prices from shopping_product...`;
      Logger.log(warnReason);
      logs.push([new Date(), 'WARNING', warnReason]);
    } else {
      const msg = `Fetching live prices for ${missingPriceCount} products from shopping_product...`;
      Logger.log(msg);
      logs.push([new Date(), 'INFO', msg]);
    }

    try {
      const priceQuery = `
        SELECT
          shopping_product.item_id,
          shopping_product.price_micros
        FROM shopping_product
      `;
      const priceReport = AdsApp.search(priceQuery);
      const livePriceMap = new Map();
      while (priceReport.hasNext()) {
        const row = priceReport.next();
        if (row.shoppingProduct && row.shoppingProduct.itemId) {
          const itemId = formatProductId(row.shoppingProduct.itemId);
          const price = Number(row.shoppingProduct.priceMicros || 0) / 1000000;
          livePriceMap.set(itemId.toUpperCase(), price);
        }
      }

      let updatedPriceCount = 0;
      products.forEach(p => {
        if (p.price <= 0) {
          const cleanId = String(p.id).trim().toUpperCase();
          if (livePriceMap.has(cleanId)) {
            p.price = livePriceMap.get(cleanId);
            updatedPriceCount++;
          }
        }
      });

      const successMsg = `Successfully fetched live prices for ${updatedPriceCount} products.`;
      Logger.log(successMsg);
      logs.push([new Date(), 'INFO', successMsg]);
    } catch (e) {
      const warnMsg = `WARNING: Failed to fetch live prices from shopping_product (${e.message}). Proceeding without them.`;
      Logger.log(warnMsg);
      logs.push([new Date(), 'WARNING', warnMsg]);
    }
  }

  // 4. Calculate Metrics & Margins for Products
  let missingMarginCount = 0;
  let fallbackMarginCount = 0;
  products.forEach(p => {
    const margins = shouldLoadMarginSheet ? getMarginsForId(marginData, p.id) : null;
    p.price = (margins && margins.price > 0) ? margins.price : (p.price || 0);
    p.cogs = margins ? margins.cogs : 0;
    const marginVal = margins && margins.margin !== null && !isNaN(margins.margin) ? margins.margin : null;

    if (!usesMargins) {
      // Pure ROAS Mode ('ROAS'): No unit margin calculation needed
      p.grossProfit = 0;
      p.cpaIndex = 0;
      p.poas = 0;
      p.netProfit = Math.round((p.revenue - p.cost) * 100) / 100;
      p.margin = '';
    } else if (shouldLoadMarginSheet && marginType === 'PERCENTAGE' && marginVal !== null) {
      // 1. Percentage margin from sheet
      const marginRate = marginVal > 1 ? marginVal / 100 : marginVal;
      const unitMargin = p.price > 0
        ? (p.price * marginRate)
        : (p.sales >= minSalesForCpa ? (p.revenue * marginRate) / p.sales : 0);
      const totalGrossProfit = p.price > 0 ? (p.sales * unitMargin) : (p.revenue * marginRate);
      p.grossProfit = unitMargin;
      p.cpaIndex = (p.grossProfit > 0 && p.cpa > 0) ? p.cpa / p.grossProfit : 0;
      p.poas = p.cost > 0 ? totalGrossProfit / p.cost : 0;
      p.netProfit = Math.round((totalGrossProfit - p.cost) * 100) / 100;
      p.margin = unitMargin > 0 ? Math.round(unitMargin * 100) / 100 : '';
    } else if (shouldLoadMarginSheet && (marginVal !== null || (margins && p.price > 0 && p.cogs > 0))) {
      // 2. Absolute dollar margin from sheet
      p.grossProfit = marginVal !== null ? marginVal : (p.price - p.cogs);
      p.cpaIndex = (p.grossProfit > 0 && p.cpa > 0) ? p.cpa / p.grossProfit : 0;
      p.poas = p.cost > 0 ? (p.grossProfit * p.sales) / p.cost : 0;
      p.netProfit = p.grossProfit > 0
        ? Math.round(((p.sales * p.grossProfit) - p.cost) * 100) / 100
        : Math.round((p.revenue - p.cost) * 100) / 100;
      p.margin = p.grossProfit > 0 ? Math.round(p.grossProfit * 100) / 100 : '';
    } else if (defaultMarginRate !== null && defaultMarginRate > 0) {
      // 3. Global flat margin ('FLAT_MARGIN') or fallback to DEFAULT_MARGIN_RATE when missing from sheet
      fallbackMarginCount++;
      const unitMargin = p.price > 0
        ? (p.price * defaultMarginRate)
        : (p.sales >= minSalesForCpa ? (p.revenue * defaultMarginRate) / p.sales : 0);
      const totalGrossProfit = p.price > 0 ? (p.sales * unitMargin) : (p.revenue * defaultMarginRate);
      p.grossProfit = unitMargin;
      p.cpaIndex = (p.grossProfit > 0 && p.cpa > 0) ? p.cpa / p.grossProfit : 0;
      p.poas = p.cost > 0 ? totalGrossProfit / p.cost : 0;
      p.netProfit = Math.round((totalGrossProfit - p.cost) * 100) / 100;
      p.margin = unitMargin > 0 ? Math.round(unitMargin * 100) / 100 : '';
    } else {
      // 4. No margin data available (falls back to account-level fallback_min_roas & fallback_max_spend)
      missingMarginCount++;
      p.grossProfit = 0;
      p.cpaIndex = 0;
      p.poas = 0;
      p.netProfit = Math.round((p.revenue - p.cost) * 100) / 100;
      p.margin = '';
    }

    p.roas = p.cost > 0 ? Math.round((p.revenue / p.cost) * 1000) / 1000 : 0;
    p.cpaToMargin = (p.sales >= minSalesForCpa && p.margin > 0) ? Math.round((p.cpa / p.margin) * 100) / 100 : '';
    p.costToMargin = (p.sales < minSalesForCpa && p.margin > 0) ? Math.round((p.cost / p.margin) * 100) / 100 : '';
  });

  // 5. Assign Labels based on configured Mode & Criteria
  assignLabels(products, permanentVillains, newVillains, evalMode);

  // 6. Format and Write Rows to Sheet
  const rowsToInsert = products.map(p => {
    return [
      p.id,
      p.label,
      p.price || '',
      p.margin,
      Math.round(p.sales * 1000) / 1000,
      Math.round(p.cost * 100) / 100,
      p.revenue || 0,
      Math.round(p.cpa * 100) / 100,
      p.roas,
      p.cpaToMargin,
      p.costToMargin,
      p.clicks,
      p.impressions
    ];
  });

  if (usesMargins) {
    if (evalMode === 'FLAT_MARGIN' && defaultMarginRate !== null) {
      const noticeMsg = `NOTICE: Applied global flat margin rate of ${(defaultMarginRate * 100).toFixed(1)}% across ${fallbackMarginCount} products.`;
      Logger.log(noticeMsg);
      logs.push([new Date(), 'INFO', noticeMsg]);
    } else if (fallbackMarginCount > 0 && marginData.size > 0) {
      const noticeMsg = `NOTICE: Applied fallback default margin rate of ${(defaultMarginRate * 100).toFixed(1)}% to ${fallbackMarginCount} products missing from the margin sheet.`;
      Logger.log(noticeMsg);
      logs.push([new Date(), 'INFO', noticeMsg]);
    } else if (defaultMarginRate !== null && marginData.size === 0) {
      const noticeMsg = `NOTICE: Applied default margin rate of ${(defaultMarginRate * 100).toFixed(1)}% across ${fallbackMarginCount} products.`;
      Logger.log(noticeMsg);
      logs.push([new Date(), 'INFO', noticeMsg]);
    } else if (marginData.size === 0) {
      const noticeMsg = 'NOTICE: Operating in Marginless Fallback mode using account-level ROAS and spend limits.';
      Logger.log(noticeMsg);
      logs.push([new Date(), 'INFO', noticeMsg]);
    }

    if (missingMarginCount > 0) {
      const warningMsg = `WARNING: Missing margin data for ${missingMarginCount} of ${products.length} products. Operating with fallback ROAS and spend limits for these items.`;
      Logger.log(warningMsg);
      logs.push([new Date(), 'WARNING', warningMsg]);
    }
  } else {
    const noticeMsg = 'NOTICE: Operating in Pure ROAS mode (ROAS). Evaluating solely on Google Ads revenue and cost.';
    Logger.log(noticeMsg);
    logs.push([new Date(), 'INFO', noticeMsg]);
  }

  // Append new villains incrementally if permanent list is enabled
  if (usePermanentVillains && newVillains.length > 0) {
    if (!isDryRun) {
      appendNewVillains(newVillains, logs);
    } else {
      const msg = `DRY RUN: Skipped appending ${newVillains.length} new villains to the permanent list.`;
      Logger.log(msg);
      logs.push([new Date(), 'INFO', msg]);
    }
  }

  if (rowsToInsert.length > 0) {
    const numCols = rowsToInsert[0].length;
    const batchSize = 10000;
    for (let i = 0; i < rowsToInsert.length; i += batchSize) {
      const chunk = rowsToInsert.slice(i, i + batchSize);
      sheet.getRange(2 + i, 1, chunk.length, numCols).setValues(chunk);
    }

    // Format numeric columns:
    // Cols 3-4 (price, margin): 0.00
    // Col 5 (sales): 0.000
    // Cols 6-8 (cost, conv_value, cpa): 0.00
    // Col 9 (roas): 0.000
    // Cols 10-11 (cpa/margin, cost/margin): 0.00
    // Cols 12-13 (clicks, impressions): 0
    sheet.getRange(2, 3, rowsToInsert.length, 2).setNumberFormat('0.00');
    sheet.getRange(2, 5, rowsToInsert.length, 1).setNumberFormat('0.000');
    sheet.getRange(2, 6, rowsToInsert.length, 3).setNumberFormat('0.00');
    sheet.getRange(2, 9, rowsToInsert.length, 1).setNumberFormat('0.000');
    sheet.getRange(2, 10, rowsToInsert.length, 2).setNumberFormat('0.00');
    sheet.getRange(2, 12, rowsToInsert.length, 2).setNumberFormat('0');

    const msg = `Successfully exported ${rowsToInsert.length} products to ${tabName}.`;
    Logger.log(msg);
    logs.push([new Date(), 'INFO', msg]);
    
    // Generate dashboard tabs
    writeOverviewSheet(ss, products, isDryRun);
    if (CONSTANTS.OUTPUT_SHEET.ENABLE_TRENDS_LOG && CONSTANTS.OUTPUT_SHEET.TRENDS_TAB_NAME) {
      writeLabelTrendsSheet(ss, products, isDryRun);
    }
  } else {
    const msg = 'No product data found.';
    Logger.log(msg);
    logs.push([new Date(), 'INFO', msg]);
  }

  writeLogsToSheet(logs);
}

/**
 * Resolves the active evaluation mode from CONSTANTS.EVALUATION_MODE.
 */
function resolveEvaluationMode() {
  const validModes = ['ROAS', 'FLAT_MARGIN', 'VARIABLE_MARGIN', 'HYBRID_MARGIN'];
  if (CONSTANTS && CONSTANTS.EVALUATION_MODE) {
    const configured = String(CONSTANTS.EVALUATION_MODE).trim().toUpperCase();
    if (validModes.indexOf(configured) !== -1) {
      return configured;
    }
  }
  return 'ROAS';
}

/**
 * Returns the mode-specific configuration object from CONFIG.MODES for the active evaluation mode.
 */
function getActiveModeConfig(evalMode) {
  const mode = evalMode || resolveEvaluationMode();
  return (CONFIG && CONFIG.MODES && CONFIG.MODES[mode]) ? CONFIG.MODES[mode] : {};
}

/**
 * Validates CONSTANTS.PRODUCT_ID_REPLACE and returns a safe product ID formatter function.
 * Supports string replacements and callback functions while guarding against invalid patterns or runtime errors.
 */
function createProductIdFormatter(logs) {
  const identity = (rawId) => String(rawId).trim();
  const replaceCfg = CONSTANTS && CONSTANTS.PRODUCT_ID_REPLACE;
  if (!replaceCfg) return identity;

  const pattern = replaceCfg.PATTERN;
  const rawReplacement = (replaceCfg.REPLACEMENT !== undefined && replaceCfg.REPLACEMENT !== null)
    ? replaceCfg.REPLACEMENT
    : '';

  if (pattern === null || pattern === undefined || pattern === '') {
    if (rawReplacement !== '') {
      const warnMsg = 'WARNING: PRODUCT_ID_REPLACE.REPLACEMENT is configured, but PATTERN is null or empty. Skipping product ID replacement.';
      Logger.log(warnMsg);
      if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
    }
    return identity;
  }

  const isValidPattern = (pattern instanceof RegExp) || (Object.prototype.toString.call(pattern) === '[object RegExp]') || (typeof pattern === 'string');
  if (!isValidPattern) {
    const errMsg = `ERROR: Invalid PRODUCT_ID_REPLACE.PATTERN (type: ${typeof pattern}). Must be a RegExp (e.g. /[a-z]/g) or string. Skipping product ID replacement.`;
    Logger.log(errMsg);
    if (logs) logs.push([new Date(), 'ERROR', errMsg]);
    return identity;
  }

  const isFunctionReplacement = (typeof rawReplacement === 'function');
  const isStringReplacement = (typeof rawReplacement === 'string');
  if (!isFunctionReplacement && !isStringReplacement) {
    const errMsg = `ERROR: Invalid PRODUCT_ID_REPLACE.REPLACEMENT (type: ${typeof rawReplacement}). Must be a string or a callback function. Skipping product ID replacement.`;
    Logger.log(errMsg);
    if (logs) logs.push([new Date(), 'ERROR', errMsg]);
    return identity;
  }

  let hasDisabledOnError = false;
  let hasWarnedEmpty = false;

  const safeReplacement = isFunctionReplacement
    ? function(...args) {
        const res = rawReplacement(...args);
        if (res === undefined || res === null) {
          throw new Error('Callback returned undefined or null (ensure your function returns a string)');
        }
        return String(res);
      }
    : rawReplacement;

  // Dry-test on a sample ID at startup to catch immediate callback errors
  try {
    'sample_id_123'.replace(pattern, safeReplacement);
  } catch (e) {
    const errMsg = `ERROR: PRODUCT_ID_REPLACE failed validation (${e.message}). Skipping product ID replacement.`;
    Logger.log(errMsg);
    if (logs) logs.push([new Date(), 'ERROR', errMsg]);
    return identity;
  }

  const infoMsg = `Product ID replacement active: PATTERN=${String(pattern)}, REPLACEMENT=${isFunctionReplacement ? '[Callback Function]' : JSON.stringify(rawReplacement)}`;
  Logger.log(infoMsg);
  if (logs) logs.push([new Date(), 'INFO', infoMsg]);

  return function(rawId) {
    const cleanId = String(rawId).trim();
    if (!cleanId || hasDisabledOnError) return cleanId;

    try {
      const updated = cleanId.replace(pattern, safeReplacement).trim();
      if (!updated) {
        if (!hasWarnedEmpty) {
          hasWarnedEmpty = true;
          const warnMsg = `WARNING: PRODUCT_ID_REPLACE produced an empty ID for "${cleanId}". Keeping original ID.`;
          Logger.log(warnMsg);
          if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
        }
        return cleanId;
      }
      return updated;
    } catch (e) {
      hasDisabledOnError = true;
      const errMsg = `ERROR: PRODUCT_ID_REPLACE failed on ID "${cleanId}" (${e.message}). Reverting to original IDs for remaining products.`;
      Logger.log(errMsg);
      if (logs) logs.push([new Date(), 'ERROR', errMsg]);
      return cleanId;
    }
  };
}

/**
 * Resolves the effective max_cpa_to_margin_ratio thresholds for HERO and SUPERHERO
 * from the active mode configuration.
 */
function getCpaToMarginThresholds(modeCfg) {
  const heroRatio = (modeCfg.HERO && modeCfg.HERO.max_cpa_to_margin_ratio !== undefined)
    ? modeCfg.HERO.max_cpa_to_margin_ratio
    : 1.00;
  const superheroRatio = (modeCfg.SUPERHERO && modeCfg.SUPERHERO.max_cpa_to_margin_ratio !== undefined)
    ? modeCfg.SUPERHERO.max_cpa_to_margin_ratio
    : heroRatio;

  return {
    heroMaxCpaRatio: heroRatio,
    superheroMaxCpaRatio: superheroRatio,
    highestMaxCpaRatio: Math.max(heroRatio, superheroRatio)
  };
}

/**
 * Evaluates whether a converting product (sales >= minSalesForCpa) is unprofitable (Anti-Hero).
 */
function isProductUnprofitable(p, evalMode, modeCfg) {
  const activeModeCfg = modeCfg || getActiveModeConfig(evalMode);
  const roas = p.cost > 0 ? (p.revenue / p.cost) : 0;
  const useRoasForSellers = (evalMode === 'ROAS' || evalMode === 'HYBRID_MARGIN');

  if (useRoasForSellers) {
    const effectiveHeroRoas = (activeModeCfg.HERO && activeModeCfg.HERO.min_roas !== undefined)
      ? activeModeCfg.HERO.min_roas
      : 1.25;
    const effectiveSuperheroRoas = (activeModeCfg.SUPERHERO && activeModeCfg.SUPERHERO.min_roas !== undefined)
      ? activeModeCfg.SUPERHERO.min_roas
      : effectiveHeroRoas;

    const lowestMinRoas = Math.min(effectiveHeroRoas, effectiveSuperheroRoas);
    if (roas < lowestMinRoas) {
      return true;
    }

    // If SUPERHERO.min_roas is set lower than HERO.min_roas and ROAS is between them,
    // the product is only profitable if it meets the sales volume to qualify for Superhero.
    if (roas < effectiveHeroRoas) {
      const mode = (CONSTANTS.DISTRIBUTION_MODE || 'STRICT').toUpperCase();
      const heroMinSales = (activeModeCfg.HERO && activeModeCfg.HERO.min_sales !== undefined) ? activeModeCfg.HERO.min_sales : 1;
      const superheroMinSales = (activeModeCfg.SUPERHERO && activeModeCfg.SUPERHERO.min_sales !== undefined) ? activeModeCfg.SUPERHERO.min_sales : 3;
      if (mode === 'STRICT' && p.sales < superheroMinSales) {
        return true;
      }
      if (mode !== 'STRICT' && p.sales < heroMinSales) {
        return true;
      }
    }

    return false;
  }

  // Margin evaluation ('FLAT_MARGIN' or 'VARIABLE_MARGIN')
  const roasSafeguard = activeModeCfg.ANTI_HERO && activeModeCfg.ANTI_HERO.roas_safeguard;
  if (roasSafeguard && roas >= roasSafeguard) {
    return false;
  }
  if (p.grossProfit > 0) {
    const { heroMaxCpaRatio, highestMaxCpaRatio } = getCpaToMarginThresholds(activeModeCfg);
    if (p.cpa > (p.grossProfit * highestMaxCpaRatio)) {
      return true;
    }

    // If SUPERHERO.max_cpa_to_margin_ratio is set higher (looser) than HERO.max_cpa_to_margin_ratio
    // and CPA is between them, the product is only profitable if it meets the sales volume to qualify for Superhero.
    if (p.cpa > (p.grossProfit * heroMaxCpaRatio)) {
      const mode = (CONSTANTS.DISTRIBUTION_MODE || 'STRICT').toUpperCase();
      const heroMinSales = (activeModeCfg.HERO && activeModeCfg.HERO.min_sales !== undefined) ? activeModeCfg.HERO.min_sales : 1;
      const superheroMinSales = (activeModeCfg.SUPERHERO && activeModeCfg.SUPERHERO.min_sales !== undefined) ? activeModeCfg.SUPERHERO.min_sales : 3;
      if (mode === 'STRICT' && p.sales < superheroMinSales) {
        return true;
      }
      if (mode !== 'STRICT' && p.sales < heroMinSales) {
        return true;
      }
    }

    return false;
  }

  // Fallback evaluation when margin data is missing for a product
  const minRoas = (activeModeCfg.ANTI_HERO && activeModeCfg.ANTI_HERO.fallback_min_roas !== undefined)
    ? activeModeCfg.ANTI_HERO.fallback_min_roas
    : 1.0;
  return roas < minRoas;
}

/**
 * Applies labels to products according to the distribution mode and fallback rules.
 */
function assignLabels(products, permanentVillains, newVillains, evalMode) {
  const activeEvalMode = evalMode || resolveEvaluationMode();
  const modeCfg = getActiveModeConfig(activeEvalMode);
  const mode = (CONSTANTS.DISTRIBUTION_MODE || 'STRICT').toUpperCase();
  const percentiles = CONSTANTS.PERCENTILES || {};
  const labelsConfig = CONFIG.LABELS;
  const minSalesForCpa = (CONFIG.GENERAL && CONFIG.GENERAL.MIN_SALES_FOR_CPA !== undefined)
    ? CONFIG.GENERAL.MIN_SALES_FOR_CPA
    : 0.5;

  // Resolve cascading fallbacks if label names are omitted
  const sidekickName = labelsConfig.SIDEKICK.name || '';
  const villainName = labelsConfig.VILLAIN.name || sidekickName;
  const antiHeroName = labelsConfig.ANTI_HERO.name || villainName;
  const heroName = labelsConfig.HERO.name || sidekickName;
  const superheroName = labelsConfig.SUPERHERO.name || heroName;
  const ghostName = (labelsConfig.GHOST && labelsConfig.GHOST.name) ? labelsConfig.GHOST.name : sidekickName;

  if (mode === 'PERCENTILE' || mode === 'HYBRID') {
    // Percentile-based assignment: Rank profitable sellers meeting the volume threshold
    const minSales = mode === 'HYBRID'
      ? (modeCfg.HERO && modeCfg.HERO.min_sales !== undefined ? modeCfg.HERO.min_sales : 1)
      : minSalesForCpa;
    const sellers = products.filter(p => {
      const isVillain = permanentVillains.has(p.id) || permanentVillains.has(p.id.toUpperCase());
      if (isVillain || p.sales < minSales) return false;
      if (p.sales >= minSalesForCpa && isProductUnprofitable(p, activeEvalMode, modeCfg)) return false;
      return true;
    });
    
    // Rank profitable sellers by Net Profit descending
    sellers.sort((a, b) => b.netProfit - a.netProfit);

    const totalSellers = sellers.length;
    const superheroLimit = Math.floor(totalSellers * (percentiles.SUPERHERO || 0.15));
    const heroCount = Math.floor(totalSellers * (percentiles.HERO || 0.35));

    const superheroIds = new Set(sellers.slice(0, superheroLimit).map(p => p.id));
    const heroIds = new Set(sellers.slice(superheroLimit, superheroLimit + heroCount).map(p => p.id));

    products.forEach(p => {
      p.label = evaluateProductLabel(p, {
        superheroIds,
        heroIds,
        superheroName,
        heroName,
        sidekickName,
        antiHeroName,
        villainName,
        ghostName,
        permanentVillains,
        newVillains,
        isPercentile: true,
        evalMode: activeEvalMode,
        modeCfg
      });
    });
  } else {
    // STRICT Mode
    products.forEach(p => {
      p.label = evaluateProductLabel(p, {
        superheroName,
        heroName,
        sidekickName,
        antiHeroName,
        villainName,
        ghostName,
        permanentVillains,
        newVillains,
        isPercentile: false,
        evalMode: activeEvalMode,
        modeCfg
      });
    });
  }
}

/**
 * Determines a single product's label based on its performance metrics and mode.
 */
function evaluateProductLabel(p, context) {
  const {
    superheroIds,
    heroIds,
    superheroName,
    heroName,
    sidekickName,
    antiHeroName,
    villainName,
    ghostName,
    permanentVillains,
    newVillains,
    isPercentile,
    evalMode,
    modeCfg
  } = context;

  const activeEvalMode = evalMode || 'ROAS';
  const activeModeCfg = modeCfg || getActiveModeConfig(activeEvalMode);
  const useRoasForSellers = (activeEvalMode === 'ROAS' || activeEvalMode === 'HYBRID_MARGIN');
  const useMarginsForVillains = (activeEvalMode !== 'ROAS');

  // 1. Permanent Villain check
  const isPermanentVillain = permanentVillains.has(p.id) || permanentVillains.has(p.id.toUpperCase());
  if (isPermanentVillain) {
    return villainName;
  }

  const minSalesForCpa = (CONFIG.GENERAL && CONFIG.GENERAL.MIN_SALES_FOR_CPA !== undefined)
    ? CONFIG.GENERAL.MIN_SALES_FOR_CPA
    : 0.5;
  const heroMinSales = (activeModeCfg.HERO && activeModeCfg.HERO.min_sales !== undefined)
    ? activeModeCfg.HERO.min_sales
    : 1;

  // 2. Evaluate Profitability for all products meeting the sales threshold (sales >= minSalesForCpa)
  if (p.sales >= minSalesForCpa) {
    const roas = p.cost > 0 ? (p.revenue / p.cost) : 0;

    if (isProductUnprofitable(p, activeEvalMode, activeModeCfg)) {
      return antiHeroName;
    }

    // 2.1 Profitable products with sales >= heroMinSales evaluate for Hero / Superhero tiers
    const superheroMinRoas = (activeModeCfg.SUPERHERO && activeModeCfg.SUPERHERO.min_roas !== undefined)
      ? activeModeCfg.SUPERHERO.min_roas
      : null;
    const heroMinRoas = (activeModeCfg.HERO && activeModeCfg.HERO.min_roas !== undefined)
      ? activeModeCfg.HERO.min_roas
      : null;
    const { heroMaxCpaRatio, superheroMaxCpaRatio } = getCpaToMarginThresholds(activeModeCfg);
    const roasSafeguard = activeModeCfg.ANTI_HERO && activeModeCfg.ANTI_HERO.roas_safeguard;
    const isSafeguarded = Boolean(!useRoasForSellers && roasSafeguard && roas >= roasSafeguard);

    if (p.sales >= heroMinSales) {
      if (isPercentile) {
        if (superheroIds.has(p.id)) {
          if (useRoasForSellers && superheroMinRoas !== null && roas < superheroMinRoas) {
            return (heroMinRoas !== null && roas < heroMinRoas) ? antiHeroName : heroName;
          }
          if (!useRoasForSellers && p.grossProfit > 0 && p.cpa > (p.grossProfit * superheroMaxCpaRatio)) {
            return (p.cpa > (p.grossProfit * heroMaxCpaRatio) && !isSafeguarded) ? antiHeroName : heroName;
          }
          return superheroName;
        }
        if (useRoasForSellers && heroMinRoas !== null && roas < heroMinRoas) {
          return antiHeroName;
        }
        if (!useRoasForSellers && p.grossProfit > 0 && p.cpa > (p.grossProfit * heroMaxCpaRatio) && !isSafeguarded) {
          return antiHeroName;
        }
        if (heroIds.has(p.id)) {
          return heroName;
        }
        return sidekickName;
      } else {
        // STRICT Logic
        const superheroMinSales = (activeModeCfg.SUPERHERO && activeModeCfg.SUPERHERO.min_sales !== undefined)
          ? activeModeCfg.SUPERHERO.min_sales
          : 3;
        if (p.sales >= superheroMinSales) {
          if (useRoasForSellers && superheroMinRoas !== null && roas < superheroMinRoas) {
            return (heroMinRoas !== null && roas < heroMinRoas) ? antiHeroName : heroName;
          }
          if (!useRoasForSellers && p.grossProfit > 0 && p.cpa > (p.grossProfit * superheroMaxCpaRatio)) {
            return (p.cpa > (p.grossProfit * heroMaxCpaRatio) && !isSafeguarded) ? antiHeroName : heroName;
          }
          return superheroName;
        }
        if (useRoasForSellers && heroMinRoas !== null && roas < heroMinRoas) {
          return antiHeroName;
        }
        if (!useRoasForSellers && p.grossProfit > 0 && p.cpa > (p.grossProfit * heroMaxCpaRatio) && !isSafeguarded) {
          return antiHeroName;
        }
        if (p.sales >= heroMinSales) {
          return heroName;
        }
        return sidekickName;
      }
    }

    // Sellers below heroMinSales must still meet Hero profitability thresholds to remain Sidekicks
    if (useRoasForSellers && heroMinRoas !== null && roas < heroMinRoas) {
      return antiHeroName;
    }
    if (!useRoasForSellers && p.grossProfit > 0 && p.cpa > (p.grossProfit * heroMaxCpaRatio) && !isSafeguarded) {
      return antiHeroName;
    }

    // Profitable products that have not yet reached heroMinSales remain safe Sidekicks
    return sidekickName;
  }

  // 3. Products with 0 (or low fractional) sales: evaluate for Villain or Ghost
  // Products below minSalesForCpa are evaluated against 0-sale spend limits.
  let exceedsSpendLimit = false;

  if (useMarginsForVillains) {
    if (p.grossProfit > 0) {
      const maxCostToMarginRatio = (activeModeCfg.VILLAIN && activeModeCfg.VILLAIN.max_cost_to_margin_ratio !== undefined)
        ? activeModeCfg.VILLAIN.max_cost_to_margin_ratio
        : 0.40;
      const maxSpend = p.grossProfit * maxCostToMarginRatio;
      exceedsSpendLimit = p.cost > maxSpend;
    } else {
      const fallbackMaxSpend = (activeModeCfg.VILLAIN && activeModeCfg.VILLAIN.fallback_max_spend !== undefined)
        ? activeModeCfg.VILLAIN.fallback_max_spend
        : 50.0;
      exceedsSpendLimit = fallbackMaxSpend > 0 && p.cost > fallbackMaxSpend;
    }
  } else {
    // 'ROAS' mode: evaluate flat spend limit
    const maxSpend = (activeModeCfg.VILLAIN && activeModeCfg.VILLAIN.max_spend !== undefined)
      ? activeModeCfg.VILLAIN.max_spend
      : 50.0;
    exceedsSpendLimit = maxSpend > 0 && p.cost > maxSpend;
  }

  if (exceedsSpendLimit) {
    if (!isPermanentVillain) newVillains.push(p.id);
    return villainName;
  }

  // 4. Ghost check: 0 sales, 0 clicks, and impressions below visibility threshold
  const ghostMaxImpressions = (activeModeCfg.GHOST && activeModeCfg.GHOST.max_impressions !== undefined)
    ? activeModeCfg.GHOST.max_impressions
    : 30;
  if (p.clicks === 0 && p.impressions <= ghostMaxImpressions) {
    return ghostName;
  }

  return sidekickName;
}

/**
 * Formats a historical date in YYYY-MM-DD.
 */
function getFormattedDate(daysAgo) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd'); 
}

/**
 * Reads product margins from the configured spreadsheet.
 */
function getMarginData(logs) {
  const marginMap = new Map();
  const sheetConfig = CONSTANTS.MARGIN_SHEET;
  const url = sheetConfig ? sheetConfig.URL : null;
  const tabName = sheetConfig ? sheetConfig.TAB_NAME : 'Products';
  
  if (!url || url.indexOf('REPLACE_WITH') !== -1 || url.indexOf('YOUR_SPREADSHEET_URL') !== -1) {
    const infoMsg = 'NOTICE: Margin sheet URL is not configured. Running with fallback ROAS and spend limits.';
    Logger.log(infoMsg);
    if (logs) logs.push([new Date(), 'INFO', infoMsg]);
    return marginMap;
  }

  try {
    const ss = SpreadsheetApp.openByUrl(url);
    const sheet = getSheetFromUrlOrName(ss, url, tabName);
    if (!sheet) {
      const warnMsg = `WARNING: Tab "${tabName}" not found in margin sheet. Running with fallback limits.`;
      Logger.log(warnMsg);
      if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
      return marginMap;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return marginMap;

    const headers = data[0];
    const cols = sheetConfig.COLUMNS || {};
    const idCol = findColumnIndex(headers, cols.ID || 'id');
    const marginColName = cols.MARGIN || cols.NET_MARGIN;
    const marginCol = marginColName ? findColumnIndex(headers, marginColName) : -1;
    const priceCol = (cols.PRICE && String(cols.PRICE).trim()) ? findColumnIndex(headers, cols.PRICE) : -1;
    const cogsCol = (cols.COGS && String(cols.COGS).trim()) ? findColumnIndex(headers, cols.COGS) : -1;

    const hasPriceAndCogs = Boolean(priceCol !== -1 && cogsCol !== -1);
    marginMap.hasPriceCol = Boolean(priceCol !== -1);
    marginMap.hasPriceAndCogs = hasPriceAndCogs;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      let id = String(row[idCol]).toUpperCase().trim();
      if (!id) continue;
      if (id.endsWith('.0')) id = id.substring(0, id.length - 2);

      const price = priceCol !== -1 ? (parseNumericValue(row[priceCol]) || 0) : 0;
      const cogs = cogsCol !== -1 ? (parseNumericValue(row[cogsCol]) || 0) : 0;
      let margin = null;

      // 1. Direct Margin Column (preferred)
      if (marginCol !== -1) {
        const val = parseNumericValue(row[marginCol]);
        if (val !== null) margin = val;
      }

      // 2. Fallback calculation if MARGIN column is absent or empty: price - cogs
      if (margin === null && hasPriceAndCogs) {
        if (price > 0 && cogs >= 0) {
          margin = price - cogs;
        }
      }

      marginMap.set(id, { price, cogs, margin });
    }
    const infoMsg = `Loaded margin data for ${marginMap.size} products from sheet.`;
    Logger.log(infoMsg);
    if (logs) logs.push([new Date(), 'INFO', infoMsg]);
  } catch (e) {
    const warnMsg = `WARNING: Failed to fetch margin data (${e.message}). Running with fallback limits.`;
    Logger.log(warnMsg);
    if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
  }
  return marginMap;
}

/**
 * Reads permanent villains list from the spreadsheet.
 */
function getPermanentVillains(logs) {
  const villainSet = new Set();
  const sheetConfig = CONSTANTS.PERMANENT_VILLAINS_SHEET;
  const url = sheetConfig ? sheetConfig.URL : null;
  const tabName = sheetConfig ? sheetConfig.TAB_NAME : 'Villains';
  const idColName = (sheetConfig && sheetConfig.COLUMNS) ? sheetConfig.COLUMNS.ID : 'id';

  if (!url || url.indexOf('REPLACE_WITH') !== -1 || url.indexOf('YOUR_SPREADSHEET_URL') !== -1) {
    const warnMsg = 'WARNING: Permanent villains sheet URL is not configured. Skipping permanent villains.';
    Logger.log(warnMsg);
    if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
    return villainSet;
  }

  try {
    const ss = SpreadsheetApp.openByUrl(url);
    const sheet = getSheetFromUrlOrName(ss, url, tabName);
    if (!sheet) {
      const warnMsg = `WARNING: Tab "${tabName}" not found in permanent villains sheet. Skipping permanent villains.`;
      Logger.log(warnMsg);
      if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
      return villainSet;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return villainSet;

    const headers = data[0];
    const idCol = findColumnIndex(headers, idColName);
    if (idCol === -1) {
      const warnMsg = `WARNING: Column "${idColName}" not found in permanent villains sheet. Skipping permanent villains.`;
      Logger.log(warnMsg);
      if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
      return villainSet;
    }

    for (let i = 1; i < data.length; i++) {
      let id = String(data[i][idCol]).toUpperCase().trim();
      if (id.endsWith('.0')) id = id.substring(0, id.length - 2);
      if (id) villainSet.add(id);
    }

    const msg = `Loaded ${villainSet.size} permanent villains from sheet.`;
    Logger.log(msg);
    if (logs) logs.push([new Date(), 'INFO', msg]);
  } catch (e) {
    const warnMsg = `WARNING: Failed to fetch permanent villains (${e.message}). Skipping permanent villains.`;
    Logger.log(warnMsg);
    if (logs) logs.push([new Date(), 'WARNING', warnMsg]);
  }
  return villainSet;
}

/**
 * Appends new villains to the permanent villains sheet.
 */
function appendNewVillains(newVillains, logs) {
  const sheetConfig = CONSTANTS.PERMANENT_VILLAINS_SHEET;
  const url = sheetConfig ? sheetConfig.URL : null;
  const tabName = sheetConfig ? sheetConfig.TAB_NAME : 'Villains';
  const idColName = (sheetConfig && sheetConfig.COLUMNS) ? sheetConfig.COLUMNS.ID : 'id';
  const labelColName = (sheetConfig && sheetConfig.COLUMNS) ? sheetConfig.COLUMNS.LABEL : 'custom_label_0';

  const uniqueVillains = [...new Set(newVillains)];
  if (!url || url.indexOf('REPLACE_WITH') !== -1 || url.indexOf('YOUR_SPREADSHEET_URL') !== -1 || uniqueVillains.length === 0) return;

  try {
    const ss = SpreadsheetApp.openByUrl(url);
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
      sheet.appendRow([idColName, labelColName]);
      sheet.getRange('A1:B1').setFontWeight('bold');
    }

    const defaultLabel = CONFIG.LABELS.VILLAIN.name || 'villain';
    const rows = uniqueVillains.map(id => [id, defaultLabel]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 2).setValues(rows);

    const msg = `Successfully added ${rows.length} new villains to the permanent list.`;
    Logger.log(msg);
    if (logs) logs.push([new Date(), 'INFO', msg]);
  } catch (e) {
    const errMsg = `ERROR appending new villains: ${e.message}`;
    Logger.log(errMsg);
    if (logs) logs.push([new Date(), 'ERROR', errMsg]);
  }
}

/**
 * Matches product IDs robustly between Google Ads and margin maps.
 */
function getMarginsForId(marginMap, id) {
  if (!id) return null;
  const cleanId = String(id).trim().toUpperCase();
  if (marginMap.has(cleanId)) return marginMap.get(cleanId);

  if (cleanId.endsWith('.0')) {
    const noDot = cleanId.substring(0, cleanId.length - 2);
    if (marginMap.has(noDot)) return marginMap.get(noDot);
  }

  const withDot = cleanId + '.0';
  if (marginMap.has(withDot)) return marginMap.get(withDot);

  if (cleanId.indexOf(':') !== -1) {
    const lastPart = cleanId.split(':').pop().trim();
    if (marginMap.has(lastPart)) return marginMap.get(lastPart);
  }

  if (cleanId.indexOf('_') !== -1) {
    const lastPart = cleanId.split('_').pop().trim();
    if (marginMap.has(lastPart)) return marginMap.get(lastPart);
  }

  return null;
}

/**
 * Resolves a sheet tab by GID or Tab Name.
 */
function getSheetFromUrlOrName(ss, url, defaultTabName) {
  if (!ss) return null;
  let gid = null;
  if (url) {
    const match = url.match(/[#&]gid=([0-9]+)/);
    if (match) gid = Number(match[1]);
  }
  
  if (gid !== null) {
    const sheets = ss.getSheets();
    for (let i = 0; i < sheets.length; i++) {
      if (sheets[i].getSheetId() === gid) return sheets[i];
    }
  }
  
  if (defaultTabName) {
    const sheet = ss.getSheetByName(defaultTabName);
    if (sheet) return sheet;
  }
  
  return ss.getSheets()[0] || null;
}

/**
 * Safely parses numbers from sheet cells, handling currency symbols, commas, thousand separators, and percentage strings.
 */
function parseNumericValue(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  let cleanStr = String(val).replace(/[$€£%\s]/g, '');
  if (cleanStr.indexOf(',') !== -1 && cleanStr.indexOf('.') !== -1) {
    if (cleanStr.lastIndexOf(',') > cleanStr.lastIndexOf('.')) {
      // European format: 1.250,50 -> 1250.50
      cleanStr = cleanStr.replace(/\./g, '').replace(',', '.');
    } else {
      // US/UK format: 1,250.50 -> 1250.50
      cleanStr = cleanStr.replace(/,/g, '');
    }
  } else if (cleanStr.indexOf(',') !== -1) {
    // Check if comma is a thousand separator (e.g., "1,250" or "1,000,000") vs decimal (e.g., "25,5" or "25,50")
    const parts = cleanStr.split(',');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1)) {
      cleanStr = cleanStr.replace(/,/g, '');
    } else {
      cleanStr = cleanStr.replace(',', '.');
    }
  }
  const num = parseFloat(cleanStr);
  return isNaN(num) ? null : num;
}

/**
 * Helper to match column indices case-insensitively.
 */
function findColumnIndex(headers, colName) {
  if (!colName) return -1;
  const target = String(colName).trim().toLowerCase();
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim().toLowerCase() === target) return i;
  }
  return -1;
}

/**
 * Writes logs to the logs tab in the output spreadsheet.
 */
function writeLogsToSheet(logs) {
  if (!logs || logs.length === 0) return;
  try {
    const ss = SpreadsheetApp.openByUrl(CONSTANTS.OUTPUT_SHEET.URL);
    let sheet = ss.getSheetByName(CONSTANTS.OUTPUT_SHEET.LOGS_TAB_NAME);
    if (!sheet) {
      sheet = ss.insertSheet(CONSTANTS.OUTPUT_SHEET.LOGS_TAB_NAME);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Level', 'Message']);
      sheet.getRange('A1:C1').setFontWeight('bold');
    }
    sheet.getRange(sheet.getLastRow() + 1, 1, logs.length, 3).setValues(logs);
  } catch (e) {
    Logger.log(`ERROR writing logs: ${e.message}`);
  }
}

/**
 * Writes summary distribution to the Overview tab.
 */
function writeOverviewSheet(ss, products, isDryRun) {
  try {
    const tabName = isDryRun ? `${CONSTANTS.OUTPUT_SHEET.OVERVIEW_TAB_NAME} - Dry Run` : CONSTANTS.OUTPUT_SHEET.OVERVIEW_TAB_NAME;
    let sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      sheet = ss.insertSheet(tabName);
    } else {
      sheet.clear();
      const charts = sheet.getCharts();
      for (let i = 0; i < charts.length; i++) {
        sheet.removeChart(charts[i]);
      }
    }

    const labelData = {};
    let totalCount = 0;
    let totalSalesAll = 0;
    let totalCostAll = 0;
    let totalRevenueAll = 0;

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const sales = p.sales || 0;
      const cost = p.cost || 0;
      const label = p.label || 'Unlabeled'; 
      const revenue = p.revenue || 0; 

      if (!labelData[label]) {
        labelData[label] = { count: 0, sales: 0, cost: 0, revenue: 0 };
      }
      labelData[label].count += 1;
      labelData[label].sales += sales;
      labelData[label].cost += cost;
      labelData[label].revenue += revenue;

      totalCount += 1;
      totalSalesAll += sales;
      totalCostAll += cost;
      totalRevenueAll += revenue;
    }

    const tableData = [[
      'Label',
      'Product Count',
      'Count % of Total',
      'Total Sales',
      'Sales % of Total',
      'Total Cost',
      'Cost % of Total',
      'Total Revenue',
      'Rev % of Total',
      'ROAS'
    ]];

    for (const label in labelData) {
      const count = labelData[label].count;
      const sales = Math.round(labelData[label].sales * 100) / 100;
      const cost = Math.round(labelData[label].cost * 100) / 100;
      const revenue = Math.round(labelData[label].revenue * 100) / 100;
      const roas = cost > 0 ? Math.round((revenue / cost) * 100) / 100 : 0;

      const countPct = totalCount > 0 ? (count / totalCount) : 0;
      const salesPct = totalSalesAll > 0 ? (labelData[label].sales / totalSalesAll) : 0;
      const costPct = totalCostAll > 0 ? (labelData[label].cost / totalCostAll) : 0;
      const revPct = totalRevenueAll > 0 ? (labelData[label].revenue / totalRevenueAll) : 0;

      tableData.push([
        label,
        count,
        countPct,
        sales,
        salesPct,
        cost,
        costPct,
        revenue,
        revPct,
        roas
      ]);
    }

    const header = tableData.shift();
    tableData.sort((a, b) => b[1] - a[1]);
    tableData.unshift(header);

    if (tableData.length > 1) {
      const numRows = tableData.length;
      const numCols = tableData[0].length;
      const dataRows = numRows - 1;

      sheet.getRange(1, 1, numRows, numCols).setValues(tableData);
      sheet.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#f3f3f3');

      // Format number columns
      sheet.getRange(2, 2, dataRows, 1).setNumberFormat('#,##0');
      sheet.getRange(2, 3, dataRows, 1).setNumberFormat('0.0%');
      sheet.getRange(2, 4, dataRows, 1).setNumberFormat('0.00');
      sheet.getRange(2, 5, dataRows, 1).setNumberFormat('0.0%');
      sheet.getRange(2, 6, dataRows, 1).setNumberFormat('0.00');
      sheet.getRange(2, 7, dataRows, 1).setNumberFormat('0.0%');
      sheet.getRange(2, 8, dataRows, 1).setNumberFormat('0.00');
      sheet.getRange(2, 9, dataRows, 1).setNumberFormat('0.0%');
      sheet.getRange(2, 10, dataRows, 1).setNumberFormat('0.00');

      sheet.autoResizeColumns(1, numCols);

      const chartRange = sheet.getRange(1, 1, numRows, 2);
      const chart = sheet.newChart().asPieChart().addRange(chartRange)
        .setOption('title', 'Product Distribution by Label')
        .setOption('pieHole', 0.4)
        .setOption('legend', {position: 'right'})
        .setPosition(1, numCols + 2, 0, 0)
        .build();
      sheet.insertChart(chart);
    }    
  } catch (e) {
    Logger.log(`ERROR generating overview sheet: ${e.message}`);
  }
}

/**
 * Logs historical label trends.
 */
function writeLabelTrendsSheet(ss, products, isDryRun) {
  try {
    let sheet = ss.getSheetByName(CONSTANTS.OUTPUT_SHEET.TRENDS_TAB_NAME);
    const labelKeys = Object.keys(CONFIG.LABELS); 
    const labels = labelKeys.map(key => CONFIG.LABELS[key].name).filter(name => !!name); 

    if (!sheet) {
      sheet = ss.insertSheet(CONSTANTS.OUTPUT_SHEET.TRENDS_TAB_NAME);
    }

    // Always keep row 1 headers in sync with current configured label names
    const headers = ['Date'].concat(labels).concat(['Mode', 'Dry run']);
    const currentLastCol = sheet.getLastColumn();
    if (currentLastCol > headers.length) {
      sheet.getRange(1, headers.length + 1, 1, currentLastCol - headers.length).clearContent();
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    const counts = {};
    labels.forEach(l => counts[l] = 0); 
    for (let i = 0; i < products.length; i++) {
      const label = products[i].label;
      if (counts[label] !== undefined) {
        counts[label]++;
      }
    }

    const tz = ss.getSpreadsheetTimeZone();
    const todayStr = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
    const newRow = [todayStr];
    for (let i = 1; i < headers.length; i++) {
      const header = headers[i];
      if (header === 'Mode') {
        newRow.push(CONSTANTS.DISTRIBUTION_MODE || 'STRICT');
      } else if (header === 'Dry run') {
        newRow.push(isDryRun);
      } else if (counts[header] !== undefined) {
        newRow.push(counts[header]);
      } else {
        newRow.push('');
      }
    }

    sheet.appendRow(newRow);
    sheet.autoResizeColumns(1, headers.length);
  } catch (e) {
    Logger.log(`ERROR generating trends sheet: ${e.message}`);
  }
}

/**
 * Ensures output spreadsheet tabs exist and are positioned in the desired order:
 * 1. OUTPUT_SHEET.TAB_NAME
 * 2. OVERVIEW_TAB_NAME
 * 3. LOGS_TAB_NAME
 * Followed by dry run tabs if dry run mode is active:
 * 4. OUTPUT_SHEET.TAB_NAME - Dry Run
 * 5. OVERVIEW_TAB_NAME - Dry Run
 * Any other existing tabs remain after these.
 *
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {boolean} isDryRun
 */
function ensureTabOrder(ss, isDryRun) {
  try {
    const tabsToOrder = [
      CONSTANTS.OUTPUT_SHEET.TAB_NAME,
      CONSTANTS.OUTPUT_SHEET.OVERVIEW_TAB_NAME,
      CONSTANTS.OUTPUT_SHEET.LOGS_TAB_NAME
    ];

    if (isDryRun) {
      tabsToOrder.push(`${CONSTANTS.OUTPUT_SHEET.TAB_NAME} - Dry Run`);
      tabsToOrder.push(`${CONSTANTS.OUTPUT_SHEET.OVERVIEW_TAB_NAME} - Dry Run`);
    }

    tabsToOrder.forEach((tabName, index) => {
      let sheet = ss.getSheetByName(tabName);
      const targetPos = index + 1; // 1-based index for moveActiveSheet
      if (!sheet) {
        const numSheets = ss.getNumSheets();
        const insertIndex = Math.min(index, numSheets);
        sheet = ss.insertSheet(tabName, insertIndex);
      }
      if (sheet && sheet.getIndex() !== targetPos) {
        ss.setActiveSheet(sheet);
        ss.moveActiveSheet(targetPos);
      }
    });

    const activeTabName = isDryRun
      ? `${CONSTANTS.OUTPUT_SHEET.TAB_NAME} - Dry Run`
      : CONSTANTS.OUTPUT_SHEET.TAB_NAME;
    const activeSheet = ss.getSheetByName(activeTabName);
    if (activeSheet) {
      ss.setActiveSheet(activeSheet);
    }
  } catch (e) {
    Logger.log(`WARNING: Failed to enforce tab order: ${e.message}`);
  }
}

