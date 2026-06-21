import { APP_VERSION, VISION } from "./version.ts";

/**
 * Landing/Title screen — the only screen built in the bootstrap. The next
 * vertical slices (Lobby, Prompt, Guess, Scoreboard) hang off this shell.
 */
export function App() {
  return (
    <main className="title-screen">
      <h1>AboutMeGame</h1>
      <p className="tagline">{VISION}</p>
      <button className="cta" type="button" disabled>
        Start
      </button>
      <p className="version-marker">v{APP_VERSION}</p>
    </main>
  );
}
