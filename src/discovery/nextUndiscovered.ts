/**
 * Pure, framework-agnostic selector for the in-panel "Next landmark →"
 * affordance (M2 slice 4). Given the ordered POI set, names the next-by-order
 * undiscovered landmark using a **cyclic-successor** rule.
 *
 * No THREE / WebGL / React import: input is the minimal `{ id; order; title }`
 * projection so headless tests need no world/anchor fixtures.
 *
 * The current open id is excluded **independently** of `discoveredIds`: while
 * the reveal panel is open the open POI is already in the discovered set, so we
 * must not infer "undiscovered = complement of discoveredIds" for it.
 */
export interface PoiRef {
  id: string;
  order: number;
  title: string;
}

/**
 * @param pois          The full ordered POI set (any array order; sorted here).
 * @param discoveredIds Ids already discovered (may include `currentId`).
 * @param currentId     The id of the POI whose reveal is open (always excluded).
 * @param currentOrder  The open POI's `order`, used for the successor compare.
 * @returns The next-by-order undiscovered POI (cyclic successor): the first
 *   remaining with `order > currentOrder`, else wrapping to the lowest-order
 *   remaining; `null` only when no other undiscovered POI exists.
 */
export function nextUndiscovered(
  pois: readonly PoiRef[],
  discoveredIds: readonly string[],
  currentId: string,
  currentOrder: number,
): PoiRef | null {
  const discovered = new Set(discoveredIds);

  // Sort ascending by order (defensive — do not trust array order); break ties
  // on id for determinism. Exclude the current id and every discovered id.
  const remaining = pois
    .filter((p) => p.id !== currentId && !discovered.has(p.id))
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (remaining.length === 0) return null;

  // First with order > current, else wrap to the lowest-order remaining.
  return remaining.find((p) => p.order > currentOrder) ?? remaining[0];
}
