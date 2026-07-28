import { useEffect, useRef, useState } from 'react';
import { DEFAULT_FABRIC_WIDTH, DEFAULT_MARKER_NAME } from '@/marker/newMarker';

/**
 * Name and fabric width for a blank marker.
 *
 * Only these two: everything else has a sensible default and can be changed in
 * the Options tab, and a dialog that asks eight questions before you can draw
 * anything is a dialog people learn to dread.
 */

export interface NewMarkerValues {
  readonly name: string;
  readonly fabricWidth: number;
}

export const NewMarkerDialog = ({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (values: NewMarkerValues) => void;
}) => {
  const [name, setName] = useState(DEFAULT_MARKER_NAME);
  const [width, setWidth] = useState(String(DEFAULT_FABRIC_WIDTH));
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  const parsedWidth = Number(width);
  const widthValid = Number.isFinite(parsedWidth) && parsedWidth > 0;

  const submit = () => {
    if (!widthValid) return;
    onCreate({ name, fabricWidth: parsedWidth });
  };

  return (
    <div className="palette" role="dialog" aria-modal="true" aria-label="New blank marker">
      <div className="palette__backdrop" onClick={onCancel} />
      <div className="palette__panel dialog">
        <h2 className="dialog__title">New blank marker</h2>

        <label className="dialog__field">
          <span className="field__label">Name</span>
          <input
            ref={nameRef}
            type="text"
            className="field__input dialog__input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit();
            }}
          />
        </label>

        <label className="dialog__field">
          <span className="field__label">Fabric width</span>
          <span className="dialog__with-unit">
            <input
              type="number"
              className="field__input dialog__input"
              value={width}
              min={1}
              step={1}
              onChange={(event) => setWidth(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submit();
              }}
            />
            <span className="stat__unit">cm</span>
          </span>
        </label>

        {!widthValid ? (
          <p className="dialog__error">Fabric width must be a number greater than zero.</p>
        ) : null}

        <div className="dialog__actions">
          <button type="button" className="topbar__button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="topbar__button topbar__button--primary"
            onClick={submit}
            disabled={!widthValid}
          >
            Create marker
          </button>
        </div>
      </div>
    </div>
  );
};
