import { create } from 'zustand';
import type { PieceId, PointId, SegmentId } from '@/pattern';
import { useDocumentStore } from './documentStore';
import { refExists, sameRef, selectionKey, type SelectionRef } from './selection';

/**
 * Shared selection state.
 *
 * Deliberately its own store rather than a field on the document: selection is
 * view state, it is shared by every workspace, and it must survive document
 * edits. Keeping it separate means a workspace binds its inspector to the
 * selection without reaching into the document store.
 *
 * The derived sets are held in state rather than computed in selectors. Zustand
 * compares selector results with Object.is, so a selector that built a fresh Set
 * on every call would re-render forever; recomputing once per change keeps the
 * references stable.
 */

interface Derived {
  readonly selectedKeys: ReadonlySet<string>;
  readonly selectedPieceIds: ReadonlySet<PieceId>;
  readonly selectedPointIds: ReadonlySet<PointId>;
  readonly selectedSegmentIds: ReadonlySet<SegmentId>;
  readonly primary: SelectionRef | null;
}

const derive = (selection: readonly SelectionRef[]): Derived => {
  const selectedKeys = new Set<string>();
  const selectedPieceIds = new Set<PieceId>();
  const selectedPointIds = new Set<PointId>();
  const selectedSegmentIds = new Set<SegmentId>();

  for (const ref of selection) {
    selectedKeys.add(selectionKey(ref));
    // A selected point or segment implies its piece is the one in context,
    // which is what the renderer and the piece tree want to show.
    selectedPieceIds.add(ref.pieceId);
    if (ref.kind === 'point') selectedPointIds.add(ref.pointId);
    if (ref.kind === 'segment') selectedSegmentIds.add(ref.segmentId);
  }

  return {
    selectedKeys,
    selectedPieceIds,
    selectedPointIds,
    selectedSegmentIds,
    primary: selection.length > 0 ? (selection[selection.length - 1] ?? null) : null,
  };
};

export interface SelectionState extends Derived {
  selection: readonly SelectionRef[];

  /**
   * Select a ref. `additive` toggles it into the existing selection — enough for
   * shift-click; range and marquee selection are not implemented.
   */
  select: (ref: SelectionRef, additive?: boolean) => void;
  selectMany: (refs: readonly SelectionRef[]) => void;
  clear: () => void;
  isSelected: (ref: SelectionRef) => boolean;
}

const EMPTY: readonly SelectionRef[] = [];

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selection: EMPTY,
  ...derive(EMPTY),

  select: (ref, additive = false) =>
    set((state) => {
      if (!additive) return { selection: [ref], ...derive([ref]) };
      const exists = state.selection.some((entry) => sameRef(entry, ref));
      const selection = exists
        ? state.selection.filter((entry) => !sameRef(entry, ref))
        : [...state.selection, ref];
      return { selection, ...derive(selection) };
    }),

  selectMany: (refs) => set({ selection: refs, ...derive(refs) }),

  clear: () => set({ selection: EMPTY, ...derive(EMPTY) }),

  isSelected: (ref) => get().selectedKeys.has(selectionKey(ref)),
}));

/**
 * Drop refs that no longer resolve when the document changes, so a selection can
 * never outlive the geometry it points at.
 */
useDocumentStore.subscribe((state, previous) => {
  if (state.document === previous.document) return;

  const { selection } = useSelectionStore.getState();
  if (selection.length === 0) return;

  const kept = selection.filter((ref) => refExists(state.document, ref));
  if (kept.length !== selection.length) {
    useSelectionStore.getState().selectMany(kept);
  }
});
