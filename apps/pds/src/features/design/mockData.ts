import type { LayerId } from '@/store';

/**
 * Placeholder content for the Design workspace panels. Everything here is mock
 * data standing in for a real library, history log and AI provider — replace each
 * block as its backing system lands.
 */

/* --- Block library ---------------------------------------------------------- */

export interface BlockEntry {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly size: string;
  readonly updated: string;
}

export const BLOCKS: readonly BlockEntry[] = [
  { id: 'blk-001', name: 'Shirt Body — Classic', category: 'Shirts', size: 'M', updated: '3d ago' },
  { id: 'blk-002', name: 'Shirt Body — Slim', category: 'Shirts', size: 'M', updated: '3d ago' },
  { id: 'blk-003', name: 'Two-Piece Sleeve', category: 'Sleeves', size: 'M', updated: '1w ago' },
  { id: 'blk-004', name: 'One-Piece Sleeve', category: 'Sleeves', size: 'M', updated: '1w ago' },
  { id: 'blk-005', name: 'Convertible Collar', category: 'Collars', size: '39', updated: '2w ago' },
  { id: 'blk-006', name: 'Button-Down Collar', category: 'Collars', size: '39', updated: '2w ago' },
  { id: 'blk-007', name: 'Barrel Cuff', category: 'Cuffs', size: 'M', updated: '2w ago' },
  { id: 'blk-008', name: 'French Cuff', category: 'Cuffs', size: 'M', updated: '1mo ago' },
  { id: 'blk-009', name: 'Trouser Front — Flat', category: 'Trousers', size: '32', updated: '1mo ago' },
  { id: 'blk-010', name: 'Patch Pocket', category: 'Details', size: '—', updated: '2mo ago' },
];

/* --- Draft layers ----------------------------------------------------------- */

export interface LayerDescriptor {
  readonly id: LayerId;
  readonly label: string;
  readonly status: 'available' | 'planned';
  /** Locked layers cannot be hidden — the net line is the pattern. */
  readonly locked?: boolean;
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

/* --- History ---------------------------------------------------------------- */

export interface HistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly time: string;
}

export const HISTORY: readonly HistoryEntry[] = [
  { id: 'h-9', label: 'Add seam allowance', detail: 'Sleeve · 12 mm', time: '2m' },
  { id: 'h-8', label: 'Walk seam', detail: 'Front Left ↔ Back', time: '11m' },
  { id: 'h-7', label: 'Move node', detail: 'Back · node 4', time: '18m' },
  { id: 'h-6', label: 'Add notch', detail: 'Sleeve · cap', time: '24m' },
  { id: 'h-5', label: 'Rename piece', detail: 'Yoke', time: '31m' },
  { id: 'h-4', label: 'Set grain line', detail: 'Collar Stand · 0°', time: '48m' },
  { id: 'h-3', label: 'Mirror piece', detail: 'Front Right', time: '1h' },
  { id: 'h-2', label: 'Import block', detail: 'Shirt Body — Classic', time: '1h' },
  { id: 'h-1', label: 'Create document', detail: 'SH-2041', time: '2h' },
];

/*
 * Points of measure used to live here. They are now real `MeasurementLink`s on
 * the document (see `store/seedDocument.ts`) and are evaluated against the
 * geometry by `evaluateMeasurements` in `@/pattern`.
 */

/* --- AI suggestions --------------------------------------------------------- */

export interface SuggestionEntry {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly confidence: number;
  readonly scope: string;
}

export const SUGGESTIONS: readonly SuggestionEntry[] = [
  {
    id: 'ai-1',
    title: 'Reduce sleeve cap ease',
    detail: 'Cap ease measures 42 mm against a 30–35 mm target for woven poplin. Expect setting difficulty.',
    confidence: 0.86,
    scope: 'Sleeve',
  },
  {
    id: 'ai-2',
    title: 'Seam allowance mismatch',
    detail: 'Sleeve uses 12 mm while the mating armhole on Front Left uses 10 mm.',
    confidence: 0.94,
    scope: 'Sleeve ↔ Front Left',
  },
  {
    id: 'ai-3',
    title: 'Add balance notch',
    detail: 'Back side seam has no balance notch between underarm and hem — 320 mm unnotched.',
    confidence: 0.71,
    scope: 'Back',
  },
  {
    id: 'ai-4',
    title: 'Collar stand length',
    detail: 'Stand is 4 mm shorter than the neckline it joins. Check before grading.',
    confidence: 0.63,
    scope: 'Collar Stand',
  },
];
