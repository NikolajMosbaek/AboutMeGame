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
