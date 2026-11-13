import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Boxes, X } from './icons';

export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="phase-notice" role="status">
      {children}
    </div>
  );
}
export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Boxes size={25} />
      </div>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}
export function Dialog({
  title,
  onClose,
  children,
  variant = 'modal',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  variant?: 'modal' | 'drawer';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={'preview-dialog ' + (variant === 'drawer' ? 'detail-drawer' : '')}
      onCancel={onClose}
      aria-labelledby={titleId}
    >
      <div className="modal-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
