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

const SHORTCUTS: readonly { keys: string; action: string }[] = [
  { keys: 'R / Shift+R', action: 'Rotate CW / CCW' },
  { keys: 'F / Shift+F', action: 'Flip horizontal / vertical' },
  { keys: 'Arrows', action: 'Nudge 1 cm' },
  { keys: 'Shift+Arrows', action: 'Nudge 1 mm' },
  { keys: 'L / U', action: 'Butt-slide left / up' },
  { keys: 'Delete', action: 'Return piece to tray' },
  { keys: 'Shift+click', action: 'Add to selection' },
  { keys: 'Alt+click', action: 'Select bundle' },
  { keys: 'Esc', action: 'Deselect all' },
  { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / Redo' },
  { keys: '+ / - / 0', action: 'Zoom in / out / fit' },
  { keys: 'Middle-drag', action: 'Pan' },
  { keys: '⌘K', action: 'Command palette' },
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
        TODO(step-10): ply direction belongs here, and the DXF/HPGL export
        buttons. Ply direction has no field on MarkerDocument yet, so there is
        nothing to bind a control to.
      */}
    </>
  );
};

const KeysTab = () => (
  <table className="keys">
    <tbody>
      {SHORTCUTS.map((shortcut) => (
        <tr key={shortcut.keys}>
          <th scope="row">{shortcut.keys}</th>
          <td>{shortcut.action}</td>
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
