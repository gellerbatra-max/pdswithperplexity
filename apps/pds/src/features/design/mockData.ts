/**
 * Mock content for the Design workspace panels.
 *
 * Everything in this file is placeholder data standing in for a real block
 * library and edit log. Replace each block as its backing system lands; nothing
 * here should survive into production.
 *
 * Draft layers used to live here too. They are real configuration rather than
 * mock data, so they now live in `store/layers.ts`.
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

