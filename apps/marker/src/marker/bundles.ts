/**
 * Assigning a colour slot to each bundle.
 *
 * Pure, so the mapping is testable and identical wherever it is asked — the
 * tray badge and the piece on the fabric must agree or the colour coding is
 * worse than none.
 */

import type { MarkerDocument } from './schema';

/** Matches the number of bundle hues the design system defines. */
export const BUNDLE_SLOTS = 8;

/**
 * Bundle names in a stable order.
 *
 * Sorted rather than first-seen: first-seen order changes when a piece is
 * deleted or a nest reorders placements, and a bundle that changes colour
 * because something unrelated moved is worse than no colour at all.
 */
export const bundleOrder = (document: MarkerDocument): string[] => {
  const names = new Set<string>();
  for (const piece of document.pieces) names.add(piece.bundle);
  for (const tray of document.trayPieces) names.add(tray.bundle);
  return [...names].sort();
};

/**
 * Which of the eight colour slots a bundle occupies, zero-based.
 *
 * Wraps past eight. Two bundles then share a hue, which is honest — there are
 * only eight colours that stay distinguishable to a colour-blind user, and
 * inventing a ninth would break the guarantee the palette exists for.
 */
export const bundleSlot = (document: MarkerDocument, bundle: string): number => {
  const index = bundleOrder(document).indexOf(bundle);
  return index < 0 ? 0 : index % BUNDLE_SLOTS;
};

/** Every bundle's slot in one pass, for callers colouring a whole document. */
export const bundleSlots = (document: MarkerDocument): Map<string, number> => {
  const slots = new Map<string, number>();
  bundleOrder(document).forEach((bundle, index) => {
    slots.set(bundle, index % BUNDLE_SLOTS);
  });
  return slots;
};
