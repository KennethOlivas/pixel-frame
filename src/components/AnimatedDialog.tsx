import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './modal.css';

type Props = {
  open: boolean;
  onClose: () => void;
  onAfterClose?: () => void;
  labelledBy: string;
  className?: string;
  children: ReactNode;
};

/** Keep the native focus trap active until the exit animation has finished. */
export function AnimatedDialog({ open, onClose, onAfterClose, labelledBy, className = '', children }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const latest = useRef({ open, onAfterClose });
  latest.current = { open, onAfterClose };
  const [phase, setPhase] = useState<'open' | 'closed'>('closed');

  function finishClose() {
    const dialog = dialogRef.current;
    if (!dialog?.open || latest.current.open) return;
    dialog.close();
    if (opener.current?.isConnected && !opener.current.closest('[inert]')) opener.current.focus({ preventScroll: true });
    latest.current.onAfterClose?.();
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      setPhase('open');
    } else if (dialog.open) {
      setPhase('closed');
      // Also finish when animations are disabled or the browser drops animationend.
      const timer = window.setTimeout(finishClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  return <dialog ref={dialogRef} className={`animated-dialog ${className}`} aria-labelledby={labelledBy} data-state={phase}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onKeyDown={event => event.stopPropagation()}
    onAnimationEnd={event => {
      // Let the exit event finish bubbling before closing the native dialog.
      if (event.target === event.currentTarget && phase === 'closed') window.setTimeout(finishClose, 0);
    }}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    {children}
  </dialog>;
}
