// Top-level app flow for the explorable world.
//
// Modelled as a discriminated union + pure reducer (the spine the previous
// slice established) so illegal states stay unrepresentable and the shell
// (Epic 5: menus, pause) extends the same union rather than sprouting booleans.
// For Epic 1 there are two phases: the landing screen and the running world.

export type AppScreen = { kind: "title" } | { kind: "playing" };

// Two top-level transitions: enter the world from the title, and return to the
// title from the running world (Epic 5's "Back to title" in the pause menu).
export type AppAction = { type: "start" } | { type: "exitToTitle" };

export const INITIAL_APP_STATE: AppScreen = { kind: "title" };

export function appReducer(state: AppScreen, action: AppAction): AppScreen {
  switch (action.type) {
    case "start":
      // The world mounts only from the title screen.
      return state.kind === "title" ? { kind: "playing" } : state;

    case "exitToTitle":
      // Leaving the world tears it down (GameCanvas disposes the engine on
      // unmount). No-op when already on the title.
      return state.kind === "playing" ? { kind: "title" } : state;

    default: {
      // Exhaustiveness guard: a future action with no case is a compile error.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
