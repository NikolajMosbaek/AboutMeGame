import * as THREE from "three";

// A minimal, PURPOSE-BUILT GLB parser for the flora model payload (visual-
// overhaul slice 6), replacing three's official `GLTFLoader` for this one
// narrow use — a deliberate, MEASURED trade, not a stylistic preference.
//
// `GLTFLoader` is a full spec-general loader (animations/skinning/morph
// targets/cameras/lights/every extension) — reaching for it here cost far more
// than its own ~13 KB gz chunk: because it references many three-CORE symbols
// this world never otherwise uses (`Skeleton`/`Bone`/`AnimationClip`/
// `PropertyBinding`, …), those symbols could no longer be tree-shaken out of
// the ALWAYS-eager `three` vendor chunk either (`vite.config.ts`'s
// `manualChunks` pins every `three/` module to that one bucket, dynamic-import
// or not) — measured at +11.7 KB gz on `three` ON TOP OF GLTFLoader's own
// +13 KB gz chunk, ~25 KB total against a ~15 KB `check:bundle` headroom
// (`docs/perf-budget.md`). `scripts/process-models.mjs`'s own output is fully
// known and narrow (ONE mesh, ONE primitive, POSITION/NORMAL/COLOR_0,
// `KHR_mesh_quantization`, no images/materials/animations) — small enough to
// parse directly and correctly, at a fraction of the bytes, referencing
// nothing outside `THREE.BufferGeometry`/`BufferAttribute` (already eager
// everywhere in this codebase, so this adds ZERO bytes to the `three` chunk).
//
// Handles the TWO structural wrinkles this pipeline's output actually has:
//   1. `quantize()` interleaves POSITION/NORMAL/COLOR_0 into a single buffer
//      view with a shared `byteStride`, each at its own componentType
//      (i16/i16/u8) — `readAccessor` below de-interleaves generically from
//      `byteStride`, not hard-coded offsets, so it isn't tied to
//      gltf-transform's current packing choice.
//   2. `KHR_mesh_quantization`'s normalized-int16 POSITION only spans [-1, 1]
//      by construction, so `quantize()` ALSO writes a compensating
//      scale+translation onto the mesh's NODE — the standard "quantization
//      volume" pairing the spec expects every consumer (three's own
//      `GLTFLoader` included) to re-apply after decoding. This parser reads
//      that ONE node (never a general scene graph — `scripts/process-
//      models.mjs`'s output is always exactly one node, one mesh, one
//      primitive, no rotation) and folds its translation/scale into the
//      POSITION data via `BufferGeometry.scale`/`.translate` — three's own
//      idiom, not a hand-rolled matrix multiply. This MUST happen on a
//      DEQUANTIZED (plain `Float32Array`, `normalized: false`) position
//      attribute, never the still-quantized int16 one: a real bug caught
//      while writing this parser — `BufferAttribute.setXYZ` (which
//      `.scale()`/`.translate()` call internally) re-normalizes any value it
//      writes back into a `normalized: true` attribute's storage, and the
//      node's own scale (> 1, since it un-shrinks the [-1,1] quantization
//      volume back out to world size) pushes values outside the signed-int16
//      normalized range of exactly [-1,1] — which silently WRAPS (two's-
//      complement integer overflow), corrupting the mesh into a
//      barely-recognizable, wildly-mis-scaled dropout. NORMAL stays quantized
//      (a uniform node scale never changes vector DIRECTION, so it needs no
//      transform at all) and COLOR_0 obviously needs none either — only
//      POSITION goes through this dequantize-then-transform path.

/** glTF accessor `componentType` → its typed-array reader + byte size. */
const COMPONENT_TYPES: Record<
  number,
  { size: number; get: (dv: DataView, byteOffset: number) => number; Ctor: TypedArrayCtor }
> = {
  5120: { size: 1, get: (dv, o) => dv.getInt8(o), Ctor: Int8Array },
  5121: { size: 1, get: (dv, o) => dv.getUint8(o), Ctor: Uint8Array },
  5122: { size: 2, get: (dv, o) => dv.getInt16(o, true), Ctor: Int16Array },
  5123: { size: 2, get: (dv, o) => dv.getUint16(o, true), Ctor: Uint16Array },
  5125: { size: 4, get: (dv, o) => dv.getUint32(o, true), Ctor: Uint32Array },
  5126: { size: 4, get: (dv, o) => dv.getFloat32(o, true), Ctor: Float32Array },
};

type TypedArrayCtor =
  | typeof Int8Array
  | typeof Uint8Array
  | typeof Int16Array
  | typeof Uint16Array
  | typeof Uint32Array
  | typeof Float32Array;

const TYPE_ITEM_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

// glTF's normalized-integer decode divisor per componentType (spec table:
// signed types divide by 2^(bits-1)-1, unsigned by 2^bits-1) and whether that
// componentType is signed (whose decoded range is clamped to >= -1, per spec).
const NORMALIZE_DIVISOR: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
const NORMALIZE_SIGNED: Record<number, boolean> = { 5120: true, 5121: false, 5122: true, 5123: false };

interface GlbAccessorJson {
  bufferView: number;
  componentType: number;
  count: number;
  type: string;
  byteOffset?: number;
  normalized?: boolean;
}
interface GlbBufferViewJson {
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GlbNodeJson {
  mesh?: number;
  translation?: [number, number, number];
  scale?: [number, number, number];
}
interface GlbJson {
  accessors: GlbAccessorJson[];
  bufferViews: GlbBufferViewJson[];
  meshes: { primitives: { attributes: Record<string, number>; indices?: number }[] }[];
  nodes?: GlbNodeJson[];
}

interface ReadResult {
  array: InstanceType<TypedArrayCtor>;
  itemSize: number;
  normalized: boolean;
}

/** Read one accessor into a fresh, TIGHTLY-PACKED typed array — de-
 *  interleaving via `bufferView.byteStride` when present (this pipeline's
 *  POSITION/NORMAL/COLOR_0 share one interleaved view), a straight copy when
 *  absent (this pipeline's index accessor).
 *
 *  `dequantize: true` (POSITION only — see this module's header doc, point 2)
 *  decodes a normalized-integer accessor straight into a plain `Float32Array`
 *  (`normalized: false` on the returned attribute), so the caller can safely
 *  apply the node's compensating scale/translation afterwards without ever
 *  writing back into an int16-backed store. */
function readAccessor(json: GlbJson, bin: DataView, accessorIndex: number, dequantize = false): ReadResult {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const info = COMPONENT_TYPES[accessor.componentType];
  if (!info) throw new Error(`flora GLB: unsupported componentType ${accessor.componentType}`);
  const itemSize = TYPE_ITEM_SIZE[accessor.type];
  if (!itemSize) throw new Error(`flora GLB: unsupported accessor type "${accessor.type}"`);

  const elementBytes = info.size * itemSize;
  const stride = bufferView.byteStride ?? elementBytes;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new info.Ctor(accessor.count * itemSize) as InstanceType<TypedArrayCtor>;
  for (let i = 0; i < accessor.count; i++) {
    const vertexOffset = baseOffset + i * stride;
    for (let c = 0; c < itemSize; c++) {
      out[i * itemSize + c] = info.get(bin, vertexOffset + c * info.size);
    }
  }

  if (dequantize && accessor.normalized) {
    const divisor = NORMALIZE_DIVISOR[accessor.componentType];
    const signed = NORMALIZE_SIGNED[accessor.componentType];
    if (divisor === undefined) throw new Error(`flora GLB: cannot dequantize componentType ${accessor.componentType}`);
    const floats = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) {
      const v = out[i] / divisor;
      floats[i] = signed ? Math.max(v, -1) : v;
    }
    return { array: floats, itemSize, normalized: false };
  }

  return { array: out, itemSize, normalized: Boolean(accessor.normalized) };
}

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_TYPE_JSON = 0x4e4f534a; // "JSON"
const CHUNK_TYPE_BIN = 0x004e4942; // "BIN\0"

/**
 * Parse a GLB `ArrayBuffer` produced by `scripts/process-models.mjs` into a
 * single `THREE.BufferGeometry` (index + position/normal/color attributes,
 * quantized attributes wired with `normalized: true` so the GPU dequantizes
 * them for free — the whole point of `KHR_mesh_quantization`, no manual
 * float conversion needed). Throws on anything outside that known shape
 * (missing chunk, no mesh) rather than guessing.
 */
export function parseFloraGlb(buffer: ArrayBuffer): THREE.BufferGeometry {
  const header = new DataView(buffer, 0, 12);
  if (header.getUint32(0, true) !== GLB_MAGIC) throw new Error("flora GLB: bad magic (not a .glb file)");

  let json: GlbJson | null = null;
  let bin: DataView | null = null;
  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const dv = new DataView(buffer, offset, 8);
    const chunkLength = dv.getUint32(0, true);
    const chunkType = dv.getUint32(4, true);
    const chunkStart = offset + 8;
    if (chunkType === CHUNK_TYPE_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, chunkStart, chunkLength));
      json = JSON.parse(text) as GlbJson;
    } else if (chunkType === CHUNK_TYPE_BIN) {
      bin = new DataView(buffer, chunkStart, chunkLength);
    }
    offset = chunkStart + chunkLength;
  }
  if (!json) throw new Error("flora GLB: missing JSON chunk");
  if (!bin) throw new Error("flora GLB: missing BIN chunk");

  const mesh = json.meshes?.[0];
  const prim = mesh?.primitives?.[0];
  if (!prim) throw new Error("flora GLB: no mesh primitive found");

  const geometry = new THREE.BufferGeometry();
  if (prim.indices !== undefined) {
    const { array, itemSize } = readAccessor(json, bin, prim.indices);
    geometry.setIndex(new THREE.BufferAttribute(array, itemSize));
  }
  const ATTR_MAP: [string, string][] = [
    ["POSITION", "position"],
    ["NORMAL", "normal"],
    ["COLOR_0", "color"],
  ];
  for (const [glName, threeName] of ATTR_MAP) {
    const accessorIndex = prim.attributes[glName];
    if (accessorIndex === undefined) continue;
    const { array, itemSize, normalized } = readAccessor(json, bin, accessorIndex, glName === "POSITION");
    geometry.setAttribute(threeName, new THREE.BufferAttribute(array, itemSize, normalized));
  }

  // Re-apply the `KHR_mesh_quantization` compensating node transform (see this
  // module's header doc, point 2) — the ONE node referencing our mesh, never
  // a general scene-graph walk. Defaults to the identity when absent so a
  // future non-quantized export (no node needed at all) still parses.
  const meshIndex = json.meshes.indexOf(mesh);
  const node = json.nodes?.find((n) => n.mesh === meshIndex);
  const [sx, sy, sz] = node?.scale ?? [1, 1, 1];
  const [tx, ty, tz] = node?.translation ?? [0, 0, 0];
  if (sx !== 1 || sy !== 1 || sz !== 1) geometry.scale(sx, sy, sz);
  if (tx !== 0 || ty !== 0 || tz !== 0) geometry.translate(tx, ty, tz);

  return geometry;
}

/**
 * Fetch + parse one flora GLB — NOT cached by URL (a deliberate departure from
 * the `assets.ts` `loadTexture` convention, a visual-overhaul slice 6 code-
 * review finding). `App.tsx` allows title → playing → exitToTitle → playing
 * without a page reload, and each `playing` mount's `floraUpgrade.ts` calls
 * `dispose()` on its swapped-in geometries when torn down; a module-level
 * cache keyed by URL would have handed the SECOND world's `upgradeFlora` call
 * the exact same (already-disposed) `THREE.BufferGeometry` instances the first
 * world's teardown just freed — a real replay hazard, not a hypothetical one.
 * Every call here re-fetches and re-parses, which is correct (each caller gets
 * its own independent geometry to dispose of on its own teardown) and cheap
 * (the browser's own HTTP cache serves the repeat network request; the models
 * are a few hundred vertices each). A plain `fetch`, not `assets.ts`'s
 * (removed) `loadModel`/`GLTFLoader` seam — see this module's header doc for
 * why.
 */
export function loadFloraGlb(url: string): Promise<THREE.BufferGeometry> {
  return fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`flora model fetch failed (${res.status}): ${url}`);
    return parseFloraGlb(await res.arrayBuffer());
  });
}
