import { useCallback, useEffect, useRef, useState } from 'react';
import { MarkerCanvas } from '@/canvas/MarkerCanvas';
import { boundsOf } from '@/canvas/collision/aabb';
import { resolveDragPosition } from '@/canvas/tools/DragTool';
import { commandForKey } from '@/commands/registry';
import { importDxfFile } from '@/io/dxfImporter';
import type { PlacedPiece } from '@/marker/schema';
import { useMarkerStore } from '@/store/markerStore';
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_ZOOM, useViewportStore } from '@/store/viewportStore';
import { TRAY_DRAG_TYPE } from './PieceTray';

/**
 * Hosts the imperative Konva canvas.
 *
 * This is the one component that talks to MarkerCanvas. It pushes store state
 * in and routes canvas events back out, so the canvas itself never imports a
 * store and the rest of the shell never touches Konva.
 */

/** Extensions the drop handler recognises, lower-cased. */
const DXF_EXTENSION = '.dxf';
const RUL_EXTENSION = '.rul';

export const MarkerStage = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  /** What is hovering the stage, so the hint can say what will happen. */
  const [dropActive, setDropActive] = useState<'file' | 'piece' | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  /**
   * Place a tray piece where it was dropped.
   *
   * The drop point becomes the piece's centre rather than its origin — you aim
   * at where the piece should sit, not at a corner you cannot see. The result
   * goes through the same collision resolution a drag uses, so a piece dropped
   * onto a neighbour settles beside it instead of landing in violation.
   */
  const dropTrayPiece = useCallback((trayPieceId: string, clientX: number, clientY: number) => {
    const container = containerRef.current;
    const marker = useMarkerStore.getState().document;
    if (!container || !marker) return;

    const tray = marker.trayPieces.find((piece) => piece.id === trayPieceId);
    if (!tray) return;

    const rect = container.getBoundingClientRect();
    const { zoom, panX, panY } = useViewportStore.getState();
    const at = {
      x: (clientX - rect.left - panX) / zoom,
      y: marker.fabricWidth - (clientY - rect.top - panY) / zoom,
    };

    const bounds = boundsOf(tray.geometry);
    const centred = {
      x: at.x - (bounds.minX + bounds.maxX) / 2,
      y: at.y - (bounds.minY + bounds.maxY) / 2,
    };

    const provisional: PlacedPiece = {
      id: `provisional-${tray.id}`,
      pieceDefId: tray.id,
      name: tray.name,
      size: tray.size,
      bundle: tray.bundle,
      fabricCode: tray.fabricCode,
      geometry: tray.geometry,
      position: centred,
      rotation: 0,
      flipped: false,
      placed: true,
      blocked: false,
    };

    const resolved = resolveDragPosition(marker, provisional, centred);
    useMarkerStore.getState().placeFromTray(tray.id, resolved);
    useUiStore.getState().setStatus('ok', `Placed ${tray.name} ${tray.size}`);
  }, []);

  const onDrop = useCallback(async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDropActive(null);

    // A tray row before a file: the row carries no files, and checking files
    // first would silently swallow the drop.
    const trayPieceId = event.dataTransfer.getData(TRAY_DRAG_TYPE);
    if (trayPieceId !== '') {
      dropTrayPiece(trayPieceId, event.clientX, event.clientY);
      return;
    }

    const files = [...event.dataTransfer.files];
    const dxf = files.find((file) => file.name.toLowerCase().endsWith(DXF_EXTENSION));
    const rul = files.find((file) => file.name.toLowerCase().endsWith(RUL_EXTENSION));
    const { setStatus } = useUiStore.getState();

    if (!dxf) {
      setStatus('warn', 'Drop a .dxf file (optionally with its .rul alongside)');
      return;
    }

    setProgress(0);
    setStatus('info', `Reading ${dxf.name}…`);

    try {
      const [dxfText, rulText] = await Promise.all([dxf.text(), rul?.text()]);
      const outcome = await importDxfFile({
        dxfText,
        ...(rulText === undefined ? {} : { rulText }),
        onProgress: setProgress,
      });

      useMarkerStore.getState().addTrayPieces(outcome.pieces);

      // Warnings are the point of a tolerant importer — surfacing "24 pieces"
      // while silently dropping six would be the wrong kind of quiet.
      const summary = `Imported ${outcome.pieces.length} piece(s) from ${dxf.name}`;
      if (outcome.warnings.length > 0) {
        setStatus('warn', `${summary} — ${outcome.warnings.length} warning(s): ${outcome.warnings[0] ?? ''}`);
        for (const warning of outcome.warnings) console.warn('[dxf]', warning);
      } else {
        setStatus('ok', summary);
      }
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : 'DXF import failed');
    } finally {
      setProgress(null);
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const canvas = new MarkerCanvas(container, {
      onPanBy: (dx, dy) => {
        const { panX, panY, setPan } = useViewportStore.getState();
        setPan(panX + dx, panY + dy);
      },
      onStageResize: (width, height) => useViewportStore.getState().setStageSize(width, height),
      onPieceMoved: (pieceId, position) =>
        useMarkerStore.getState().updatePiece(pieceId, { position }),
      onPieceSelected: (pieceId, additive, bundle) => {
        const ui = useUiStore.getState();
        if (bundle) {
          // Alt+click takes the whole bundle: every piece cut from the same
          // lay, which is how a marker maker thinks about moving work.
          const marker = useMarkerStore.getState().document;
          const clicked = marker?.pieces.find((piece) => piece.id === pieceId);
          if (marker && clicked) {
            ui.setSelection(
              marker.pieces.filter((p) => p.bundle === clicked.bundle).map((p) => p.id),
            );
            return;
          }
        }
        // Shift toggles, so a piece added by mistake comes off the same way.
        if (additive) {
          const current = ui.selection;
          if (current.includes(pieceId)) {
            ui.setSelection(current.filter((id) => id !== pieceId));
          } else {
            ui.addToSelection(pieceId);
          }
          return;
        }
        if (!ui.selection.includes(pieceId)) ui.setSelection([pieceId]);
      },
      onMarqueeSelected: (pieceIds, additive) => {
        const ui = useUiStore.getState();
        ui.setSelection(additive ? [...new Set([...ui.selection, ...pieceIds])] : pieceIds);
      },
      onClickEmpty: () => useUiStore.getState().clearSelection(),
    }, {
      referenceZoom: DEFAULT_ZOOM,
    });

    const render = () =>
      canvas.update(
        useMarkerStore.getState().document,
        useViewportStore.getState(),
        useUiStore.getState().selection,
      );

    render();
    const unsubscribeMarker = useMarkerStore.subscribe(render);
    const unsubscribeViewport = useViewportStore.subscribe(render);
    const unsubscribeUi = useUiStore.subscribe(render);

    return () => {
      unsubscribeMarker();
      unsubscribeViewport();
      unsubscribeUi();
      canvas.destroy();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal keys from a field the user is typing in.
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const command = commandForKey(event);
      if (!command) return;

      const marker = useMarkerStore.getState().document;
      if (!marker) return;

      const selection = useUiStore.getState().selection;
      // Let the browser keep the key if the command has nothing to act on —
      // swallowing Delete with no selection would feel broken.
      if (command.needsSelection && selection.length === 0) return;

      event.preventDefault();
      command.run({ document: marker, selection });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      className="marker-stage"
      data-drop-active={dropActive || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        // dataTransfer values are unreadable during dragover, but the type
        // list is not — enough to say what will happen on release.
        setDropActive(event.dataTransfer.types.includes(TRAY_DRAG_TYPE) ? 'piece' : 'file');
      }}
      onDragLeave={() => setDropActive(null)}
      onDrop={onDrop}
    >
      {/* The canvas host is separate so Konva owns an element React never re-renders. */}
      <div className="marker-stage__canvas" ref={containerRef} />
      {dropActive ? (
        <div className="marker-stage__hint">
          {dropActive === 'piece' ? 'Drop to place the piece here' : 'Drop a DXF to import'}
        </div>
      ) : null}
      {progress === null ? null : (
        <div className="marker-stage__progress" role="progressbar" aria-valuenow={progress}>
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
};
