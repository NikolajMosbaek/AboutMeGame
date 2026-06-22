// Top-level app flow for the explorable world.
//
// Modelled as a discriminated union + pure reducer (the spine the previous
// slice established) so illegal states stay unrepresentable and the shell
// (Epic 5: menus, pause) extends the same union rather than sprouting booleans.
// For Epic 1 there are two phases: the landing screen and the running world.

export type AppScreen = { kind: "title" } | { kind: "playing" };

// Epic 5 (pause / exit-to-title) will extend this union; for now the only
// transition is entering the world.
export type AppAction = { type: "start" };

export const INITIAL_APP_STATE: AppScreen = { kind: "title" };

export function appReducer(state: AppScreen, action: AppAction): AppScreen {
  switch (action.type) {
    case "start":
      // The world mounts only from the title screen.
      return state.kind === "title" ? { kind: "playing" } : state;

    default:
      // Unknown action — leave state unchanged. When Epic 5 grows the action
      // union, restore the `never` exhaustiveness guard here.
      return state;
  }
}
