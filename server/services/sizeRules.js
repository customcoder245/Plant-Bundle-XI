// ─── PLANT SIZE RULES ────────────────────────────────────────────────────────
// Single source of truth for plant-size label matching, No-Pot discounts and
// whether a plant size is sold with a pot at all.
//
// Built-in defaults (Doug's rules):
//   - 2 inch plants NEVER come with a pot
//   - 5 gal and larger come WITHOUT a pot by default (per-product override
//     via size_mappings.pots_enabled can turn pots on later, e.g. 5 gal pots)
//   - everything else offers pots
// Global per-size overrides live in no_pot_discounts.pots_offered.
// Per-product, per-variant overrides live in size_mappings.pots_enabled.

function normalizeSizeLabel(s) {
    return (s || '').toLowerCase()
        .replace(/["“”]/g, ' inch')
        .replace(/gallons?\b/g, 'gal')
        .replace(/\bgal\./g, 'gal')
        .replace(/\bpot\b/g, '')
        .replace(/[^a-z0-9. ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function defaultPotsOffered(sizeLabel) {
    const norm = normalizeSizeLabel(sizeLabel);
    const inchMatch = norm.match(/(\d+(?:\.\d+)?)\s*inch/);
    if (inchMatch && parseFloat(inchMatch[1]) <= 2) return false;   // 2 inch: never a pot
    const galMatch = norm.match(/(\d+(?:\.\d+)?)\s*gal/);
    if (galMatch && parseFloat(galMatch[1]) >= 5) return false;     // 5 gal+: bare-root by default
    return true;
}

/**
 * resolvePotsOffered - per-product override > global table > built-in default
 * @param {String} sizeLabel - plant size label e.g. '6 inch', '5 Gal.'
 * @param {Array} discountRows - rows of no_pot_discounts (plant_size, amount, pots_offered)
 * @param {Boolean|null} perProductOverride - size_mappings.pots_enabled (null = inherit)
 */
function resolvePotsOffered(sizeLabel, discountRows = [], perProductOverride = null) {
    if (perProductOverride === true || perProductOverride === false) return perProductOverride;
    const norm = normalizeSizeLabel(sizeLabel);
    const row = discountRows.find(d => normalizeSizeLabel(d.plant_size) === norm);
    if (row && row.pots_offered === false) return false;
    if (row && row.pots_offered === true) return true;
    return defaultPotsOffered(sizeLabel);
}

function discountForSize(sizeLabel, discountRows = [], fallback = 10.00) {
    const norm = normalizeSizeLabel(sizeLabel);
    const row = discountRows.find(d => normalizeSizeLabel(d.plant_size) === norm);
    return row ? parseFloat(row.amount) : fallback;
}

const NO_POT_RE = /(no pot|without pot|bare ?root)/i;
const isNoPotValue = v => NO_POT_RE.test(v || '');
const isWithPotValue = v => /with pot/i.test(v || '') && !NO_POT_RE.test(v || '');
const sizeLabelOfVariant = v => v.option1 || (v.title || '').split(' / ')[0].trim();

function potPriceForSize(potSize, potPriceRows = [], fallback = 10.00) {
    const norm = normalizeSizeLabel(potSize);
    const row = potPriceRows.find(p => normalizeSizeLabel(p.pot_size) === norm);
    return row ? parseFloat(row.price) : fallback;
}

// How much "No Pot" SAVES off the with-pot price for this pot size.
// Defaults to the full pot price (No Pot = plant base price) unless the
// merchant sets a smaller deduction (e.g. 6" pot adds $15 but No Pot only saves $10).
function potDeductionForSize(potSize, potPriceRows = [], fallback = 10.00) {
    const norm = normalizeSizeLabel(potSize);
    const row = potPriceRows.find(p => normalizeSizeLabel(p.pot_size) === norm);
    if (!row) return fallback;
    const d = row.no_pot_deduction;
    return (d === null || d === undefined || d === '') ? parseFloat(row.price) : parseFloat(d);
}

// Bare-root ("No Pot") choice per plant size. Built-in default: 3-5 inch plants
// in this app ALWAYS ship in the decorative pot (no nursery, no bare-root) -
// the pot is mandatory and its price is baked in. Larger sizes under 5 gal
// offer the choice. Override per size via no_pot_discounts.bare_root_option.
function defaultBareRootOption(sizeLabel) {
    const norm = normalizeSizeLabel(sizeLabel);
    const inchMatch = norm.match(/(\d+(?:\.\d+)?)\s*inch/);
    if (inchMatch && parseFloat(inchMatch[1]) > 2 && parseFloat(inchMatch[1]) < 6) return false;
    return true;
}

function resolveBareRootOption(sizeLabel, ruleRows = []) {
    const norm = normalizeSizeLabel(sizeLabel);
    const row = ruleRows.find(d => normalizeSizeLabel(d.plant_size) === norm);
    if (row && row.bare_root_option === false) return false;
    if (row && row.bare_root_option === true) return true;
    return defaultBareRootOption(sizeLabel);
}

/**
 * resolvePotMode - the one call that decides how a plant size behaves:
 *  'none'     - no pot UI at all (2 inch, 5 gal+ by default)
 *  'required' - decorative pot mandatory, price baked into the single variant (4 inch)
 *  'optional' - base price bare-root + With-Pot twin (+pot price) (6 inch - 3 gal)
 */
function resolvePotMode(sizeLabel, ruleRows = [], perProductOverride = null) {
    const offered = resolvePotsOffered(sizeLabel, ruleRows, perProductOverride);
    if (!offered) return 'none';
    return resolveBareRootOption(sizeLabel, ruleRows) ? 'optional' : 'required';
}

module.exports = {
    potPriceForSize, potDeductionForSize, defaultBareRootOption, resolveBareRootOption, resolvePotMode,
    normalizeSizeLabel, defaultPotsOffered, resolvePotsOffered, discountForSize,
    NO_POT_RE, isNoPotValue, isWithPotValue, sizeLabelOfVariant
};
