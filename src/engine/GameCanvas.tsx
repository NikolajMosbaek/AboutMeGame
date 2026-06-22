import { useEffect, useRef, useState } from "react";
import { Engine } from "./Engine.ts";
import { createRenderer } from "./createRenderer.ts";
import { buildGame } from "../buildGame.ts";
import { StatsOverlay } from "../perf/StatsOverlay.tsx";

export interface GameCanvasProps {
  /** Populate the engine with the game's systems (world + movement). `overlay`
   *  is the canvas container that touch controls mount into. Defaults to the
   *  real game; injected so a preview/test can build a minimal scene instead. */
  build?: (engine: Engine, overlay: HTMLElement) => void;
  /** Show the runtime stats overlay (#14). Defaults to dev-only. */
  showStats?: boolean;
}

/**
 * GameCanvas — the React↔Three.js boundary. It owns exactly one `<canvas>` and
 * one `Engine` instance for its lifetime: build the renderer + engine on mount,
 * size it to its container, run the loop, and dispose everything on unmount.
 * No engine state leaks into module scope, so React StrictMode's double-mount
 * (and any test) gets a clean engine each time.
 */
export function GameCanvas({
  build = buildGame,
  showStats = import.meta.env.DEV,
}: GameCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const renderer = createRenderer({ canvas });
    const eng = new Engine({ renderer });
    build(eng, container);

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      eng.resize(clientWidth || window.innerWidth, clientHeight || window.innerHeight);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    // Pause the loop while the tab is hidden — no point burning battery/GPU.
    const onVisibility = () => (document.hidden ? eng.stop() : eng.start());
    document.addEventListener("visibilitychange", onVisibility);

    // Automation hooks (develop-web-game convention).
    window.advanceTime = (ms: number) => eng.advanceTime(ms);
    window.render_game_to_text = () => JSON.stringify(eng.getState());
    window.__ENGINE_STATE__ = () => eng.getState();

    eng.start();
    setEngine(eng);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      delete window.advanceTime;
      delete window.render_game_to_text;
      delete window.__ENGINE_STATE__;
      eng.dispose();
      setEngine(null);
    };
  }, [build]);

  return (
    <div ref={containerRef} className="game-canvas-container">
      <canvas ref={canvasRef} className="game-canvas" aria-hidden="true" />
      {showStats && engine && <StatsOverlay engine={engine} />}
    </div>
  );
}
