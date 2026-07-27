import {
  consumption,
  markerLength,
  markerStatus,
  utilization,
} from '@/marker/selectors';
import { useMarkerStore } from '@/store/markerStore';

/**
 * 48px footer strip: the numbers a marker maker watches while placing.
 *
 * Everything here is derived from the document, so it updates on every drag
 * without any wiring of its own.
 */
export const BottomRibbon = () => {
  const document = useMarkerStore((state) => state.document);
  const setFabricWidth = useMarkerStore((state) => state.setFabricWidth);

  if (!document) return <footer className="ribbon" />;

  const status = markerStatus(document);

  return (
    <footer className="ribbon">
      <span className="ribbon__name">{document.name}</span>
      <span className="ribbon__chip">{document.order.model || 'No order'}</span>

      <label className="ribbon__field">
        <span className="ribbon__label">Width</span>
        <input
          type="number"
          className="ribbon__input"
          value={document.fabricWidth}
          min={1}
          step={1}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && next > 0) setFabricWidth(next);
          }}
        />
        <span className="ribbon__unit">cm</span>
      </label>

      <span className="ribbon__spacer" />

      <span className="ribbon__stat">
        <span className="ribbon__label">Length</span>
        <span className="ribbon__value">{markerLength(document).toFixed(1)} cm</span>
      </span>

      <span className="ribbon__stat">
        <span className="ribbon__label">Utilisation</span>
        <span className="ribbon__value">{utilization(document).toFixed(1)}%</span>
      </span>

      <span className="ribbon__stat">
        <span className="ribbon__label">Consumption</span>
        <span className="ribbon__value">{consumption(document).toFixed(3)} m</span>
      </span>

      <span className="ribbon__status" data-status={status}>
        {status}
      </span>
    </footer>
  );
};
