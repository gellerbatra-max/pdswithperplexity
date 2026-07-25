import { BoundsOps } from '@/geometry';
import { documentBounds, pieceBounds } from '@/pattern';
import { useDocumentStore, useSelectionStore, useViewportStore } from '@/store';

const MAP_WIDTH = 168;
const MAP_HEIGHT = 104;
const PADDING = 8;

/**
 * Document overview. Draws piece bounding boxes plus the current viewport rect —
 * enough to orient at any zoom. Click-to-navigate arrives with the pan tool.
 */
export const MiniMap = () => {
  const doc = useDocumentStore((s) => s.document);
  const pieces = doc.pieces;
  const selectedPieceIds = useSelectionStore((s) => s.selectedPieceIds);
  const camera = useViewportStore((s) => s.camera);

  const docBounds = documentBounds(doc);
  if (BoundsOps.isEmpty(docBounds)) return null;

  const docWidth = docBounds.maxX - docBounds.minX;
  const docHeight = docBounds.maxY - docBounds.minY;
  const scale = Math.min(
    (MAP_WIDTH - PADDING * 2) / docWidth,
    (MAP_HEIGHT - PADDING * 2) / docHeight,
  );

  const offsetX = (MAP_WIDTH - docWidth * scale) / 2;
  const offsetY = (MAP_HEIGHT - docHeight * scale) / 2;
  const toMapX = (x: number): number => offsetX + (x - docBounds.minX) * scale;
  const toMapY = (y: number): number => offsetY + (y - docBounds.minY) * scale;

  const stage = document.querySelector<HTMLCanvasElement>('.stage');
  const rect = stage?.getBoundingClientRect();
  const viewport = rect
    ? {
        x: toMapX(camera.x),
        y: toMapY(camera.y),
        width: (rect.width / camera.zoom) * scale,
        height: (rect.height / camera.zoom) * scale,
      }
    : null;

  return (
    <div className="minimap" aria-label="Document overview">
      <svg width={MAP_WIDTH} height={MAP_HEIGHT} role="img" aria-hidden="true">
        {pieces.map((piece) => {
          const b = pieceBounds(piece);
          return (
            <rect
              key={piece.id}
              className="minimap__piece"
              data-active={selectedPieceIds.has(piece.id) || undefined}
              x={toMapX(b.minX)}
              y={toMapY(b.minY)}
              width={Math.max(1, (b.maxX - b.minX) * scale)}
              height={Math.max(1, (b.maxY - b.minY) * scale)}
              rx={1}
            />
          );
        })}
        {viewport ? (
          <rect
            className="minimap__viewport"
            x={viewport.x}
            y={viewport.y}
            width={viewport.width}
            height={viewport.height}
          />
        ) : null}
      </svg>
      <span className="minimap__label">Overview</span>
    </div>
  );
};
