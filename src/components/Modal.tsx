import type { PropsWithChildren } from 'react';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, wide = false }: PropsWithChildren<{ title: string; onClose(): void; wide?: boolean }>) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
      {children}
    </section>
  </div>;
}
