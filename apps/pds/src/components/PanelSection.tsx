import type { ReactNode } from 'react';

interface PanelSectionProps {
  title: string;
  caption?: string;
  children: ReactNode;
}

export const PanelSection = ({ title, caption, children }: PanelSectionProps) => (
  <section className="panel-section">
    <header className="panel-section__header">
      <h3>{title}</h3>
      {caption ? <span className="panel-section__caption">{caption}</span> : null}
    </header>
    {children}
  </section>
);
