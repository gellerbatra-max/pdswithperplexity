import type { LayerId, LayerVisibility } from './types';

/**
 * Draw layers, declared once.
 *
 * These are not mock data — the first four drive the renderer today. They live
 * beside the viewport store because layer visibility is view state, and because
 * the default visibility map is derived from this list rather than written out
 * again: adding a layer should mean editing `LayerId` and this array, and
 * nothing else.
 */
export interface LayerDescriptor {
  readonly id: LayerId;
  readonly label: string;
  /** `planned` layers are listed so coverage stays visible, but draw nothing. */
  readonly status: 'available' | 'planned';
  /** Locked layers cannot be hidden — the net line is the pattern. */
  readonly locked?: boolean;
  readonly visibleByDefault?: boolean;
}

export const LAYERS: readonly LayerDescriptor[] = [
  { id: 'net', label: 'Net line', status: 'available', locked: true },
  { id: 'seam', label: 'Seam allowance', status: 'available' },
  { id: 'nodes', label: 'Control points', status: 'available' },
  { id: 'labels', label: 'Piece labels', status: 'available' },
  { id: 'notches', label: 'Notches', status: 'planned' },
  { id: 'grain', label: 'Grain lines', status: 'planned' },
  { id: 'internals', label: 'Internal lines', status: 'planned' },
  { id: 'annotation', label: 'Annotation', status: 'planned' },
];

/** Derived, so it can never drift from the list above. */
export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = Object.fromEntries(
  LAYERS.map((layer) => [layer.id, layer.visibleByDefault ?? true]),
) as LayerVisibility;

export const findLayer = (id: LayerId): LayerDescriptor | undefined =>
  LAYERS.find((layer) => layer.id === id);
