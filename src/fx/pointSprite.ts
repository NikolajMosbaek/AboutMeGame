// Shared soft-round point-sprite texture (visual-overhaul slice 7, coordinator
// polish pass). `THREE.PointsMaterial` with no `map` rasterizes every GL point
// as a literal hard-edged square — harmless at a glance in motion, but glaring
// in a still frame (the social-preview screenshot showed obvious white squares
// scattered over the hillside, coming from the ambient dust motes). Every
// point-based fx cloud in the game (ambient motes + falling leaves, the
// treasure-finale spiral, the discovery-burst fountain) shares this ONE small
// procedural radial-gradient `CanvasTexture` — the `props.ts` `makeLeafTexture`
// / `clouds.ts` `makeCloudPuffTexture` idiom: baked at runtime, no downloaded
// asset, zero shipped bytes — rather than each owning a near-identical bake.
//
// Deliberately NOT cached/memoized as a module-level singleton: each calling
// System constructs and disposes its own material, so each gets its own
// texture instance to own and dispose independently (the constitution's "no
// singletons where a caller should own its own resource" doctrine) — the cost
// is trivial (one tiny canvas per System, built once at construction).
//
// Returns `null` under environments with no real 2D canvas context (jsdom in
// tests), the same fallback shape `makeLeafTexture`/`makeCloudPuffTexture`
// already use: callers degrade to an unmapped (square, but headless tests
// never render pixels) `PointsMaterial`.

import * as THREE from "three";

/** Cuts the near-invisible fringe of the soft gradient — a cheap fill-rate
 *  win (discarded fragments skip the blend stage) as much as a shape fix; the
 *  texture itself is already fully transparent outside its baked circle. */
export const POINT_SPRITE_ALPHA_TEST = 0.05;

/** Bake a small soft-edged white circle on a transparent field: opaque core,
 *  smooth falloff to fully transparent by the rim. Every caller multiplies
 *  this by its own `color`/vertex colours (`PointsMaterial.map`), so one
 *  shared texture serves every blend mode (normal + additive) and every hue
 *  already in use across the game's point-based fx. */
export function makeSoftCircleSprite(): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);

  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.25, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}
