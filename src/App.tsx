import { useReducer } from "react";
import { appReducer, INITIAL_APP_STATE } from "./appState.ts";
import { TitleScreen } from "./ui/TitleScreen.tsx";
import { GameCanvas } from "./engine/GameCanvas.tsx";

/**
 * App — the one stateful coordinator of the top-level flow (title → playing).
 * It owns the screen state via a single pure `useReducer` (`appReducer`) and
 * renders exactly one phase at a time (conditional, not CSS-hidden, so the
 * unused phase is out of the DOM and the engine is torn down on exit).
 *
 * The `default` branch's `never` assignment makes adding a future screen
 * variant without a render case a compile error.
 */
export function App() {
  const [screen, dispatch] = useReducer(appReducer, INITIAL_APP_STATE);

  switch (screen.kind) {
    case "title":
      return <TitleScreen onStart={() => dispatch({ type: "start" })} />;

    case "playing":
      return <GameCanvas />;

    default: {
      const _exhaustive: never = screen;
      return _exhaustive;
    }
  }
}
