import type { WorkspaceModule } from '../types';
import { ReviewContext } from './ReviewContext';
import { ReviewPanel } from './ReviewPanel';
import { ReviewStage } from './ReviewStage';

/** Verification and sign-off: audits, comments, revisions, approvals. */
export const reviewWorkspace: WorkspaceModule = {
  id: 'review',
  title: 'Review',
  summary: 'Verify the pattern and collect sign-off.',
  icon: 'review',
  Context: ReviewContext,
  Stage: ReviewStage,
  Panel: ReviewPanel,
  tools: [
    { id: 'select', icon: 'cursor', label: 'Select', hint: 'Pick pieces to review', status: 'available', shortcut: 'V' },
    { id: 'verify', icon: 'check', label: 'Verify', hint: 'Seam, notch and grain checks', status: 'planned' },
    { id: 'comment', icon: 'comment', label: 'Comment', hint: 'Pin a note to the canvas', status: 'planned' },
    { id: 'revisions', icon: 'clock', label: 'Revisions', hint: 'Compare against history', status: 'planned' },
    { id: 'audit', icon: 'piece', label: 'Audit report', hint: 'Generate a PDF summary', status: 'planned' },
  ],
};

export { ReviewContext, ReviewStage, ReviewPanel };
