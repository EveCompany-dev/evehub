import { useEffect } from 'react';

/** Closes whatever's open (a modal, typically) on Escape — every `.eve-modal-backdrop` already closes on click-outside, this is the keyboard equivalent. */
export function useEscapeToClose(onClose: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
}
