import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface UseFocusTrapOptions {
  isOpen: boolean;
  onClose?: () => void;
  autoFocus?: boolean;
}

export function useFocusTrap<T extends HTMLElement>(
  containerRef: React.RefObject<T | null>,
  options: UseFocusTrapOptions
) {
  const { isOpen, onClose, autoFocus = true } = options;
  const previousActiveElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current = document.activeElement as HTMLElement | null;

    const container = containerRef.current;
    if (!container) return;

    if (autoFocus) {
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0 && focusable[0]) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (onClose) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
        return;
      }

      if (e.key !== 'Tab') return;

      const currentContainer = containerRef.current;
      if (!currentContainer) return;

      const focusable = Array.from(
        currentContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);

      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }

      const firstElement = focusable[0];
      const lastElement = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (
          document.activeElement === firstElement ||
          !currentContainer.contains(document.activeElement)
        ) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (
          document.activeElement === lastElement ||
          !currentContainer.contains(document.activeElement)
        ) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === 'function'
      ) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose, autoFocus, containerRef]);
}
