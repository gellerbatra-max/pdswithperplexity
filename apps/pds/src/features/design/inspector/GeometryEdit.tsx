import { Choice, Field, NumberInput, Toggle, Value } from '@/components/Field';
import { PanelSection } from '@/components/PanelSection';
import {
  findPoint,
  findSegment,
  lengthAlongSegment,
  pointRemovalBlocker,
  segmentLength,
  type NotchKind,
  type PatternPiece,
} from '@/pattern';
import {
  deletePoint,
  insertPoint,
  pieceRef,
  pointRef,
  removeNotch,
  setNotchDistance,
  setNotchKind,
  setPointPosition,
  setPointRole,
  setSegmentKind,
  setSegmentSeamAllowance,
  useSelectionStore,
  type SelectionRef,
} from '@/store';

/**
 * Numeric editing for whichever point or segment is selected.
 *
 * Deliberately small: the canvas is where geometry is shaped, and this is the
 * place to type an exact number when dragging cannot be precise enough. Every
 * control writes through a command in `store/geometryCommands.ts`.
 */

/** The notch shapes the model supports, in the order a pattern maker meets them. */
const NOTCH_KINDS: readonly NotchKind[] = ['slit', 'v', 'castle', 'u', 't'];

/** Small bordered action, matching the AI suggestion buttons already in the panel. */
const PanelAction = ({
  label,
  title,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) => (
  <div className="panel-actions">
    <button type="button" title={title} disabled={disabled} onClick={onClick}>
      {label}
    </button>
  </div>
);

const PointEditor = ({
  piece,
  ref,
  onSelectPiece,
}: {
  piece: PatternPiece;
  ref: SelectionRef & { kind: 'point' };
  onSelectPiece: () => void;
}) => {
  const point = findPoint(piece, ref.pointId);
  if (!point) return null;

  // Asked before offering the action, so the control can say why it is refused
  // rather than looking available and doing nothing.
  const blocker = pointRemovalBlocker(piece, point.id);

  return (
    /* One field per row rather than a FieldRow pair: FieldRow splits the panel
       in two and each Field still reserves an 84px label column, which leaves
       the input with no width to render into. */
    <PanelSection title="Point" caption={point.label ?? point.role}>
      <Field label="X">
        <NumberInput
          label="Point X"
          value={Number(point.position.x.toFixed(2))}
          unit="mm"
          step={1}
          onCommit={(x) => setPointPosition(piece.id, point.id, { x, y: point.position.y })}
        />
      </Field>
      <Field label="Y">
        <NumberInput
          label="Point Y"
          value={Number(point.position.y.toFixed(2))}
          unit="mm"
          step={1}
          onCommit={(y) => setPointPosition(piece.id, point.id, { x: point.position.x, y })}
        />
      </Field>
      {/* Construction points sit off the outline and have no handles to keep
          smooth, so the choice is only offered where it means something. */}
      {point.role === 'corner' || point.role === 'curve' ? (
        <Choice
          label="Role"
          value={point.role}
          options={[
            { value: 'corner', label: 'Corner', title: 'Edges may meet at an angle here' },
            { value: 'curve', label: 'Smooth', title: 'Keep the two edges tangent here' },
          ]}
          onChange={(role) => setPointRole(piece.id, point.id, role)}
        />
      ) : (
        <Field label="Role">
          <Value value={point.role} />
        </Field>
      )}
      {/* Merging the two edges that meet here changes the outline — see
          `removePoint` — so the selection falls back to the piece rather than
          leaving a ref pointing at a point that no longer exists. */}
      <PanelAction
        label="Delete point"
        title={blocker ?? 'Merge the two edges meeting at this point'}
        disabled={blocker !== null}
        onClick={() => {
          if (deletePoint(piece.id, point.id)) onSelectPiece();
        }}
      />
    </PanelSection>
  );
};

const SegmentEditor = ({
  piece,
  ref,
  onSelectPoint,
}: {
  piece: PatternPiece;
  ref: SelectionRef & { kind: 'segment' };
  onSelectPoint: (pointId: string) => void;
}) => {
  const segment = findSegment(piece, ref.segmentId);
  if (!segment) return null;

  const curved = segment.geometry.kind === 'cubic';
  const overridden = segment.seamAllowance !== undefined;
  const allowance = segment.seamAllowance ?? piece.seamAllowance;
  const notches = piece.notches.filter((notch) => notch.segmentId === segment.id);
  const seamLength = segmentLength(piece, segment);

  return (
    <PanelSection title="Edge" caption={segment.label ?? 'Edge'}>
      <Field label="Length">
        <Value value={seamLength.toFixed(1)} unit="mm" />
      </Field>
      {/* Three real geometries, not a boolean. An arc is what DXF carries for
          most curved seams, so it has to be reachable rather than latent. */}
      <Choice
        label="Shape"
        value={segment.geometry.kind}
        options={[
          { value: 'line', label: 'Line', title: 'Straight between the endpoints' },
          { value: 'cubic', label: 'Curve', title: 'Bézier with draggable handles' },
          { value: 'arc', label: 'Arc', title: 'Circular arc through the endpoints' },
        ]}
        onChange={(kind) => setSegmentKind(piece.id, segment.id, kind)}
      />
      {/* Clearing the override restores the piece default. Zero is a real
          allowance — a net-cut edge — so it must stay distinct from "inherit". */}
      <Toggle
        label="Own allowance"
        on={overridden}
        onChange={(next) =>
          setSegmentSeamAllowance(piece.id, segment.id, next ? piece.seamAllowance : undefined)
        }
      />
      <Field label="Allowance">
        {overridden ? (
          <NumberInput
            label="Edge seam allowance"
            value={allowance}
            unit="mm"
            min={0}
            step={1}
            onCommit={(next) => setSegmentSeamAllowance(piece.id, segment.id, next)}
          />
        ) : (
          <Value value={`${allowance.toFixed(1)} (piece)`} tone="muted" unit="mm" />
        )}
      </Field>
      {/* Splits at the middle. Double-clicking the edge on the canvas splits
          where you click, which is what you usually want — this is the version
          for when you want the midpoint exactly. */}
      <PanelAction
        label="Insert point at middle"
        title="Split this edge in two, leaving the outline unchanged"
        onClick={() => {
          const pointId = insertPoint(piece.id, segment.id, 0.5);
          if (pointId) onSelectPoint(pointId);
        }}
      />
      {/* Only shown once the edge actually carries notches, so the panel stays
          quiet on the edges that do not. Positions read in millimetres from the
          seam start, which is how a spec sheet states them — the stored value
          is a curve parameter, which is the wrong unit to think in. */}
      {notches.length > 0 ? (
        <ul className="notch-list">
          {notches.map((notch) => (
            <li key={notch.id}>
              <select
                aria-label="Notch type"
                value={notch.kind}
                onChange={(event) =>
                  setNotchKind(piece.id, notch.id, event.target.value as NotchKind)
                }
              >
                {NOTCH_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <NumberInput
                label="Notch distance along seam"
                value={Number(lengthAlongSegment(piece, segment, notch.t).toFixed(2))}
                unit="mm"
                min={0}
                max={Number(seamLength.toFixed(2))}
                step={1}
                onCommit={(mm) => setNotchDistance(piece.id, notch.id, mm)}
              />
              <button
                type="button"
                title="Remove this notch"
                onClick={() => removeNotch(piece.id, notch.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {curved ? (
        <p className="muted table-note">Drag the diamond handles to reshape this edge.</p>
      ) : null}
      <p className="muted table-note">
        Double-click an edge to add a point; hold Alt to add a notch.
      </p>
    </PanelSection>
  );
};

export const GeometryEdit = ({ pieces }: { pieces: readonly PatternPiece[] }) => {
  const primary = useSelectionStore((s) => s.primary);
  const select = useSelectionStore((s) => s.select);
  if (!primary || primary.kind === 'piece') return null;

  const piece = pieces.find((p) => p.id === primary.pieceId);
  if (!piece) return null;

  return primary.kind === 'point' ? (
    <PointEditor
      piece={piece}
      ref={primary}
      onSelectPiece={() => select(pieceRef(piece.id), false)}
    />
  ) : (
    <SegmentEditor
      piece={piece}
      ref={primary}
      onSelectPoint={(pointId) => select(pointRef(piece.id, pointId), false)}
    />
  );
};
