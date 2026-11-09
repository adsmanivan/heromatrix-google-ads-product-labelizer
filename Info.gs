/**
 * ==========================================================================
 * HEROMATRIX: THE PROFIT-FIRST PRODUCT LABELIZER FOR GOOGLE ADS
 * ==========================================================================
 * 
 * DESCRIPTION:
 * Analyzes Shopping Performance View data, unit margins, and profitability to 
 * automatically segment products into actionable custom label tiers (`superhero`,
 * `hero`, `sidekick`, `anti_hero`, `villain`, `ghost`). Features 4 evaluation modes
 * (Pure ROAS, Flat Margin, Variable Sheet Margin, and Hybrid Margin), dynamic 
 * distribution modes (Strict, Percentile, Hybrid), and permanent villain suppression.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Ads account -> Tools and Settings -> Scripts.
 * 2. Create a new script, copy all files (.gs) into the script editor:
 *    - Info.gs
 *    - Const.gs
 *    - Config.gs
 *    - Code.gs
 * 3. Open `Const.gs` to configure your installation settings (`EVALUATION_MODE`,
 *    `DISTRIBUTION_MODE`, `CONVERSION_ACTION_ID`, `PRODUCT_ID_REPLACE`) and
 *    update your Google Spreadsheet URLs:
 *    - OUTPUT_SHEET: Destination sheet for the reports, trends log, and overview dashboard.
 *    - MARGIN_SHEET: (Optional) Sheet providing Price, COGS, or Margins.
 *    - PERMANENT_VILLAINS_SHEET: (Optional) Supplemental feed tracking historical villains.
 * 4. Open `Config.gs` to fine-tune your general settings, label names, and the
 *    mode block under `CONFIG.MODES` matching your selected `EVALUATION_MODE`.
 * 5. Preview the script to verify permissions and validate the dry run output.
 * 6. Set up a daily or weekly schedule for automated execution.
 * 
 * CUSTOM IMPLEMENTATION & SUPPORT:
 * Need help setting up custom margin feeds, BigQuery integrations, or tailored 
 * Shopping / PMax campaign architectures? Contact info@awees.biz.
 * 
 * LICENSE:
 * Released under the MIT License. See LICENSE file for details.
 * 
 * ==========================================================================
 */

const META = {
  name: "HeroMatrix: The Profit-First Product Labelizer",
  version: "1.0.0",
  author: "Ivan",
  email: "info@awees.biz",
  scriptUrl: "https://www.awees.biz/scripts/heromatrix-labelizer/",
  changelogUrl: "https://www.awees.biz/scripts/heromatrix-labelizer/changelog/"
};
