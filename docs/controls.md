# Controls

- **Issues:** #23–#33 (Epic 3 — Movement & Controls)
- **Implemented in:** `src/movement/` (input, vehicle, followCamera)

One hover-craft, two modes on a real physics boundary — **drive** (grounded) and
**fly** (airborne) — toggled with one button. All three input devices write the
same normalised `ControlState`, so the vehicle never knows which is driving.

## Keyboard (#31)

| Key | Drive | Fly |
|-----|-------|-----|
| **W / ↑** | Accelerate | Pitch |
| **S / ↓** | Brake / reverse | Pitch (opposite) |
| **A / ←**, **D / →** | Steer | Bank (banked turn) |
| **Space** | — | Climb thrust |
| **Shift** (hold) | Boost | Boost |
| **F** | Toggle drive ⇄ fly | Toggle drive ⇄ fly |
| **E / Enter** | Interact / reveal (Epic 4) | — |

## Touch (#32)

Created lazily on first touch (desktop never sees it):
- **Left virtual joystick** — forward/back + steer.
- **▲ thrust pad** (right) — hold to climb in flight.
- **FLY** button — toggle mode. **USE** button — interact.

Styled in `tokens.css`; Epic 5's HUD can restyle them — they drive the same input.

## Gamepad (#33)

Standard mapping, polled each frame:
- **Left stick** — forward/back + steer.
- **Right trigger (RT)** — thrust. **Left trigger (LT)** — boost.
- **A** — interact. **Y** — toggle mode.

## Camera (#29, #30)

A follow camera trails behind and above the craft — flat behind on the ground,
full-3D in flight (a dive points it down). It's smoothed (eases, never snaps) and
never sinks below the ground beneath it, so it won't clip through a hill it
orbits.

## Feel (tuning)

Drive eases toward a target speed (cruise 54, boost 92), so boost is meaningful
and stopping coasts. Steering scales with speed and reverses when backing up.
Flight cruises forward automatically; pitch/bank steer it, Space adds lift, with
a ground-clearance floor and a soft ceiling. Numbers live in `TUNE` in
`vehicle.ts`.
