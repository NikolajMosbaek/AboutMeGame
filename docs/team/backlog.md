# AboutMeGame — Backlog

> Prioritized top-to-bottom. The Product Owner pulls the top unchecked item
> when `/team` is run with no explicit feature. When empty, the PO proposes
> the next most valuable item.

## Items

### Done
- [x] Bootstrap: choose the stack, scaffold the project, write the charter.

### Game work (deferred)
- [ ] First local vertical slice (single device): show one "about me" prompt,
      let the player type an answer, submit it, and see it echoed back on a
      reveal screen. Proves the prompt → answer → reveal loop (the core
      mechanic) before any lobby, networking, multiplayer, or scoring. The SPA
      shell from the bootstrap hosts it.
- [ ] Lobby / join: let multiple players join a shared session (still local or
      shared-link), establishing the Lobby screen state and player identities.
- [ ] Guessing: players guess which answer belongs to whom — the round
      interaction on top of the prompt → answer loop.
- [ ] Scoring: award and tally points for correct guesses; surface a
      Scoreboard screen state.
- [ ] Persistence: keep session/game state across reloads (start with
      localStorage; a backing store is a later call).
- [ ] Networking: add the server / WebSocket seam for real-time multiplayer
      over a shared link. Deferred from the bootstrap per the charter — added
      in the first slice that actually needs networked multiplayer.

### Engineering / infra (deferred)
- [ ] ESLint config: add `eslint` as a devDependency with a flat config and a
      `lint` script (the bootstrap removed the non-executable `lint` script).
- [ ] CI: add a pipeline that runs install/build/test on every PR so the
      clean-checkout guarantee is enforced automatically, not by hand.
- [ ] npm audit fixes: resolve the vulnerabilities reported on the locked
      dependency tree (1 critical, 1 high among 5), acknowledged but not fixed
      in the bootstrap.
