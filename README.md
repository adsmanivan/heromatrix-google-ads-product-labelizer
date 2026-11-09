# HeroMatrix: The Profit-First Product Labelizer

An enterprise Google Ads Script (JavaScript/GAS) that analyzes Shopping performance metrics, unit margins, and net profitability to automatically segment products into actionable custom label tiers.

Designed for high-scale Google Ads Shopping and Performance Max campaigns with support for 4 profit evaluation modes, dynamic seller distribution (`STRICT`, `PERCENTILE`, `HYBRID`), fractional conversion safeguards, historical trend logging, and permanent villain suppression.

🔗 **Official Script Page:** [https://www.awees.biz/scripts/heromatrix-labelizer/](https://www.awees.biz/scripts/heromatrix-labelizer/)  
📜 **Changelog & Version History:** [https://www.awees.biz/scripts/heromatrix-labelizer/changelog/](https://www.awees.biz/scripts/heromatrix-labelizer/changelog/)

---

## 🦸 Labeling Tiers Overview

**HeroMatrix** segments products using a 6-tier Superhero performance hierarchy. Any tier can be disabled by setting its `name` to `''` in `Config.gs`, which automatically cascades products to the next logical tier:

| Label | Theme | Qualification Criteria | Role & Strategy |
| :--- | :--- | :--- | :--- |
| **`SUPERHERO`** | ⚡ Top Performer | Top conversion volume & highest net profit (Top 15% or $\ge 	ext{SUPERHERO.min\_sales}$). | Anchor campaigns; allocate maximum target budget and priority. |
| **`HERO`** | 🦸 Consistent Winner | Strong, profitable conversion volume (Next 35% or $\ge 	ext{HERO.min\_sales}$). | Main volume driver; maintain steady aggressive targets. |
| **`SIDEKICK`** | 🤝 Testing & Pipeline | Low-spend non-sellers, profitable low-volume sellers ($< 	ext{HERO.min\_sales}$), or baseline test items. | Discovery/testing campaigns; nurture with controlled bids. |
| **`ANTI_HERO`** | 🥀 Unprofitable Seller | Made sales ($\ge 	ext{MIN\_SALES\_FOR\_CPA}$), but CPA exceeds unit margin limits or ROAS is below target. | Restrict bids or segment into a low-bid margin-recovery campaign. |
| **`VILLAIN`** | 🦹 High-Spend Bleeder | Zero or low-fractional conversions ($< 	ext{MIN\_SALES\_FOR\_CPA}$) exceeding allowable spend limits. | Exclude or bid down aggressively; optionally lock into the permanent villain list. |
| **`GHOST`** | 👻 Invisible / Cold | Zero sales, zero clicks, and impressions $\le 	ext{max\_impressions}$. | Push in a visibility/zombie campaign or diagnose feed/pricing issues. |

---

## 📊 Complete Evaluation Flowchart

```mermaid
flowchart TD
    Start([Google Ads Account]) --> Query[Query Shopping Performance View<br/>Lookback Window: DAYS_BACK + DAYS_BACK_OFFSET]
    Query --> CheckPerm{In Permanent<br/>Villains Sheet?}
    
    CheckPerm -- YES --> VillainPerm["🦹 VILLAIN<br/>(Frozen / Excluded from Sellers)"]
    
    CheckPerm -- NO --> CheckSales{Sales >= MIN_SALES_FOR_CPA?<br/>(Default: 0.50)}
    
    %% Sellers Path
    CheckSales -- YES (Sellers) --> CheckProfit{Unprofitable?<br/>ROAS / HYBRID_MARGIN: ROAS < min_roas<br/>FLAT / VARIABLE_MARGIN: CPA > Margin × max_cpa_to_margin_ratio<br/>Fallback: ROAS < fallback_min_roas}
    
    CheckProfit -- YES --> AntiHero["🥀 ANTI-HERO<br/>(Generates sales at a loss)"]
    
    CheckProfit -- NO (Profitable) --> GradCheck{Sales >= HERO.min_sales?<br/>(Default: 0.75)}
    
    GradCheck -- NO --> SidekickSeller["🤝 SIDEKICK<br/>(Profitable, low-volume seller)"]
    
    GradCheck -- YES --> ModeCheck{Distribution<br/>Mode?}
    
    ModeCheck -- STRICT --> StrictCheck{Sales & Tier Profit Check}
    StrictCheck -- "Sales >= SUPERHERO.min_sales & Meets Superhero Target" --> Superhero["⚡ SUPERHERO<br/>(Top Performer)"]
    StrictCheck -- "Sales >= HERO.min_sales & Meets Hero Target" --> Hero["🦸 HERO<br/>(Consistent Performer)"]
    StrictCheck -- Remainder --> SidekickSeller
    
    ModeCheck -- "PERCENTILE / HYBRID" --> RankCheck{Net Profit Rank<br/>Among Profitable Sellers}
    RankCheck -- Top 15% --> Superhero
    RankCheck -- Next 35% --> Hero
    RankCheck -- Remaining 50% --> SidekickSeller
    
    %% Non-Sellers Path
    CheckSales -- NO (Sales < MIN_SALES_FOR_CPA) --> CheckSpend{Cost > Spend Limit?<br/>Margin Modes: Cost > Margin × max_cost_to_margin_ratio<br/>ROAS Mode / Fallback: Cost > max_spend}
    
    CheckSpend -- YES --> VillainNew["🦹 VILLAIN<br/>(Appended to Permanent List)"]
    
    CheckSpend -- NO --> CheckGhost{Clicks == 0 AND<br/>Impressions <= max_impressions?}
    
    CheckGhost -- YES --> GhostCheck{Ghost Label<br/>Enabled?}
    GhostCheck -- YES --> Ghost["👻 GHOST<br/>(Invisible / Cold)"]
    GhostCheck -- NO --> Sidekick["🤝 SIDEKICK<br/>(Testing / Discovery Pipeline)"]
    
    CheckGhost -- NO --> Sidekick
```

---

## 🎛️ Choosing Your Evaluation Mode (`CONSTANTS.EVALUATION_MODE`)

In `Const.gs`, select how HeroMatrix evaluates profitability and spend limits using `EVALUATION_MODE`. Then, fine-tune the corresponding block under `CONFIG.MODES` in `Config.gs`:

| `EVALUATION_MODE` | Margin Data Source | How Converting Sellers Are Evaluated (`HERO` / `SUPERHERO` vs. `ANTI_HERO`) | How 0-Sale Bleeders Are Evaluated (`VILLAIN`) | Best For |
| :--- | :--- | :--- | :--- | :--- |
| **`'ROAS'`** | None (No Sheet) | $	ext{ROAS} < 	ext{min\_roas}$ | $	ext{Cost} > 	ext{VILLAIN.max\_spend}$ | Standard ROAS accounts, lead-gen catalogs, or setups without COGS/margin data. |
| **`'FLAT_MARGIN'`** ⭐ | `DEFAULT_MARGIN_RATE` + Live Catalog Prices (No Sheet) | $	ext{CPA} > (	ext{Unit Margin} 	imes 	ext{max\_cpa\_to\_margin\_ratio})$ | $	ext{Cost} > (	ext{Unit Margin} 	imes 	ext{max\_cost\_to\_margin\_ratio})$ | Retailers with a relatively uniform markup (e.g., 40% margin) who want price-scaled profit limits without maintaining a margin spreadsheet. |
| **`'VARIABLE_MARGIN'`** | `MARGIN_SHEET` in `Const.gs` | $	ext{CPA} > (	ext{Unit Margin} 	imes 	ext{max\_cpa\_to\_margin\_ratio})$ | $	ext{Cost} > (	ext{Unit Margin} 	imes 	ext{max\_cost\_to\_margin\_ratio})$ | Catalogs with varying per-product margins (`$` or `%` or `Price - COGS`) supplied via Google Sheets. |
| **`'HYBRID_MARGIN'`** | `MARGIN_SHEET` or `DEFAULT_MARGIN_RATE` | $	ext{ROAS} < 	ext{min\_roas}$ | $	ext{Cost} > (	ext{Unit Margin} 	imes 	ext{max\_cost\_to\_margin\_ratio})$ | Advertisers bidding to target ROAS on sellers who still want per-product unit margin protection against 0-sale bleeders. |

### Detailed Breakdown of the 4 Modes

#### 1. `'ROAS'` — Pure ROAS Mode (No Margin Data Required)
* **Setup:** Set `EVALUATION_MODE: 'ROAS'` in `Const.gs` and configure `CONFIG.MODES.ROAS` in `Config.gs`.
* **How it works:** Evaluates products strictly on Google Ads conversion value and cost. Skips reading `MARGIN_SHEET` for fast, zero-maintenance execution.
* **Sellers:** Flagged as `ANTI_HERO` if $	ext{ROAS}$ falls below `HERO.min_roas` / `SUPERHERO.min_roas`.
* **Non-Sellers / Bleeders:** Flagged as `VILLAIN` if $	ext{Cost} > 	ext{VILLAIN.max\_spend}$ (default `$50.00`).

#### 2. `'FLAT_MARGIN'` — Global Flat Margin Mode (No Margin Sheet Needed) ⭐ *Fastest Profit Setup*
* **Setup:** Set `EVALUATION_MODE: 'FLAT_MARGIN'` in `Const.gs` and set `DEFAULT_MARGIN_RATE: 0.40` (e.g., 40% gross margin) under `CONFIG.MODES.FLAT_MARGIN` in `Config.gs`.
* **How it works:** Queries `shopping_product` live in Google Ads for each item's retail price, derives $	ext{Unit Margin} = 	ext{Price} 	imes 	ext{DEFAULT\_MARGIN\_RATE}$, and enforces unit-profit CPA and spend caps automatically.
* **Sellers:** Supports per-tier CPA-to-margin ratios (`HERO.max_cpa_to_margin_ratio: 1.00` for break-even; `SUPERHERO.max_cpa_to_margin_ratio: 1.20` to allow looser CPA on high-volume anchors). Sellers exceeding allowable CPA-to-margin become `ANTI_HERO` (unless protected by `ANTI_HERO.roas_safeguard`).
* **Non-Sellers / Bleeders:** Flagged as `VILLAIN` if $	ext{Cost} > (	ext{Unit Margin} 	imes 	ext{VILLAIN.max\_cost\_to\_margin\_ratio})$.

#### 3. `'VARIABLE_MARGIN'` — Per-Product Margin Sheet Mode (With Automatic Multi-Tier Fallback)
* **Setup:** Set `EVALUATION_MODE: 'VARIABLE_MARGIN'` in `Const.gs`, provide your `MARGIN_SHEET.URL`, and configure `CONFIG.MODES.VARIABLE_MARGIN` in `Config.gs`.
* **How it works:** Loads per-unit dollar margins (`MARGIN_TYPE: 'ABSOLUTE'`), percentage margins (`MARGIN_TYPE: 'PERCENTAGE'`), or `PRICE - COGS` from your Google Sheet.
* **Basket / Cross-Sell Safeguard:** Any converting item with $	ext{ROAS} \ge 	ext{ANTI\_HERO.roas\_safeguard}$ (default `2.0`) is protected from `ANTI_HERO` demotion, accounting for multi-item cart value.
* **Automatic Missing-Product Fallback:** If specific product IDs are missing from the sheet:
  1. If `DEFAULT_MARGIN_RATE` is configured (e.g., `0.40`), it calculates $	ext{Unit Margin} = 	ext{Live Price} 	imes 	ext{DEFAULT\_MARGIN\_RATE}$.
  2. Otherwise, it seamlessly falls back to `ANTI_HERO.fallback_min_roas` and `VILLAIN.fallback_max_spend`.

#### 4. `'HYBRID_MARGIN'` — ROAS Seller Evaluation + Margin Bleeder Protection
* **Setup:** Set `EVALUATION_MODE: 'HYBRID_MARGIN'` in `Const.gs` and configure `CONFIG.MODES.HYBRID_MARGIN` in `Config.gs` (using either `MARGIN_SHEET` or `DEFAULT_MARGIN_RATE`).
* **How it works:** Evaluates converting sellers strictly on ROAS (`HERO.min_roas` / `SUPERHERO.min_roas`), while capping 0-sale product spend using each item's unit margin ($	ext{Unit Margin} 	imes 	ext{VILLAIN.max\_cost\_to\_margin\_ratio}$).

---

## 🔍 Key Architectural Features

### 1. Permanent Villain Suppression (Execution Priority #1)
* When `CONSTANTS.PERMANENT_VILLAINS_SHEET.USE_PERMANENT_LIST` is `true`, the script reads historical bleeder IDs from your configured Google Sheet tab and appends newly detected villains on each live run.
* **Strict Isolation:** Products on the permanent list are immediately locked as **`VILLAIN`** and excluded from seller percentile rankings, preventing chronic budget bleeders from re-entering hero campaigns when lookback windows roll over.

### 2. Fractional Attribution & CPA Safeguards (`MIN_SALES_FOR_CPA`)
Data-driven attribution frequently assigns fractional conversions (e.g., `0.08` or `0.65` sales):
* **Spend-Limit Gate (`sales < MIN_SALES_FOR_CPA`, default `0.50`):** Tiny fractional assists below `0.50` are evaluated as non-sellers against `VILLAIN` spend limits rather than computing distorted CPAs (e.g., $40 spend / 0.08 sales = $500 CPA).
* **Fractional Seller Stabilization (`0.50 <= sales < 1.0`):** For products with partial conversions between `MIN_SALES_FOR_CPA` and `1.0`, CPA is calculated using `Cost / Math.max(1, Sales)` (i.e., `CPA = Cost`) so partial attribution is not artificially penalized before reaching a full conversion.

### 3. Flexible Seller Distribution (`STRICT`, `PERCENTILE`, `HYBRID`)
Configured via `CONSTANTS.DISTRIBUTION_MODE` in `Const.gs`:
* **`'STRICT'`:** Evaluates hard conversion volume and profitability thresholds (`SUPERHERO.min_sales` and `HERO.min_sales`).
* **`'PERCENTILE'`:** Filters for profitable sellers ($\ge 	ext{MIN\_SALES\_FOR\_CPA}$), ranks them by **Net Profit** descending, and assigns the top `PERCENTILES.SUPERHERO` (15%) to `SUPERHERO`, the next `PERCENTILES.HERO` (35%) to `HERO`, and the remaining 50% to `SIDEKICK`.
* **`'HYBRID'`:** Requires sellers to first clear the `HERO.min_sales` volume floor before ranking qualifiers by Net Profit percentiles.

### 4. Conversion Lag Offset & Specific Conversion Action Filtering
* **`DAYS_BACK_OFFSET` (`Config.gs`):** Optionally exclude the most recent $N$ days (e.g., `7`) from the lookback window so delayed conversion attribution settles before grading products.
* **`CONVERSION_ACTION_ID` (`Const.gs`):** Optionally isolate sales and conversion value to a specific Google Ads Conversion Action ID (supporting both Primary and Secondary/Observational conversion actions) while still evaluating total product ad spend.

### 5. Automated Dashboards, Trends Log & Dry Run Mode
* **Tab Ordering:** Automatically organizes your output spreadsheet tabs in clean priority order:
  1. **`Products`** (Supplemental feed tab with `_`-prefixed metric columns safely ignored by Google Merchant Center)
  2. **`Overview`** (Executive summary table with product, sales, cost, and revenue shares + an embedded distribution donut chart)
  3. **`Logs`** (Timestamped execution audit trail and warnings)
  4. **`Label Trends`** (Historical log of tier counts over time)
* **Safe `DRY_RUN` Mode:** When `CONFIG.GENERAL.DRY_RUN: true`, writes to `Products - Dry Run` and `Overview - Dry Run` without modifying your live supplemental feed or appending to the permanent villains list.

---

## 📑 Output Sheet Columns & Formatting

To ensure **Google Merchant Center supplemental feeds safely ignore internal diagnostic metrics**, all auxiliary columns use a leading underscore (`_`):

| Column | Header | Format | Description |
| :--- | :--- | :--- | :--- |
| 1 | `id` | Text | Product Item ID (optionally transformed via `PRODUCT_ID_REPLACE`). |
| 2 | `custom_label_3` (configurable) | Text | Assigned HeroMatrix tier label. |
| 3 | `_price` | `0.00` | Product retail price (from Margin Sheet or live `shopping_product` catalog). |
| 4 | `_margin` | `0.00` | Calculated unit gross profit / margin. |
| 5 | `_sales` | `0.000` | Attributed conversion volume (3 decimal places for fractional visibility). |
| 6 | `_cost` | `0.00` | Total ad spend in lookback window. |
| 7 | `_conv_value` | `0.00` | Total conversion value recorded. |
| 8 | `_cpa` | `0.00` | Cost Per Acquisition (`Cost / Math.max(1, Sales)` for sellers). |
| 9 | `_roas` | `0.000` | Return on Ad Spend (`Conv. Value / Cost`, 3 decimal places). |
| 10 | `_cpa/margin` | `0.00` | Ratio of CPA to unit margin (for sellers with `sales >= MIN_SALES_FOR_CPA`). |
| 11 | `_cost/margin` | `0.00` | Ratio of ad spend to unit margin (for non-sellers with `sales < MIN_SALES_FOR_CPA`). |
| 12 | `_clicks` | `0` | Total clicks recorded. |
| 13 | `_impressions` | `0` | Total impressions recorded. |

---

## ⚙️ Configuration Reference

### 1. Installation & Architecture (`Const.gs`)
```javascript
const CONSTANTS = {
  // 'ROAS' | 'FLAT_MARGIN' | 'VARIABLE_MARGIN' | 'HYBRID_MARGIN'
  EVALUATION_MODE: 'ROAS',

  // 'STRICT' | 'PERCENTILE' | 'HYBRID'
  DISTRIBUTION_MODE: 'STRICT',

  PERCENTILES: {
    SUPERHERO: 0.15,
    HERO: 0.35
  },

  // Optional: Filter conversions by a specific numeric Conversion Action ID (e.g. '123456789')
  CONVERSION_ACTION_ID: null,

  // Optional: Regex pattern & string/callback replacement to clean product IDs
  PRODUCT_ID_REPLACE: {
    PATTERN: null,
    REPLACEMENT: ''
  },

  OUTPUT_SHEET: {
    URL: 'YOUR_OUTPUT_SPREADSHEET_URL',
    TAB_NAME: 'Products',
    OVERVIEW_TAB_NAME: 'Overview',
    TRENDS_TAB_NAME: 'Label Trends',
    ENABLE_TRENDS_LOG: true,
    LOGS_TAB_NAME: 'Logs',
    LABEL_COLUMN: 'custom_label_3'
  },

  MARGIN_SHEET: {
    URL: '',
    TAB_NAME: 'Products',
    MARGIN_TYPE: 'ABSOLUTE', // 'ABSOLUTE' ($ per unit) or 'PERCENTAGE' (% of price)
    COLUMNS: {
      ID: 'id',
      MARGIN: 'margin',
      PRICE: 'price',
      COGS: 'cost_of_goods_sold'
    }
  },

  PERMANENT_VILLAINS_SHEET: {
    USE_PERMANENT_LIST: true,
    URL: '',
    TAB_NAME: 'Villains',
    COLUMNS: {
      ID: 'id',
      LABEL: 'custom_label_3'
    }
  }
};
```

### 2. Optimization Thresholds (`Config.gs`)
```javascript
const CONFIG = {
  GENERAL: {
    DRY_RUN: false,
    DAYS_BACK: 90,
    DAYS_BACK_OFFSET: 0,
    MIN_SALES_FOR_CPA: 0.5
  },

  LABELS: {
    SUPERHERO: { name: 'superhero', desc: 'Top performing, highly profitable products with strong sales.' },
    HERO:      { name: 'hero',      desc: 'Consistent performers with healthy margins/profitability.' },
    SIDEKICK:  { name: 'sidekick',  desc: 'Products being tested, low volume, or low fractional assists (< min_sales).' },
    ANTI_HERO: { name: 'anti_hero', desc: 'Products with sales that are losing money or have unprofitable CPA/ROAS.' },
    VILLAIN:   { name: 'villain',   desc: 'Products with zero sales that exceed the allowable spend threshold.' },
    GHOST:     { name: 'ghost',     desc: 'Products with zero sales, zero clicks, and impressions below the visibility threshold.' }
  },

  MODES: {
    ROAS: {
      SUPERHERO: { min_sales: 2, min_roas: 1.20 },
      HERO:      { min_sales: 0.75, min_roas: 1.25 },
      VILLAIN:   { max_spend: 50.0 },
      GHOST:     { max_impressions: 30 }
    },
    FLAT_MARGIN: {
      DEFAULT_MARGIN_RATE: 0.40,
      SUPERHERO: { min_sales: 2, max_cpa_to_margin_ratio: 1.20 },
      HERO:      { min_sales: 0.75, max_cpa_to_margin_ratio: 1.00 },
      ANTI_HERO: { roas_safeguard: 2.0, fallback_min_roas: 1.0 },
      VILLAIN:   { max_cost_to_margin_ratio: 0.40, fallback_max_spend: 50.0 },
      GHOST:     { max_impressions: 30 }
    },
    VARIABLE_MARGIN: {
      DEFAULT_MARGIN_RATE: null,
      SUPERHERO: { min_sales: 2, max_cpa_to_margin_ratio: 1.20 },
      HERO:      { min_sales: 0.75, max_cpa_to_margin_ratio: 1.00 },
      ANTI_HERO: { roas_safeguard: 2.0, fallback_min_roas: 1.0 },
      VILLAIN:   { max_cost_to_margin_ratio: 0.40, fallback_max_spend: 50.0 },
      GHOST:     { max_impressions: 30 }
    },
    HYBRID_MARGIN: {
      DEFAULT_MARGIN_RATE: null,
      SUPERHERO: { min_sales: 2, min_roas: 1.20 },
      HERO:      { min_sales: 0.75, min_roas: 1.25 },
      VILLAIN:   { max_cost_to_margin_ratio: 0.40, fallback_max_spend: 50.0 },
      GHOST:     { max_impressions: 30 }
    }
  }
};
```

---

## 📁 Modular File Structure

* **`Info.gs`**: In-editor setup instructions, version metadata (`META`), and license header.
* **`Const.gs`**: "Set it and forget it" installation settings, evaluation/distribution mode selectors, and Google Sheet URLs.
* **`Config.gs`**: Frequently adjusted lookback windows, label names, and mode-specific profitability thresholds.
* **`Code.gs`**: Core operational logic, GAQL queries, margin resolution, and Google Sheets dashboard generation.
* **`CHANGELOG.md`**: Release history (available online on the [Official Changelog](https://www.awees.biz/scripts/heromatrix-labelizer/changelog/)).
* **`LICENSE`**: MIT License.

---

## 🤝 Custom Implementation & Consulting

**HeroMatrix** is free and open-source under the MIT License. 

* 🌐 **Script Page & Documentation:** [https://www.awees.biz/scripts/heromatrix-labelizer/](https://www.awees.biz/scripts/heromatrix-labelizer/)
* 📜 **Changelog & Updates:** [https://www.awees.biz/scripts/heromatrix-labelizer/changelog/](https://www.awees.biz/scripts/heromatrix-labelizer/changelog/)

If your team needs help with:
* Custom COGS / margin feed pipelines or BigQuery integrations
* Multi-account MCC script deployments
* Restructuring Shopping & Performance Max campaigns around profit-first custom labels

Reach out at **[info@awees.biz](mailto:info@awees.biz)**.
