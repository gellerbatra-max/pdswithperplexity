import type { ReactNode } from 'react';

export type IconName =
  | 'design'
  | 'grade'
  | 'fit'
  | 'prepare'
  | 'review'
  | 'search'
  | 'undo'
  | 'redo'
  | 'comment'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'check'
  | 'cloud'
  | 'dot'
  | 'grid'
  | 'panel-left'
  | 'panel-right';

/**
 * Inline 16px stroke icons on a 24 grid. Kept in-repo rather than pulled from an
 * icon package so the shell has no runtime dependency for its chrome.
 */
const GLYPHS: Record<IconName, ReactNode> = {
  design: (
    <>
      <path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 013 3L8 19l-4 1z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
  grade: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 15v5h-5" />
      <path d="M4 4l7 7" />
      <path d="M20 20l-7-7" />
    </>
  ),
  fit: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  prepare: (
    <>
      <path d="M12 3l8 4.5-8 4.5-8-4.5L12 3z" />
      <path d="M4 12.5L12 17l8-4.5" />
      <path d="M4 17L12 21.5 20 17" />
    </>
  ),
  review: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.5 2.5 4.5-5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  undo: (
    <>
      <path d="M4 9h10a5 5 0 010 10h-5" />
      <path d="M8 5L4 9l4 4" />
    </>
  ),
  redo: (
    <>
      <path d="M20 9H10a5 5 0 000 10h5" />
      <path d="M16 5l4 4-4 4" />
    </>
  ),
  comment: (
    <>
      <path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 014 14.5z" />
    </>
  ),
  'chevron-down': <path d="M6 9.5l6 6 6-6" />,
  'chevron-left': <path d="M14.5 6l-6 6 6 6" />,
  'chevron-right': <path d="M9.5 6l6 6-6 6" />,
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  cloud: (
    <>
      <path d="M7 18a4 4 0 01-.4-8A6 6 0 0118 10.5 3.75 3.75 0 0117.5 18z" />
      <path d="M9.5 13.5l2 2 3.5-4" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="4" />,
  grid: (
    <>
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  'panel-left': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M10 4.5v15" />
    </>
  ),
  'panel-right': (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14 4.5v15" />
    </>
  ),
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export const Icon = ({ name, size = 16, className }: IconProps) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {GLYPHS[name]}
  </svg>
);
