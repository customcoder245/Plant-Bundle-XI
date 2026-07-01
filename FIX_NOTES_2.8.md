# HOUSEPLANT APP — V2.8 (Pot Selector DESIGN match)

Design-only change to the storefront pot selector widget
(extensions/pot-selector/blocks/pot_selector.liquid). NO backend / JS / logic change.

Goal: make the widget look exactly like the Variegated Snake Plant page.

What changed (CSS only):
1. NO POT OPTION — removed the heavy rounded bordered "card" box (was border-radius
   12px, 2px border, drop shadow). Now a clean row: red-X icon + text, no box.
2. "SAVE $10 ..." text is now plain dark (#333), normal weight — was green + bold.
   Default copy set to "SAVE $10 – Plant will be shipped bare-root" (matches target).
3. Pot swatches: 72px square tiles, 1px light border, selected = 2px solid black
   (matches target's selected-swatch look). object-fit: contain so pot photos sit clean.
4. "Pot Color — White" header: 17px, "Pot Color" bold black, selected name grey + letter-spaced.

IMPORTANT (unchanged from prior releases — this is what makes the widget APPEAR):
The widget only renders if BOTH are true on the live store:
  (a) theme app block "Pot Selector" is added in the Shopify theme editor
      (Online Store > Themes > Customize > product template > Add block > Apps > Pot Selector), AND
  (b) the product has been set up in the app (Houseplants > Add Houseplant).
If a product page shows raw "Pot — Without Pot" theme variants and no color swatches,
the block has NOT been added to the theme yet — the design fix cannot show until it is.
