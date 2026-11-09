// Config.gs
// Frequently adjusted optimization variables and toggles

const CONFIG = {
  // ==========================================
  // 1. GENERAL CONFIGURATION (Applies to all modes)
  // ==========================================
  GENERAL: {
    // When true, creates separate tabs in the output sheet for debugging. No other connected sheets are populated
    DRY_RUN: false,
    
    // Lookback window for shopping performance metrics (in days)
    DAYS_BACK: 90,

    // Optional: Number of recent days to exclude from the lookback window to account for conversion lag.
    // e.g., 7 excludes the last 7 days (lookback window ends 8 days ago instead of yesterday).
    // Set to 0 or null to evaluate performance through yesterday.
    DAYS_BACK_OFFSET: 0,

    // Minimum attributed conversions required to calculate CPA and evaluate as a Seller.
    // Conversions below this threshold are treated as 0 sales for profitability checks.
    // For fractional sales between MIN_SALES_FOR_CPA and 1.0, CPA is calculated assuming 1 sale
    // (i.e. CPA = Cost) to prevent artificial run-rate inflation.
    MIN_SALES_FOR_CPA: 0.5
  },

  // ==========================================
  // 2. LABEL NAMES (Applies to all modes)
  // Setting a label's `name` to an empty string ('') disables it.
  // Disabled labels cascade to the next logical tier.
  // ==========================================
  LABELS: {
    SUPERHERO: {
      name: 'superhero',
      desc: 'Top performing, highly profitable products with strong sales.'
    },
    HERO: {
      name: 'hero',
      desc: 'Consistent performers with healthy margins/profitability.'
    },
    SIDEKICK: {
      name: 'sidekick',
      desc: 'Products being tested, low volume, or low fractional assists (< min_sales).'
    },
    ANTI_HERO: {
      name: 'anti_hero',
      desc: 'Products with sales that are losing money or have unprofitable CPA/ROAS.'
    },
    VILLAIN: {
      name: 'villain',
      desc: 'Products with zero sales that exceed the allowable spend threshold.'
    },
    GHOST: {
      name: 'ghost',
      desc: 'Products with zero sales, zero clicks, and impressions below the visibility threshold.'
    }
  },

  // ==========================================
  // 3. MODE-SPECIFIC CONFIGURATION
  // Only configure the block matching CONSTANTS.EVALUATION_MODE in Const.gs.
  // ==========================================
  MODES: {
    // ------------------------------------------
    // Mode 1: Pure ROAS evaluation
    // ------------------------------------------
    ROAS: {
      SUPERHERO: {
        min_sales: 2,   // Minimum attributed conversions required to qualify as a Superhero (in STRICT mode)
        min_roas: 1.20  // Minimum ROAS (Conv. Value / Cost) required to qualify as a Superhero
      },
      HERO: {
        min_sales: 0.75, // Minimum attributed conversions required to qualify as a Hero (or enter the HYBRID ranking pool)
        min_roas: 1.25   // Minimum ROAS required to be profitable. Sellers below both Hero & Superhero min_roas become Anti-Heroes
      },
      VILLAIN: {
        max_spend: 50.0  // Maximum allowable ad spend ($) for 0-sale products (< MIN_SALES_FOR_CPA) before becoming a Villain
      },
      GHOST: {
        max_impressions: 30 // Maximum impressions for 0-sale, 0-click products to be labeled as a low-visibility Ghost
      }
    },

    // ------------------------------------------
    // Mode 2: Global flat margin rate + live Google Ads product prices
    // ------------------------------------------
    FLAT_MARGIN: {
      DEFAULT_MARGIN_RATE: 0.40, // Global profit margin rate applied to live product prices (e.g., 0.40 = 40% gross margin)
      SUPERHERO: {
        min_sales: 2,                  // Minimum attributed conversions required to qualify as a Superhero (in STRICT mode)
        max_cpa_to_margin_ratio: 1.20  // Maximum allowable CPA as a multiple of unit margin (e.g., 1.20 = CPA up to 120% of unit profit)
      },
      HERO: {
        min_sales: 0.75,               // Minimum attributed conversions required to qualify as a Hero (or enter the HYBRID ranking pool)
        max_cpa_to_margin_ratio: 1.00  // Maximum allowable CPA as a multiple of unit margin (e.g., 1.00 = break-even; higher CPA becomes Anti-Hero)
      },
      ANTI_HERO: {
        roas_safeguard: 2.0,   // Cross-sell / basket safeguard: Sellers with ROAS >= this are protected from becoming Anti-Heroes
        fallback_min_roas: 1.0 // Fallback minimum ROAS threshold if live product price is unavailable from Google Ads
      },
      VILLAIN: {
        max_cost_to_margin_ratio: 0.40, // Max allowable 0-sale ad spend as a ratio of unit margin (e.g., 0.40 = 40% of one unit's profit)
        fallback_max_spend: 50.0        // Fallback max 0-sale ad spend ($) if live product price is unavailable from Google Ads
      },
      GHOST: {
        max_impressions: 30 // Maximum impressions for 0-sale, 0-click products to be labeled as a low-visibility Ghost
      }
    },

    // ------------------------------------------
    // Mode 3: Per-product margins from MARGIN_SHEET in Const.gs
    // ------------------------------------------
    VARIABLE_MARGIN: {
      DEFAULT_MARGIN_RATE: null, // Optional fallback margin rate (e.g., 0.40) applied via live price if a product is missing from MARGIN_SHEET
      SUPERHERO: {
        min_sales: 2,                  // Minimum attributed conversions required to qualify as a Superhero (in STRICT mode)
        max_cpa_to_margin_ratio: 1.20  // Maximum allowable CPA as a multiple of unit margin (e.g., 1.20 = CPA up to 120% of unit profit)
      },
      HERO: {
        min_sales: 0.75,               // Minimum attributed conversions required to qualify as a Hero (or enter the HYBRID ranking pool)
        max_cpa_to_margin_ratio: 1.00  // Maximum allowable CPA as a multiple of unit margin (e.g., 1.00 = break-even; higher CPA becomes Anti-Hero)
      },
      ANTI_HERO: {
        roas_safeguard: 2.0,   // Cross-sell / basket safeguard: Sellers with ROAS >= this are protected from becoming Anti-Heroes
        fallback_min_roas: 1.0 // Fallback minimum ROAS used when a product is missing from MARGIN_SHEET and DEFAULT_MARGIN_RATE is null
      },
      VILLAIN: {
        max_cost_to_margin_ratio: 0.40, // Max allowable 0-sale ad spend as a ratio of unit margin (e.g., 0.40 = 40% of one unit's profit)
        fallback_max_spend: 50.0        // Fallback max 0-sale ad spend ($) when a product is missing from MARGIN_SHEET and DEFAULT_MARGIN_RATE is null
      },
      GHOST: {
        max_impressions: 30 // Maximum impressions for 0-sale, 0-click products to be labeled as a low-visibility Ghost
      }
    },

    // ------------------------------------------
    // Mode 4: Evaluates Sellers by ROAS, but uses Margin data (Sheet or DEFAULT_MARGIN_RATE) to cap 0-sale Villain spend
    // ------------------------------------------
    HYBRID_MARGIN: {
      DEFAULT_MARGIN_RATE: null, // Optional flat margin rate (e.g., 0.40) when not using MARGIN_SHEET, or as a fallback for missing products
      SUPERHERO: {
        min_sales: 2,   // Minimum attributed conversions required to qualify as a Superhero (in STRICT mode)
        min_roas: 1.20  // Minimum ROAS (Conv. Value / Cost) required to qualify as a Superhero
      },
      HERO: {
        min_sales: 0.75, // Minimum attributed conversions required to qualify as a Hero (or enter the HYBRID ranking pool)
        min_roas: 1.25   // Minimum ROAS required to be profitable. Sellers below both Hero & Superhero min_roas become Anti-Heroes
      },
      VILLAIN: {
        max_cost_to_margin_ratio: 0.40, // Max allowable 0-sale ad spend as a ratio of unit margin (e.g., 0.40 = 40% of one unit's profit)
        fallback_max_spend: 50.0        // Fallback max 0-sale ad spend ($) when margin data is unavailable for a product
      },
      GHOST: {
        max_impressions: 30 // Maximum impressions for 0-sale, 0-click products to be labeled as a low-visibility Ghost
      }
    }
  }
};
