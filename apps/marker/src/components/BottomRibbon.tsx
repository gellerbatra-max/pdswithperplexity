import { useEffect, useState, type ReactNode } from 'react';
import { consumption, markerLength, markerStatus, utilization } from '@/marker/selectors';
import { utilisationBand, utilisationFill } from '@/marker/utilisation';
import { useMarkerStore } from '@/store/markerStore';

/**
 * 48px footer: the numbers a marker maker watches while placing.
 *
 * Everything except the width is derived from the document, so the readouts
 * follow a drag without any wiring of their own.
 */

const Stat = ({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) => (
  <div className="stat" data-wide={wide || undefined}>
    <span className="stat__label">{label}</span>
    <div className="stat__body">{children}</div>
  </div>
);

/**
 * Fabric width, committed on blur or Enter rather than per keystroke.
 *
 * Typing "150" into a live-committing field sets the width to 1, then 15, then
 * 150 — three resizes of the fabric, three undo entries, and two moments where
 * pieces sat outside a marker briefly narrower than they are. It also made the
 * field impossible to clear, since an empty string is not a valid width.
 */
const WidthField = ({ value }: { value: number }) => {
  const setFabricWidth = useMarkerStore((state) => state.setFabricWidth);
  const [draft, setDraft] = useState(String(value));

  // Follow the document when the width changes elsewhere — undo, a reopened
  // marker — but never while the field has focus and a half-typed number.
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const next = Number(draft);
    if (Number.isFinite(next) && next > 0) setFabricWidth(next);
    else setDraft(String(value));
  };

  return (
    <label className="stat__field">
      <input
        type="number"
        className="stat__input"
        value={draft}
        min={1}
        step={1}
        aria-label="Fabric width in centimetres"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit();
            event.currentTarget.blur();
          }
          if (event.key === 'Escape') {
            setDraft(String(value));
            event.currentTarget.blur();
          }
        }}
      />
      <span className="stat__unit">cm</span>
    </label>
  );
};

export const BottomRibbon = () => {
  const document = useMarkerStore((state) => state.document);

  if (!document) return <footer className="ribbon" />;

  const status = markerStatus(document);
  const percent = utilization(document);
  const band = utilisationBand(percent);

  return (
    <footer className="ribbon">
      <div className="ribbon__identity">
        <span className="ribbon__name" title={document.name}>
          {document.name}
        </span>
        <span className="ribbon__chip">{document.order.model || 'No order'}</span>
      </div>

      <div className="ribbon__stats">
        <Stat label="Width">
          <WidthField value={document.fabricWidth} />
        </Stat>

        <Stat label="Length">
          <span className="stat__value">
            {markerLength(document).toFixed(1)}
            <span className="stat__unit">cm</span>
          </span>
        </Stat>

        <Stat label="Utilisation" wide>
          <span className="stat__value" data-band={band}>
            {percent.toFixed(1)}
            <span className="stat__unit">%</span>
          </span>
          {/*
            The bar carries its band in an attribute rather than only in
            colour, so the state is readable to a screen reader and to anyone
            who cannot separate the three hues.
          */}
          <span
            className="util"
            role="meter"
            aria-valuenow={Math.round(percent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Utilisation ${percent.toFixed(1)} percent, ${band}`}
            data-band={band}
          >
            <span className="util__fill" style={{ width: `${utilisationFill(percent)}%` }} />
          </span>
        </Stat>

        <Stat label="Consumption">
          <span className="stat__value">
            {consumption(document).toFixed(3)}
            <span className="stat__unit">m</span>
          </span>
        </Stat>
      </div>

      <span className="ribbon__status" data-status={status}>
        {status}
      </span>
    </footer>
  );
};
