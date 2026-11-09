# HeroMatrix: The Profit-First Product Labelizer

An enterprise Google Ads Script (JavaScript/GAS) that analyzes Shopping performance metrics, unit margins, and net profitability to automatically segment products into actionable custom label tiers.

Designed for high-scale Google Ads Shopping and Performance Max campaigns with support for 4 profit evaluation modes, dynamic seller distribution (`STRICT`, `PERCENTILE`, `HYBRID`), fractional conversion safeguards, historical trend logging, and permanent villain suppression.

🔗 **Official Script Page:** [https://www.awees.biz/scripts/heromatrix-labelizer/](https://www.awees.biz/scripts/heromatrix-labelizer/)  
📜 **Changelog & Version History:** [https://www.awees.biz/scripts/heromatrix-labelizer/changelog/](https://www.awees.biz/scripts/heromatrix-labelizer/changelog/)

---

## 🦸 Labeling Tiers Overview

HeroMatrix segments your catalog into a 6-tier Superhero hierarchy. Any tier can be disabled in the configuration to automatically cascade products into the next logical tier:

| Label | Tier | Qualification Criteria | Campaign Strategy |
| :--- | :--- | :--- | :--- |
| **SUPERHERO** | ⚡ Top Performer | High conversion volume (e.g., >= 2 sales) meeting target ROAS or margin cap. | Isolate in top-budget campaigns with aggressive targets. |
| **HERO** | 🦸 Core Winner | Consistent, profitable conversion volume (e.g., >= 0.75 sales). | Maintain steady budgets as your primary volume drivers. |
| **SIDEKICK** | 🤝 Testing & Pipeline | Low-spend non-sellers or profitable low-volume sellers (< 0.75 sales). | Nurture in discovery campaigns with controlled bids. |
| **ANTI_HERO** | 🥀 Unprofitable Seller | Generates sales, but CPA exceeds unit margin or misses target ROAS. | Restrict bids or move to a low-bid margin-recovery campaign. |
| **VILLAIN** | 🦹 Budget Bleeder | Zero or minimal sales while exceeding your maximum spend threshold. | Exclude from main campaigns and optionally lock on the permanent villain list. |
| **GHOST** | 👻 Invisible / Cold | Zero sales, zero clicks, and impressions below visibility threshold. | Push into a low-bid catch-all campaign or audit feed pricing/titles. |

---

## 🔍 Why Use HeroMatrix Over Standard ROAS Scripts?

### 1. True Profit & POAS Evaluation
Most Google Ads labelizer scripts only look at revenue (ROAS) and flat spend caps. HeroMatrix supports **4 evaluation modes** — allowing you to grade products by pure ROAS, a global flat margin percentage (using live catalog prices without a spreadsheet), per-product COGS/margin sheets, or a hybrid of both.

### 2. Permanent Villain Suppression
Standard scripts suffer from "lookback amnesia": when a 30- or 90-day window rolls over, chronic budget bleeders drop back to $0 spend, get relabeled as test items, and waste ad spend all over again. HeroMatrix can record bleeders in a **Permanent Villains** sheet so they stay suppressed across lookback windows.

### 3. Data-Driven Fractional Attribution Safeguards
Google Ads data-driven attribution frequently assigns fractional conversions (such as 0.08 or 0.65 sales) that break standard CPA math:
* **Spend-Limit Gate:** Products with tiny fractional assists below the minimum sales floor (default 0.50) are evaluated as non-sellers against spend caps, preventing distorted CPAs (e.g., $40 spend / 0.08 sales = $500 CPA).
* **Stabilized Fractional CPA:** For sellers with 0.50 to 0.99 conversions, CPA is stabilized against a 1-sale baseline so promising products aren't penalized before reaching a full conversion.

### 4. Conversion Lag Offset & Conversion Action Filtering
* **Conversion Lag Offset:** Exclude the most recent days (e.g., last 7 days) from your lookback window so delayed conversions settle before products are graded.
* **Conversion Action Filtering:** Optionally evaluate sales and revenue from a specific Google Ads Conversion Action ID (supporting both Primary and Secondary actions) while still accounting for total product ad spend.

### 5. Automated Google Sheets Dashboard & Dry Run Mode
HeroMatrix formats and organizes your output Google Sheet automatically:
1. **Products:** Merchant Center supplemental feed tab with diagnostic metric columns prefixed by an underscore (`_`) so GMC safely ignores them.
2. **Overview:** Executive summary of product count, sales, ad spend, and revenue share by tier, complete with a visual distribution chart.
3. **Label Trends:** Historical log tracking how your catalog shifts across tiers over time.
4. **Logs:** Timestamped execution audit trail.
5. **Dry Run Mode:** Safely preview your label distribution in dedicated test tabs without touching your live Merchant Center supplemental feed.

---

## 🚀 Next Steps: Setup & Configuration

Ready to deploy HeroMatrix in your Google Ads account? Read the **[Setup & Configuration Guide](https://www.awees.biz/scripts/heromatrix-labelizer/setup-guide)** to compare profit modes, format your Google Sheet, and copy the configuration settings.

---

## 🤝 Custom Implementation & Consulting

HeroMatrix is free and open-source under the MIT License. If your team needs help with:
* Automated COGS / margin feeds or BigQuery pipelines
* Multi-account MCC script deployments
* Restructuring Shopping & Performance Max campaigns around profit-first custom labels

**[Get in touch with Awees](mailto:info@awees.biz)**.


* 🌐 **Script Page & Documentation:** [https://www.awees.biz/scripts/heromatrix-labelizer/](https://www.awees.biz/scripts/heromatrix-labelizer/)
* 📜 **Changelog & Updates:** [https://www.awees.biz/scripts/heromatrix-labelizer/changelog/](https://www.awees.biz/scripts/heromatrix-labelizer/changelog/)
