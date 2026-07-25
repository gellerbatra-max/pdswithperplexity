import { useState, type ReactNode } from 'react';
import { Icon } from './Icon';

interface CollapsibleSectionProps {
  title: string;
  caption?: string;
  /** Collapsed sections still mount their children — cheap, and keeps scroll stable. */
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

/** Accordion section used to stack several dense panels in one context column. */
export const CollapsibleSection = ({
  title,
  caption,
  defaultOpen = true,
  action,
  children,
}: CollapsibleSectionProps) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="section" data-open={open || undefined}>
      <div className="section__header">
        <button
          type="button"
          className="section__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="section__chevron">
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          </span>
          <span className="section__title">{title}</span>
          {caption ? <span className="section__caption">{caption}</span> : null}
        </button>
        {action ? <div className="section__action">{action}</div> : null}
      </div>
      {open ? <div className="section__body">{children}</div> : null}
    </section>
  );
};
