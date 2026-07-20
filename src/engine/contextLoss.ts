// WebGL context-loss handling (#—, M2). A GPU context can vanish mid-session —
// the OS reclaims it under memory pressure (common on mobile), a driver resets,
// or the tab is backgrounded too long. Without handling, the canvas freezes
// silently and the render loop keeps spinning on a dead context (the fps
// read-out corrupts to ~120 as failed frames post near-zero dt).
//
// This wires the two canvas events: on loss we MUST call preventDefault (that is
// the signal that the app will handle restoration, keeping the door open) and
// then halt + surface feedback; on restore the caller decides recovery (a clean
// reload is the robust path — every GPU resource is invalidated on loss). Kept a
// tiny pure seam so it is testable in jsdom against a real <canvas> with
// synthetic events, without a live WebGL context.

export interface ContextLossHandlers {
  /** The context was lost — halt the loop and show the player feedback. */
  onLost: () => void;
  /** The context came back (optional). GPU resources are gone, so the caller
   *  typically drives a reload rather than re-uploading in place. */
  onRestored?: () => void;
}

/**
 * Attach `webglcontextlost` / `webglcontextrestored` listeners to `canvas`.
 * Returns a cleanup that detaches both. On loss, `preventDefault()` is called
 * before `onLost` so the browser knows restoration is wanted.
 */
export function installContextLossHandlers(
  canvas: HTMLCanvasElement,
  handlers: ContextLossHandlers,
): () => void {
  const onLost = (e: Event) => {
    e.preventDefault();
    handlers.onLost();
  };
  const onRestored = () => {
    handlers.onRestored?.();
  };
  canvas.addEventListener("webglcontextlost", onLost as EventListener);
  canvas.addEventListener("webglcontextrestored", onRestored as EventListener);
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost as EventListener);
    canvas.removeEventListener("webglcontextrestored", onRestored as EventListener);
  };
}
