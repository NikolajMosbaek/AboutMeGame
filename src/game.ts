// Core game domain types for the local Title -> Prompt -> Reveal slice.
//
// The screen state is modelled as a discriminated union rather than a set of
// booleans so illegal states are unrepresentable: a `reveal` cannot exist
// without both a prompt and an answer. This is the same spine the deferred
// `lobby` | `guess` | `scoreboard` variants will extend, and the one place
// shared domain types live (the charter's stated reason for choosing TS).

// The single real, on-vision "about me" prompt. Both the prompt screen and the
// reveal screen read this one constant so the wording cannot drift between
// screens (mirrors the version.ts single-source-of-truth pattern). A prompt
// pool / multi-round support is a deferred feature, not part of this slice.
export const INITIAL_PROMPT =
  "What is a small thing that instantly makes your day better?";

// Which screen the player is on, plus the data that screen needs. The variants
// are ordered along the Title -> Prompt -> Reveal flow.
export type GameScreen =
  | { kind: "title" }
  | { kind: "prompt"; prompt: string }
  | { kind: "reveal"; prompt: string; answer: string };

// Domain commands dispatched by the screens. These are the seam where, later,
// networked actions will flow into the same reducer.
export type GameAction =
  | { type: "start" }
  | { type: "submitAnswer"; answer: string }
  | { type: "playAgain" };

// Pure reducer that advances the Title -> Prompt -> Reveal flow. It is the one
// place the integrity rules live, so the UI's disabled buttons are merely a
// derived reflection of the same logic. App owns this via useReducer; networked
// actions will later dispatch the same commands.
//
// Transitions are gated on the *current* screen so an out-of-order action (e.g.
// submitAnswer while on the title) is an unreachable-in-practice no-op rather
// than an illegal state.
export function gameReducer(state: GameScreen, action: GameAction): GameScreen {
  switch (action.type) {
    case "start":
      // Only meaningful from the title screen; carry the one shared prompt.
      return state.kind === "title"
        ? { kind: "prompt", prompt: INITIAL_PROMPT }
        : state;

    case "submitAnswer":
      // Defense-in-depth empty-answer guard: a whitespace-only answer leaves
      // the player on the prompt screen. The TRIMMED value gates the
      // transition, but the RAW, untrimmed answer is what gets stored and
      // later echoed verbatim on the reveal screen.
      if (state.kind !== "prompt" || action.answer.trim().length === 0) {
        return state;
      }
      return {
        kind: "reveal",
        prompt: state.prompt,
        answer: action.answer,
      };

    case "playAgain":
      // Reconstruct a fresh title state rather than clearing fields in place,
      // so no answer can leak into the next run.
      return { kind: "title" };

    default: {
      // Exhaustiveness guard: adding a future GameAction without handling it
      // here becomes a compile error.
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}
