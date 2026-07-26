import { Icon } from '@/components/Icon';
import { LAYERS, useViewportStore } from '@/store';

/**
 * Draft layers. The first four drive the renderer for real; the rest are declared
 * so the list reflects the full layer model and light up as each one is drawn.
 */
export const LayerList = () => {
  const layers = useViewportStore((s) => s.layers);
  const toggleLayer = useViewportStore((s) => s.toggleLayer);

  return (
    <ul className="layers">
      {LAYERS.map((layer) => {
        const visible = layers[layer.id];
        const disabled = layer.status === 'planned' || layer.locked === true;

        return (
          <li key={layer.id}>
            <div className="layers__row" data-planned={layer.status === 'planned' || undefined}>
              <button
                type="button"
                className="layers__eye"
                data-on={visible || undefined}
                disabled={disabled}
                aria-label={`${visible ? 'Hide' : 'Show'} ${layer.label}`}
                title={
                  layer.locked
                    ? `${layer.label} — always visible`
                    : layer.status === 'planned'
                      ? `${layer.label} — not drawn yet`
                      : visible
                        ? `Hide ${layer.label}`
                        : `Show ${layer.label}`
                }
                onClick={() => toggleLayer(layer.id)}
              >
                <Icon name={visible ? 'eye' : 'eye-off'} size={13} />
              </button>

              <span className="layers__name">{layer.label}</span>

              {layer.locked ? (
                <span className="layers__lock" title="Locked">
                  <Icon name="lock" size={12} />
                </span>
              ) : layer.status === 'planned' ? (
                <span className="badge" data-tone="muted">
                  planned
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
};
