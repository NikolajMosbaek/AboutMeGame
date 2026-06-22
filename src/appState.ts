// Top-level app flow for the explorable world.
//
// Modelled as a discriminated union + pure reducer (the spine the previous
// slice established) so illegal states stay unrepresentable and the shell
// (Epic 5: menus, pause) extends the same union rather than sprouting booleans.
// For Epic 1 there are two phases: the landing screen and the running world.

export type AppScreen = { kind: "title" } | { kind: "playing" };

export type AppAction = { type: "start" } | { type: "exitToTitle" };

export const INITIAL_APP_STATE: AppScreen = { kind: "title" };

export function appReducer(state: AppScreen, action: AppAction): AppScreen {
  switch (action.type) {
    case "start":
      // The world mounts only from the title screen.
      return state.kind === "title" ? { kind: "playing" } : state;

    case "exitToTitle":
      return { kind: "title" };

    default: {
      // Exhaustiveness guard: a new AppAction without a case is a compile error.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
