/**
 * Mock content for the Design workspace panels.
 *
 * Everything in this file is placeholder data standing in for a real block
 * library. Replace each block as its backing system lands; nothing here should
 * survive into production.
 *
 * Two things have already left. Draft layers are real configuration rather than
 * mock data, so they live in `store/layers.ts`. The edit log is now read off the
 * real command stack in `store/historyStore.ts`.
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

