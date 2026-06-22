import { useReducer } from "react";
import { gameReducer } from "./game.ts";
import { TitleScreen } from "./screens/TitleScreen.tsx";
import { PromptScreen } from "./screens/PromptScreen.tsx";
import { RevealScreen } from "./screens/RevealScreen.tsx";

/**
 * App — the one stateful coordinator of the local Title -> Prompt -> Reveal
 * slice (D2). It owns the screen state via a single pure `useReducer`
 * (`gameReducer`) and dispatches domain commands; each screen is a pure
 * presentational component receiving props + callbacks. The reducer is the seam
 * where networked actions will later dispatch the same commands.
 *
 * App is a switchboard (D3): it switches on `screen.kind` and renders exactly
 * one screen. Rendering is conditional, not CSS-hidden, so the off-screen
 * components are removed from the DOM entirely. The `default` branch's
 * `const _exhaustive: never = screen` makes adding a future GameScreen variant
 * without a render case a compile error (`tsc --noEmit`).
 */
export function App() {
  const [screen, dispatch] = useReducer(gameReducer, { kind: "title" });

  switch (screen.kind) {
    case "title":
      return <TitleScreen onStart={() => dispatch({ type: "start" })} />;

    case "prompt":
      return (
        <PromptScreen
          onSubmit={(answer) => dispatch({ type: "submitAnswer", answer })}
        />
      );

    case "reveal":
      return (
        <RevealScreen
          prompt={screen.prompt}
          answer={screen.answer}
          onPlayAgain={() => dispatch({ type: "playAgain" })}
        />
      );

    default: {
      // Exhaustiveness guard: a future GameScreen variant added without a
      // render case above becomes a compile error here.
      const _exhaustive: never = screen;
      return _exhaustive;
    }
  }
}
