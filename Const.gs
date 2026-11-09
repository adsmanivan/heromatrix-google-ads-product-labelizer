// Const.gs
// "Set it and forget it" installation variables

const CONSTANTS = {
  // ==========================================
  // 1. ARCHITECTURE & DISTRIBUTION SETTINGS
  // ==========================================

  // Choose how product profitability and spend limits are evaluated:
  // - 'ROAS'            -> Pure ROAS mode. Uses Google Ads revenue & cost only (No margin sheet or flat margin needed).
  // - 'FLAT_MARGIN'     -> Uses DEFAULT_MARGIN_RATE in Config.gs + live product prices from Google Ads (No sheet needed).
  // - 'VARIABLE_MARGIN' -> Uses per-product margins from MARGIN_SHEET below.
  // - 'HYBRID_MARGIN'   -> Evaluates Sellers by ROAS, but uses Margin data (Sheet or DEFAULT_MARGIN_RATE) to cap 0-sale Villain spend.
  EVALUATION_MODE: 'ROAS',

  // Distribution mode for profitable Sellers (Superhero / Hero):
  // - 'STRICT'     -> Assigns tiers strictly by the volume thresholds (min_sales) in Config.gs.
  // - 'PERCENTILE' -> Ranks all profitable Sellers (sales >= MIN_SALES_FOR_CPA) by Net Profit and assigns top % to Superhero/Hero.
  // - 'HYBRID'     -> Filters profitable Sellers by HERO.min_sales first, then ranks qualifiers by Net Profit using PERCENTILES.
  DISTRIBUTION_MODE: 'STRICT',

  // Percentile distribution thresholds (applicable when DISTRIBUTION_MODE is 'PERCENTILE' or 'HYBRID')
  // Values represent top percentages of profitable Sellers ranked by Net Profit (e.g., 0.15 = top 15%)
  PERCENTILES: {
    SUPERHERO: 0.15,
    HERO: 0.35
  },

  // Optional: Filter sales (conversions) and revenue (conversions_value) by a specific Conversion Action ID.
  // Accepts a numeric ID (e.g. '123456789').
  // If null, '', or undefined, falls back to default account-level conversions.
  CONVERSION_ACTION_ID: null,

  // Optional regex replacement to clean or reformat product IDs written to the output sheet.
  // REPLACEMENT supports either a string or a JavaScript callback function. Because the script passes
  // these values directly into JavaScript's native String.prototype.replace(), you can transform ID
  // characters dynamically at runtime rather than swapping them with fixed text.
  // Example to uppercase product IDs:
  //   PATTERN: /[a-z]/g,
  //   REPLACEMENT: (match) => match.toUpperCase()
  PRODUCT_ID_REPLACE: {
    PATTERN: null, // e.g. /^SHOPIFY_US_/i, /[a-z]/g, or null
    REPLACEMENT: '' // e.g. 'shopify_US_', '', or (match) => match.toUpperCase()
  },

  // ==========================================
  // 2. GOOGLE SHEETS CONFIGURATION
  // ==========================================
  
  // Main results spreadsheet where reports are written
  OUTPUT_SHEET: {
    URL: '',
    TAB_NAME: 'Products', 
    OVERVIEW_TAB_NAME: 'Overview', 
    TRENDS_TAB_NAME: 'Label Trends',
    ENABLE_TRENDS_LOG: true,        // When true, appends historical label distribution counts to TRENDS_TAB_NAME on each run
    LOGS_TAB_NAME: 'Logs', 
    LABEL_COLUMN: 'custom_label_3'
  },

  // Input Sheet for Product Margins (Used in 'VARIABLE_MARGIN' and optionally 'HYBRID_MARGIN')
  MARGIN_SHEET: {
    URL: '',
    TAB_NAME: 'Products',
    MARGIN_TYPE: 'ABSOLUTE',        // 'ABSOLUTE' ($ per unit, e.g. 25.00) or 'PERCENTAGE' (% of revenue, e.g. 25 or 0.25)
    COLUMNS: {
      ID: 'id',
      MARGIN: 'margin',             // Profit per unit ($ or %)
      PRICE: 'price',               // Optional: used to calculate PRICE - COGS if MARGIN is absent
      COGS: 'cost_of_goods_sold'    // Optional: used to calculate PRICE - COGS if MARGIN is absent
    }
  },

  // Permanent Villains Sheet (Supplemental Feed)
  PERMANENT_VILLAINS_SHEET: {
    USE_PERMANENT_LIST: true,       // When true, reads historical villains from this sheet and appends newly detected villains
    URL: '',
    TAB_NAME: 'Villains',
    COLUMNS: {
      ID: 'id',
      LABEL: 'custom_label_3'
    }
  }
};
