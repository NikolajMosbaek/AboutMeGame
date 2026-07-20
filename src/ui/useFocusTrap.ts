import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/**
 * Trap keyboard focus inside a modal dialog (WCAG 2.4.3 / 2.1.2). While the
 * dialog is mounted, Tab / Shift+Tab cycle within its own focusable elements and
 * can never land on the background HUD behind it; if focus is somehow already
 * outside (a stray click, an initial-focus miss), the next Tab pulls it back in.
 *
 * Listens on `window` in the CAPTURE phase, so it settles focus before any
 * app-level key handler runs. Pair it with the dialog's own initial-focus
 * effect (which puts focus inside on open); this only governs where Tab may go.
 */
export function useFocusTrap(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const container = containerRef.current;
      if (!container) return;
      const items = focusable(container);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (!container.contains(active)) {
        e.preventDefault();
        first.focus();
        return;
      }
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [containerRef]);
}
