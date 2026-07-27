import { COMMANDS } from '@/commands/registry';
import { downloadText } from '@/io/download';
import { DXF_FILE_EXTENSION, DXF_MIME_TYPE, exportMarkerDxf } from '@/io/dxfExporter';
import { HPGL_FILE_EXTENSION, HPGL_MIME_TYPE, exportMarkerHpgl } from '@/io/hpglExporter';
import { MARKER_MIME_TYPE, markerFileName, serializeMarker } from '@/io/markerJson';
import { markerStatus } from '@/marker/selectors';
import type { CutterBuffer, MarkerDocument, RotationRule } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore, type DockTab } from '@/store/uiStore';

/** 282px right panel. Tab order matches the spec. */
const TABS: readonly { id: DockTab; label: string }[] = [
  { id: 'piece', label: 'Piece' },
  { id: 'order', label: 'Order' },
  { id: 'options', label: 'Options' },
  { id: 'keys', label: 'Keys' },
];

/**
 * Gestures have no command — there is no key event to dispatch — so they are
 * listed separately. Everything else comes from the registry, so the tab
 * cannot claim a shortcut that does not exist.
 */
const GESTURES: readonly { keys: string; label: string }[] = [
  { keys: 'Click', label: 'Select piece' },
  { keys: 'Shift+click', label: 'Add to / remove from selection' },
  { keys: 'Drag on fabric', label: 'Marquee select' },
  { keys: 'Drag piece', label: 'Move, with collision bounce-back' },
  { keys: 'Middle-drag', label: 'Pan' },
  { keys: '⌘K / Ctrl+K', label: 'Command palette' },
];

const CUTTER_BUFFERS: readonly CutterBuffer[] = [0, 0.3, 0.5, 1];
const ROTATION_RULES: readonly RotationRule[] = ['strict', '90ok', 'free'];

export const RightDock = () => {
  const document = useMarkerStore((state) => state.document);
  const dockTab = useUiStore((state) => state.dockTab);
  const setDockTab = useUiStore((state) => state.setDockTab);

  return (
    <aside className="dock">
      <header className="panel__header">
        <nav className="dock__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="dock__tab"
              data-active={dockTab === tab.id || undefined}
              onClick={() => setDockTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      <div className="dock__body">
        {!document ? null : dockTab === 'piece' ? (
          <PieceTab document={document} />
        ) : dockTab === 'order' ? (
          <OrderTab document={document} />
        ) : dockTab === 'options' ? (
          <OptionsTab document={document} />
        ) : (
          <KeysTab />
        )}
      </div>
    </aside>
  );
};

const PieceTab = ({ document }: { document: MarkerDocument }) => {
  const selection = useUiStore((state) => state.selection);
  const updatePiece = useMarkerStore((state) => state.updatePiece);

  const selected = document.pieces.filter((piece) => selection.includes(piece.id));
  const piece = selected[0];

  if (!piece) return <p className="dock__empty">Select a piece on the marker.</p>;

  return (
    <>
      {selected.length > 1 ? (
        <p className="dock__note">
          {selected.length} selected — editing {piece.name}.
        </p>
      ) : null}

      <Readout label="Name" value={piece.name} />
      <Readout label="Size" value={piece.size} />
      <Readout label="Bundle" value={piece.bundle} />
      <Readout label="Fabric" value={piece.fabricCode} />

      <NumberField
        label="X"
        value={piece.position.x}
        onChange={(x) => updatePiece(piece.id, { position: { ...piece.position, x } })}
      />
      <NumberField
        label="Y"
        value={piece.position.y}
        onChange={(y) => updatePiece(piece.id, { position: { ...piece.position, y } })}
      />
      <NumberField
        label="Rotation"
        value={piece.rotation}
        step={90}
        onChange={(rotation) => updatePiece(piece.id, { rotation })}
      />

      <label className="field field--check">
        <span className="field__label">Flipped</span>
        <input
          type="checkbox"
          checked={piece.flipped}
          onChange={(event) => updatePiece(piece.id, { flipped: event.target.checked })}
        />
      </label>
    </>
  );
};

const OrderTab = ({ document }: { document: MarkerDocument }) => {
  const status = markerStatus(document);
  return (
    <>
      <Readout label="Model" value={document.order.model || '—'} />
      <div className="dock__row dock__row--header">
        <span>Size</span>
        <span>Qty</span>
        <span>Fabric</span>
      </div>
      {document.order.sizes.length === 0 ? (
        <p className="dock__empty">No sizes on this order.</p>
      ) : (
        document.order.sizes.map((entry) => (
          <div key={`${entry.size}-${entry.fabricCode}`} className="dock__row">
            <span>{entry.size}</span>
            <span>{entry.quantity}</span>
            <span>{entry.fabricCode}</span>
          </div>
        ))
      )}
      <div className="dock__status" data-status={status}>
        {status}
      </div>
    </>
  );
};

const OptionsTab = ({ document }: { document: MarkerDocument }) => {
  const updateSettings = useMarkerStore((state) => state.updateSettings);

  return (
    <>
      <NumberField
        label="Fabric width"
        value={document.fabricWidth}
        min={1}
        onChange={(fabricWidth) => updateSettings({ fabricWidth })}
      />
      <NumberField
        label="End allowance"
        value={document.endAllowance}
        min={0}
        onChange={(endAllowance) => updateSettings({ endAllowance })}
      />

      <label className="field">
        <span className="field__label">Cutter buffer</span>
        <select
          className="field__input"
          value={String(document.cutterBuffer)}
          onChange={(event) => {
            const next = CUTTER_BUFFERS.find(
              (candidate) => String(candidate) === event.target.value,
            );
            if (next !== undefined) updateSettings({ cutterBuffer: next });
          }}
        >
          {CUTTER_BUFFERS.map((buffer) => (
            <option key={buffer} value={String(buffer)}>
              {buffer} cm
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">Rotation rule</span>
        <select
          className="field__input"
          value={document.rotationRule}
          onChange={(event) => {
            const next = ROTATION_RULES.find((candidate) => candidate === event.target.value);
            if (next) updateSettings({ rotationRule: next });
          }}
        >
          {ROTATION_RULES.map((rule) => (
            <option key={rule} value={rule}>
              {rule}
            </option>
          ))}
        </select>
      </label>

      {/*
        TODO(ply-direction): belongs in this tab, but MarkerDocument has no
        field for it, so there is nothing to bind a control to.
      */}

      <ExportSection document={document} />
    </>
  );
};

const ExportSection = ({ document }: { document: MarkerDocument }) => {
  const setStatus = useUiStore((state) => state.setStatus);

  // The marker's own name, minus its .marker.json suffix.
  const base = markerFileName(document).replace(/\.marker\.json$/, '');
  const empty = document.pieces.length === 0;

  const save = (extension: string, mimeType: string, build: () => string, label: string) => {
    try {
      downloadText(`${base}${extension}`, build(), mimeType);
      setStatus('ok', `Exported ${base}${extension}`);
    } catch (error) {
      setStatus('error', `${label} export failed: ${error instanceof Error ? error.message : ''}`);
    }
  };

  return (
    <>
      <div className="dock__row dock__row--header">
        <span>Export</span>
      </div>

      {empty ? <p className="dock__empty">Place a piece before exporting.</p> : null}

      <div className="dock__actions">
        <button
          type="button"
          className="topbar__button"
          disabled={empty}
          title="AAMA DXF (R12) for AccuMark and other cutting-room systems"
          onClick={() => save(DXF_FILE_EXTENSION, DXF_MIME_TYPE, () => exportMarkerDxf(document), 'DXF')}
        >
          DXF
        </button>
        <button
          type="button"
          className="topbar__button"
          disabled={empty}
          title="HPGL cut data, 1 plotter unit = 0.025 mm"
          onClick={() =>
            save(HPGL_FILE_EXTENSION, HPGL_MIME_TYPE, () => exportMarkerHpgl(document), 'HPGL')
          }
        >
          HPGL
        </button>
        <button
          type="button"
          className="topbar__button"
          title="Native format — reopens with everything intact"
          onClick={() =>
            save('.marker.json', MARKER_MIME_TYPE, () => serializeMarker(document), 'Marker')
          }
        >
          .marker.json
        </button>
      </div>
    </>
  );
};

const KeysTab = () => (
  <table className="keys">
    <tbody>
      {COMMANDS.map((command) => (
        <tr key={command.id}>
          <th scope="row">{command.keys}</th>
          <td>{command.label}</td>
        </tr>
      ))}
      {GESTURES.map((gesture) => (
        <tr key={gesture.keys}>
          <th scope="row">{gesture.keys}</th>
          <td>{gesture.label}</td>
        </tr>
      ))}
    </tbody>
  </table>
);

const Readout = ({ label, value }: { label: string; value: string }) => (
  <div className="field">
    <span className="field__label">{label}</span>
    <span className="field__readout">{value}</span>
  </div>
);

const NumberField = ({
  label,
  value,
  onChange,
  step = 1,
  min,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
}) => (
  <label className="field">
    <span className="field__label">{label}</span>
    <input
      type="number"
      className="field__input"
      value={Number.isFinite(value) ? Number(value.toFixed(2)) : 0}
      step={step}
      {...(min === undefined ? {} : { min })}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
  </label>
);
