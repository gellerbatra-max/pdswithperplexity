import type { Unit, Vec2 } from '@/geometry';

export type PieceId = string;
export type NodeId = string;

/** A control node on a piece outline. */
export interface PieceNode {
  readonly id: NodeId;
  readonly position: Vec2;
  /** Corner nodes are hard points; curve nodes are interpolated by the outline solver. */
  readonly kind: 'corner' | 'curve';
}

/** A pattern piece — the primary object the whole product operates on. */
export interface Piece {
  readonly id: PieceId;
  readonly name: string;
  readonly nodes: readonly PieceNode[];
  readonly closed: boolean;
  /** Seam allowance in millimetres; 0 means net line only. */
  readonly seamAllowance: number;
}

export interface PatternDocument {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  readonly pieces: readonly Piece[];
  readonly updatedAt: string;
}

export type SaveState = 'saved' | 'unsaved' | 'saving';

/** Top-level workspaces. Replaces the legacy ribbon-tab model with one canvas per intent. */
export type WorkspaceId = 'design' | 'grade' | 'fit' | 'prepare' | 'review';

export const WORKSPACE_IDS: readonly WorkspaceId[] = [
  'design',
  'grade',
  'fit',
  'prepare',
  'review',
];

export type ToolId = string;

export type ToolStatus = 'available' | 'planned';

export interface ToolDescriptor {
  readonly id: ToolId;
  readonly label: string;
  readonly hint: string;
  readonly status: ToolStatus;
  /** Single-key accelerator, when the tool has one. */
  readonly shortcut?: string;
}
