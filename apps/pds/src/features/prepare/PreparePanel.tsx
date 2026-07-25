import { PanelSection } from '@/components/PanelSection';
import { listFormats } from '@/io';

export const PreparePanel = () => (
  <PanelSection title="Export formats">
    <ul className="list">
      {listFormats().map((format) => (
        <li key={format.id}>
          <div className="list__row list__row--static">
            <span className="list__label">{format.label}</span>
            <span className="badge" data-tone={format.status === 'available' ? 'ok' : 'muted'}>
              {format.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  </PanelSection>
);
