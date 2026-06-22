import { useReducer } from "react";
import { appReducer, INITIAL_APP_STATE } from "./appState.ts";
import { TitleScreen } from "./ui/TitleScreen.tsx";
import { GameCanvas } from "./engine/GameCanvas.tsx";
import { TextView } from "./ui/TextView.tsx";

/**
 * App — the one stateful coordinator of the top-level flow (title ↔ playing ↔
 * text view). It owns the screen state via a single pure `useReducer`
 * (`appReducer`) and renders exactly one phase at a time (conditional, not
 * CSS-hidden, so the unused phase is out of the DOM and the engine is torn down
 * on exit). The pause menu's "Back to title" and the text view's "Back" both
 * dispatch `exitToTitle`, unmounting their phase (GameCanvas disposes the engine).
 *
 * The `default` branch's `never` assignment makes adding a future screen
 * variant without a render case a compile error.
 */
export function App() {
  const [screen, dispatch] = useReducer(appReducer, INITIAL_APP_STATE);

  switch (screen.kind) {
    case "title":
      return (
        <TitleScreen
          onStart={() => dispatch({ type: "start" })}
          onReadText={() => dispatch({ type: "openTextView" })}
        />
      );

    case "playing":
      return <GameCanvas onExit={() => dispatch({ type: "exitToTitle" })} />;

    case "textView":
      return <TextView onBack={() => dispatch({ type: "exitToTitle" })} />;

    default: {
      const _exhaustive: never = screen;
      return _exhaustive;
    }
  }
}
