import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createDiscoveryStore } from "./discoveryStore.ts";
import { journalCanOpen } from "./journalEntries.ts";
import { toJournalPoi, type DiscoverablePoi } from "../content/discoverablePois.ts";

/**
 * T14 — pin the answered-guess revisit and no-re-chime invariants.
 *
 * Revisiting an already-discovered POI through the journal must open a FRESH
 * reveal on the single reveal path — `guessChoice` reset to `null` and
 * `bodyUnlocked` `false` for a guess — never an auto-unlocked second reveal.
 *
 * And it must not re-chime: the chime fires off `discoveredCount` rising (the
 * `setDiscovered` path, see `AudioSystem`), while the journal open action only
 * calls `store.openPoi`, which never touches the discovered set. The `openPoi`
 * guard (`journalCanOpen`, re-checked against the LIVE set) means only an
 * already-discovered id ever opens, so a count change — and thus a re-chime —
 * is impossible on revisit.
 *
 * The journal open action is modelled exactly as `JournalPanel.open`: re-check
 * `journalCanOpen` against the live set, re-derive the full open input from the
 * position-free `journalPois` projection, drain the interact edge, then
 * `store.openPoi`. No new audio, no second reveal code path.
 */

const GUESS_POI: DiscoverablePoi = {
  id: "g",
  order: 1,
  title: "Guess Landmark",
  teaser: "tg",
  body: "the body",
  color: 0x112233,
  position: new THREE.Vector3(0, 0, 0),
  interaction: {
    type: "guess",
    prompt: "Pick one",
    options: [
      { text: "A", correct: true },
      { text: "B", correct: false },
    ],
  },
};

const PLAIN_POI: DiscoverablePoi = {
  id: "p",
  order: 2,
  title: "Plain Landmark",
  teaser: "tp",
  body: "plain body",
  color: 0x445566,
  position: new THREE.Vector3(100, 0, 0),
};

const POIS = [GUESS_POI, PLAIN_POI];
const JOURNAL_POIS = POIS.map(toJournalPoi);

/** The journal open action, modelled exactly as `JournalPanel.open`: guard
 *  against the LIVE discovered set, re-derive the full open input from the
 *  position-free journal projection (never a row), drain the interact edge,
 *  then commit `openPoi`. Returns whether the open committed. */
function journalOpen(
  store: ReturnType<typeof createDiscoveryStore>,
  consumeInteract: () => boolean,
  id: string,
): boolean {
  if (!journalCanOpen(id, store.getSnapshot().discoveredIds)) return false;
  const poi = JOURNAL_POIS.find((p) => p.id === id);
  if (!poi) return false;
  consumeInteract();
  store.openPoi({
    id: poi.id,
    order: poi.order,
    title: poi.title,
    body: poi.body,
    interaction: poi.interaction,
  });
  return true;
}

describe("journal revisit of an answered guess (T14)", () => {
  it("opens a FRESH reveal: guessChoice null, bodyUnlocked false, on the single reveal path", () => {
    const store = createDiscoveryStore(POIS.length);
    store.setDiscovered(["g"]); // already discovered

    // First open + commit a guess, exactly like a player would the first time.
    journalOpen(store, () => false, "g");
    store.answerGuess(0);
    expect(store.getSnapshot().open?.guessChoice).toBe(0);
    expect(store.getSnapshot().open?.bodyUnlocked).toBe(true);

    // Close, then REVISIT through the journal: the new open must be fresh, not
    // a carried-over committed state — i.e. it's a re-guess, not an auto-unlock.
    store.closePoi();
    const committed = journalOpen(store, () => false, "g");

    expect(committed).toBe(true);
    const open = store.getSnapshot().open;
    expect(open?.id).toBe("g");
    expect(open?.guessChoice).toBeNull();
    expect(open?.bodyUnlocked).toBe(false);
  });

  it("does not change discoveredCount across a revisit open — so the chime trigger never fires", () => {
    const store = createDiscoveryStore(POIS.length);
    store.setDiscovered(["g"]);

    // Mirror AudioSystem's trigger: chime exactly when discoveredCount rises.
    const chime = vi.fn();
    let last = store.getSnapshot().discoveredCount;
    const unsub = store.subscribe(() => {
      const count = store.getSnapshot().discoveredCount;
      if (count > last) chime();
      last = count;
    });

    const before = store.getSnapshot().discoveredCount;
    journalOpen(store, () => false, "g");
    store.answerGuess(0);
    store.closePoi();
    journalOpen(store, () => false, "g"); // the revisit
    const after = store.getSnapshot().discoveredCount;

    expect(after).toBe(before);
    expect(chime).not.toHaveBeenCalled();

    unsub();
  });

  it("the openPoi guard makes a count change impossible: a locked id yields zero opens and no count move", () => {
    const store = createDiscoveryStore(POIS.length);
    store.setDiscovered(["g"]); // 'p' stays undiscovered

    const before = store.getSnapshot().discoveredCount;
    const committed = journalOpen(store, () => false, "p");

    expect(committed).toBe(false);
    expect(store.getSnapshot().open).toBeNull();
    expect(store.getSnapshot().discoveredCount).toBe(before);
  });
});
