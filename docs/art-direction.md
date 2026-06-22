# Art direction & visual guide

- **Issue:** #16 — Art style & visual direction
- **Epic:** #2 — World & Environment
- **Refined by:** Epic 7 (#54 personal brand pass)

## The look: warm, low-poly, readable

**Stylised low-poly, flat-shaded, vertex-coloured.** Faceted geometry and a
warm palette over photorealism — it loads tiny (no terrain/material textures to
download, which protects the asset budget), runs fast on mid-range mobile, and
reads clearly so landmarks stand out as navigation targets. The mood is bright,
inviting and a little playful — a place you *want* to drive around, fitting a
personal, welcoming "come see how I work" tone.

## Principles

1. **Flat-shaded, faceted surfaces.** `flatShading: true` everywhere; geometry
   stays low-poly. The terrain is vertex-coloured by elevation, not textured.
2. **Colour carries meaning.** Terrain bands (sand → grass → rock → snow) read
   the landscape at a glance; each landmark + its beacon has a signature colour
   so it's a distinct target. Colours come from the design tokens / per-POI
   palette, never ad-hoc hex scattered through gameplay code.
3. **Readability over detail.** Key elements (landmarks, beacons, the vehicle)
   must pop against the background. Beacons are additive-blended glows visible
   from afar. Avoid visual noise that competes with wayfinding.
4. **Soft, warm light.** A warm key sun + cool hemisphere fill so shadowed faces
   never go black; exponential fog tints distance toward the horizon for depth.
5. **One palette, tokenised.** Base UI tokens live in `src/tokens.css`
   (deep-indigo ground, near-white text, amber accent). The 3D palette
   (sky, terrain, water, beacon colours) is centralised in the world modules.
   The Epic 7 brand pass tunes both from here.

## Palette (current)

| Role | Colour |
|------|--------|
| Sky (top → horizon) | `#3a78c2` → `#cfe4f2` |
| Water | `#2e6f9e` |
| Beach / grass / rock / snow | `#d9c79a` / `#5b8f4a` / `#49753c` / `#7a6f63` / `#eef2f5` |
| UI background / text / accent | `#14121f` / `#f5f4fb` / `#ffcb47` |
| Landmark beacons | per-POI, spread across the hue wheel (`worldConfig.ts`) |

This guide is intentionally light — it sets direction, not pixel specs. The
personal-brand pass (#54) is where the wordmark, favicon and final palette
choices land.
