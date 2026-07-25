import type { ReactNode } from 'react';

/**
 * Inspector field primitives. Values render as read-only control shells so the
 * inspector reads like the real editor it will become, rather than a definition
 * list — but nothing here is editable until the drafting tools land.
 */

interface FieldProps {
  label: string;
  children: ReactNode;
  /** Span the full inspector width instead of sitting in the label/value grid. */
  wide?: boolean;
}

export const Field = ({ label, children, wide }: FieldProps) => (
  <div className="field" data-wide={wide || undefined}>
    <span className="field__label">{label}</span>
    <span className="field__control">{children}</span>
  </div>
);

interface ValueProps {
  value: string | number;
  unit?: string;
  tone?: 'default' | 'muted' | 'positive' | 'negative';
}

export const Value = ({ value, unit, tone = 'default' }: ValueProps) => (
  <span className="value" data-tone={tone}>
    <span className="value__text">{value}</span>
    {unit ? <span className="value__unit">{unit}</span> : null}
  </span>
);

/** Two or four values sharing one row — X/Y, W/H, and similar pairs. */
export const FieldRow = ({ children }: { children: ReactNode }) => (
  <div className="field-row">{children}</div>
);

interface PairProps {
  label: string;
  value: string | number;
  unit?: string;
}

export const Pair = ({ label, value, unit }: PairProps) => (
  <span className="pair">
    <span className="pair__label">{label}</span>
    <span className="value">
      <span className="value__text">{value}</span>
      {unit ? <span className="value__unit">{unit}</span> : null}
    </span>
  </span>
);

export const Toggle = ({ label, on }: { label: string; on: boolean }) => (
  <div className="field">
    <span className="field__label">{label}</span>
    <span className="field__control">
      <span className="toggle" data-on={on || undefined} role="img" aria-label={on ? 'Yes' : 'No'}>
        <span className="toggle__knob" />
      </span>
    </span>
  </div>
);

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <p className="empty-state">{children}</p>
);
