// Top-level app flow for the explorable world.
//
// Modelled as a discriminated union + pure reducer (the spine the previous
// slice established) so illegal states stay unrepresentable and the shell
// (Epic 5: menus, pause) extends the same union rather than sprouting booleans.
// Three phases: the landing screen, the running 3D world, and the no-WebGL text
// view (Epic 6, #50) for anyone who can't or won't play.

export type AppScreen = { kind: "title" } | { kind: "playing" } | { kind: "textView" };

// Top-level transitions: enter the world from the title, open the text view from
// the title, and return to the title from either (Epic 5's "Back to title" in
// the pause menu; the text view's "Back").
export type AppAction =
  | { type: "start" }
  | { type: "openTextView" }
  | { type: "exitToTitle" };

export const INITIAL_APP_STATE: AppScreen = { kind: "title" };

export function appReducer(state: AppScreen, action: AppAction): AppScreen {
  switch (action.type) {
    case "start":
      // The world mounts only from the title screen.
      return state.kind === "title" ? { kind: "playing" } : state;

    case "openTextView":
      // The text view opens only from the title screen.
      return state.kind === "title" ? { kind: "textView" } : state;

    case "exitToTitle":
      // Leaving the world or the text view returns to the title (GameCanvas
      // disposes the engine on unmount). No-op when already on the title.
      return state.kind === "title" ? state : { kind: "title" };

    default: {
      // Exhaustiveness guard: a future action with no case is a compile error.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
