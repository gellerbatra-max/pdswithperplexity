import { Icon } from './Icon';
import { useDocumentStore } from '@/store';

const COPY = {
  saved: { label: 'Saved', icon: 'cloud' },
  saving: { label: 'Saving…', icon: 'cloud' },
  unsaved: { label: 'Unsaved changes', icon: 'dot' },
} as const;

/** Ambient save indicator — no button, just state, the way Figma and Linear do it. */
export const SaveState = () => {
  const saveState = useDocumentStore((s) => s.saveState);
  const { label, icon } = COPY[saveState];

  return (
    <span className="save-state" data-state={saveState} title={label}>
      <Icon name={icon} size={13} />
      <span className="save-state__label">{label}</span>
    </span>
  );
};
