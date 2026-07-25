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
  | 'panel-right'
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'plus'
  | 'minus'
  | 'maximize'
  | 'sparkle'
  | 'clock'
  | 'library'
  | 'layers'
  | 'piece'
  | 'ruler'
  | 'folder';

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
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M9.9 5.8A8.5 8.5 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.8 3.6" />
      <path d="M6.3 7.7A16.7 16.7 0 002.5 12S6 18.5 12 18.5a8.9 8.9 0 003.9-.9" />
      <path d="M4 4l16 16" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 017.5 0v2.75" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.25 10.5V7.75a3.75 3.75 0 017.09-1.75" />
    </>
  ),
  plus: <path d="M12 5.5v13M5.5 12h13" />,
  minus: <path d="M5.5 12h13" />,
  maximize: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 15v5h-5" />
      <path d="M15 4h5v5" />
      <path d="M9 20H4v-5" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7v5.2l3.2 1.9" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="4.5" width="5" height="15" rx="1.5" />
      <rect x="10.5" y="4.5" width="5" height="15" rx="1.5" />
      <path d="M17.8 5.6l3 14.2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 12.5L12 17l8.5-4.5" />
      <path d="M3.5 16.8L12 21.3l8.5-4.5" />
    </>
  ),
  piece: (
    <>
      <path d="M5 4.5h9l5 5v10a1 1 0 01-1 1H5a1 1 0 01-1-1v-14a1 1 0 011-1z" />
      <path d="M13.5 4.5v5.5H19" />
    </>
  ),
  ruler: (
    <>
      <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
      <path d="M7 8v3M11 8v4M15 8v3M19 8v4" />
    </>
  ),
  folder: <path d="M3.5 7a1.5 1.5 0 011.5-1.5h4l2 2.5h7A1.5 1.5 0 0119.5 9.5v8A1.5 1.5 0 0118 19H5a1.5 1.5 0 01-1.5-1.5z" />,
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
