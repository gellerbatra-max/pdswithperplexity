import { useState, type ReactNode } from 'react';

/**
 * Inspector field primitives.
 *
 * `Value` and the read-only `Toggle` are display shells, used where a field is
 * derived from elsewhere in the document. `TextInput`, `NumberInput` and a
 * `Toggle` given an `onChange` are the editable counterparts; they share the
 * `.value` box so an editable field is visually continuous with a read-only
 * one, and only the caret and hover state tell them apart.
 *
 * The editable variants hold a local draft string while focused. Without it, a
 * controlled input backed by a number cannot represent the intermediate states
 * typing goes through — an empty field, or a lone "-" — because each keystroke
 * would be parsed and written straight back over what the user typed. The
 * draft is dropped on blur, so the field always re-syncs to the document.
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

interface TextInputProps {
  value: string;
  label: string;
  /** Rejected values leave the field alone and it snaps back on blur. */
  onCommit: (next: string) => void;
}

/** Single-line text bound to a document field. Empty input is never committed. */
export const TextInput = ({ value, label, onCommit }: TextInputProps) => {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <span className="value value--editable">
      <input
        className="value__input"
        aria-label={label}
        spellCheck={false}
        value={draft ?? value}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next.trim() !== '') onCommit(next);
        }}
        onBlur={() => setDraft(null)}
      />
    </span>
  );
};

interface NumberInputProps {
  value: number;
  label: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  onCommit: (next: number) => void;
}

/** Numeric field. Only finite, in-range values reach `onCommit`. */
export const NumberInput = ({
  value,
  label,
  unit,
  min,
  max,
  step,
  onCommit,
}: NumberInputProps) => {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <span className="value value--editable">
      <input
        className="value__input"
        type="number"
        inputMode="decimal"
        aria-label={label}
        value={draft ?? String(value)}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        {...(step !== undefined ? { step } : {})}
        onChange={(event) => {
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() === '') return;
          const next = Number(raw);
          if (!Number.isFinite(next)) return;
          if (min !== undefined && next < min) return;
          if (max !== undefined && next > max) return;
          onCommit(next);
        }}
        onBlur={() => setDraft(null)}
      />
      {unit ? <span className="value__unit">{unit}</span> : null}
    </span>
  );
};

interface ChoiceProps<T extends string> {
  label: string;
  value: T;
  options: readonly { readonly value: T; readonly label: string; readonly title?: string }[];
  onChange: (next: T) => void;
}

/**
 * A short row of mutually exclusive options.
 *
 * Used where a boolean would lie — an edge is straight, Bézier *or* circular,
 * and a point is a corner or smooth. Two or three choices fit the inspector's
 * width, which is the point at which this stops being appropriate.
 */
export const Choice = <T extends string>({ label, value, options, onChange }: ChoiceProps<T>) => (
  <div className="field">
    <span className="field__label">{label}</span>
    <span className="field__control">
      <span className="choice" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-active={option.value === value || undefined}
            aria-pressed={option.value === value}
            {...(option.title ? { title: option.title } : {})}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </span>
    </span>
  </div>
);

interface ToggleProps {
  label: string;
  on: boolean;
  /** Omit to render the read-only display form. */
  onChange?: (next: boolean) => void;
}

export const Toggle = ({ label, on, onChange }: ToggleProps) => (
  <div className="field">
    <span className="field__label">{label}</span>
    <span className="field__control">
      {onChange ? (
        <button
          type="button"
          className="toggle toggle--interactive"
          data-on={on || undefined}
          aria-label={label}
          aria-pressed={on}
          onClick={() => onChange(!on)}
        >
          <span className="toggle__knob" />
        </button>
      ) : (
        <span className="toggle" data-on={on || undefined} role="img" aria-label={on ? 'Yes' : 'No'}>
          <span className="toggle__knob" />
        </span>
      )}
    </span>
  </div>
);

export const EmptyState = ({ children }: { children: ReactNode }) => (
  <p className="empty-state">{children}</p>
);
