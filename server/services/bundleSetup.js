const { resolvePotMode, potPriceForSize, potDeductionForSize, isNoPotValue, isWithPotValue, sizeLabelOfVariant, normalizeSizeLabel } = require('./sizeRules');

const round2 = n => Math.max(0, Math.round(n * 100) / 100);

/**
 * buildSetupPlan - Pure planner for one-click bundle setup. PRICING MODEL:
 * the plant product's existing price is the BASE (how it normally ships);
 * a decorative pot ADDS the standard pot price for the mapped pot size
 * (one global price list), plus an optional per-plant adjustment.
 *
 * Per-size modes (resolvePotMode):
 *  'none'     - 2 inch / 5 gal+: no pot UI, variant untouched (marked Without Pot)
 *  'required' - 4 inch: decorative pot mandatory -> the size's single variant
 *               becomes "With Pot" and its price is RAISED by pot price (+adjust)
 *  'optional' - 6 inch..3 gal: original variant keeps base price as "Without Pot",
 *               a "With Pot" twin is created at base + pot price (+adjust)
 *
 * @param {Object} product - Shopify product
 * @param {Object} ctx - { rules, potPrices, sizeToPot, sizeAdjust }
 *   rules:      no_pot_discounts rows (pots_offered / bare_root_option per plant size)
 *   potPrices:  pot_prices rows (pot_size -> price)
 *   sizeToPot:  { normalizedPlantSize: potSize } from the size mappings
 *   sizeAdjust: { normalizedPlantSize: number } per-plant price adjuster
 */
function buildSetupPlan(product, ctx = {}) {
    const { rules = [], potPrices = [], sizeToPot = {}, sizeAdjust = {}, sizeBase = {}, sizeOverride = {}, defaultPotPrice = 10 } = ctx;
    const variants = product.variants || [];
    if (variants.length === 0) return { error: 'Product has no variants.' };

    let potPos = null;
    for (const pos of [1, 2, 3]) {
        if (variants.some(v => isNoPotValue(v[`option${pos}`]) || isWithPotValue(v[`option${pos}`]))) { potPos = pos; break; }
    }
    const optionCount = (product.options || []).length || 1;
    if (!potPos && optionCount >= 2) {
        return { error: `Product has extra options (${(product.options || []).map(o => o.name).join(', ')}). Remove old Pot Color-style options in Shopify first - pot colors come from the app, not variants.` };
    }
    if (potPos && optionCount > 2) {
        return { error: 'Product mixes a Pot option with another extra option. Reduce it to Size + Pot in Shopify first.' };
    }

    const plan = {
        sizeOptionName: (product.options && product.options[0] && product.options[0].name) || 'Size',
        needsPotOption: !potPos,
        variantOption2: [],
        createVariants: [],
        repriceVariants: [],
        sizes: []
    };

    const groups = new Map();
    for (const v of variants) {
        const label = sizeLabelOfVariant(v);
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(v);
    }

    for (const [label, vars] of groups) {
        const norm = normalizeSizeLabel(label);
        const mode = resolvePotMode(label, rules, null);
        const potSize = sizeToPot[norm] || null;
        const potPrice = potPriceForSize(potSize, potPrices, defaultPotPrice);
        const deduction = potDeductionForSize(potSize, potPrices, defaultPotPrice);
        const adjust = parseFloat(sizeAdjust[norm]) || 0;
        const withPotV = potPos ? vars.find(v => isWithPotValue(v[`option${potPos}`])) : null;
        const noPotV = potPos ? vars.find(v => isNoPotValue(v[`option${potPos}`])) : null;
        const baseVariant = noPotV || (!potPos ? vars[0] : withPotV);
        const base = sizeBase[norm] !== undefined ? parseFloat(sizeBase[norm]) : parseFloat(baseVariant.price);
        const override = sizeOverride[norm] !== undefined && sizeOverride[norm] !== null ? parseFloat(sizeOverride[norm]) : null;
        // Doug edited the base price: push it to the base variant (optional mode only;
        // required-mode singles get their full price below, none-mode keeps Shopify's)
        if (sizeBase[norm] !== undefined && baseVariant && parseFloat(baseVariant.price) !== base && (mode === 'optional' || mode === 'none')) {
            plan.repriceVariants.push({ id: baseVariant.id, price: base.toFixed(2) });
        }
        const entry = { size: label, mode, pot_size: potSize, pot_price: potPrice, no_pot_deduction: deduction, adjust, base_price: base.toFixed(2), base_used: base, with_pot_price: null, no_pot_price: null, action: '' };

        if (mode === 'none') {
            if (!potPos) for (const v of vars) plan.variantOption2.push({ id: v.id, value: 'Without Pot' });
            entry.action = potPos && withPotV
                ? 'Bare-root size still has a With Pot variant - delete it in Shopify'
                : 'Bare-root / ships as-is (price untouched)';
        } else if (mode === 'required') {
            const target = override !== null ? round2(override) : round2(base + potPrice + adjust);
            entry.with_pot_price = target.toFixed(2);
            entry.base_price = null; // not sold without the pot
            if (!potPos) {
                plan.variantOption2.push({ id: vars[0].id, value: 'With Pot' });
                plan.repriceVariants.push({ id: vars[0].id, price: target.toFixed(2) });
                entry.action = `Pot included - price $${base.toFixed(2)} -> $${target.toFixed(2)} (+$${(potPrice + adjust).toFixed(2)} pot)`;
            } else if (withPotV && !noPotV) {
                if (override !== null && parseFloat(withPotV.price) !== round2(override)) {
                    plan.repriceVariants.push({ id: withPotV.id, price: round2(override).toFixed(2) });
                    entry.with_pot_price = round2(override).toFixed(2);
                    entry.action = 'Manual price applied';
                } else {
                    entry.with_pot_price = parseFloat(withPotV.price).toFixed(2);
                    entry.action = 'Already pot-included';
                }
            } else if (noPotV) {
                const t2 = override !== null ? round2(override) : round2(parseFloat(noPotV.price) + potPrice + adjust);
                entry.with_pot_price = t2.toFixed(2);
                if (withPotV) {
                    if (parseFloat(withPotV.price) !== t2) plan.repriceVariants.push({ id: withPotV.id, price: t2.toFixed(2) });
                } else {
                    plan.createVariants.push({ option1: label, option2: 'With Pot', price: t2.toFixed(2), size: label });
                }
                entry.action = 'Pot is mandatory for this size - delete the Without Pot variant in Shopify';
            }
        } else { // optional
            const target = override !== null ? round2(override) : round2(base + potPrice + adjust);
            // No Pot is NOT the bare base price: it's the with-pot price minus the
            // per-size deduction (e.g. 6" pot adds $15 but No Pot only saves $10).
            const noPotTarget = round2(target - deduction);
            entry.with_pot_price = target.toFixed(2);
            entry.no_pot_price = noPotTarget.toFixed(2);
            if (!potPos) {
                plan.variantOption2.push({ id: vars[0].id, value: 'Without Pot' });
                if (parseFloat(vars[0].price) !== noPotTarget) plan.repriceVariants.push({ id: vars[0].id, price: noPotTarget.toFixed(2) });
                plan.createVariants.push({ option1: label, option2: 'With Pot', price: target.toFixed(2), size: label });
                entry.action = `With pot $${target.toFixed(2)} · No Pot $${noPotTarget.toFixed(2)} (saves $${deduction.toFixed(2)})`;
            } else {
                if (!withPotV) {
                    plan.createVariants.push({ option1: label, option2: 'With Pot', price: target.toFixed(2), size: label });
                    entry.action = 'With-Pot variant created';
                } else if (parseFloat(withPotV.price) !== target) {
                    plan.repriceVariants.push({ id: withPotV.id, price: target.toFixed(2) });
                    entry.action = `Prices corrected (with pot $${target.toFixed(2)})`;
                } else {
                    entry.action = 'Already set up';
                }
                if (noPotV && parseFloat(noPotV.price) !== noPotTarget) {
                    plan.repriceVariants.push({ id: noPotV.id, price: noPotTarget.toFixed(2) });
                    entry.action += ` · No Pot $${noPotTarget.toFixed(2)}`;
                }
            }
        }
        plan.sizes.push(entry);
    }
    return plan;
}

module.exports = { buildSetupPlan };
