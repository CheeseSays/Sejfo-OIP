# Cargo bodies

Cargo that declares its own shape and what it is to the machines around it: a drum that rolls, a crate, a plastic
pallet a fork can take, a container that nests. App code reads what a body declares and never names the part
([part-libraries.md](part-libraries.md), "App code names capabilities, not parts"). The Containers library
([libraries/containers](../libraries/containers/)) holds the worked examples: the Drum (rolls), the IBC tote (forks,
heavy, carries a stack) and the Tote (separate contacts, nests), which is on the built-in tote shape. A rig that nests
is a test part, not a shipped one (src/sim/fixtures/nesting-bin), because a second bin beside the Tote would
duplicate it.

## Two kinds of cargo

- **Box, pallet and tote** declare `geometry: { kind: 'cargo', cargoKind, size }`. `cargoView` (core/frame.ts) turns
  one into a kind number (`CARGO_KIND_BOX` / `PALLET` / `TOTE`), half extents, colour, mass and attributes, and every
  consumer after that carries only those fields: a box shape, or the pallet's and tote's compounds
  (sim/cargoRegistry.ts `cargoShape`); one instanced batch for boxes and one per pallet footprint and tote size
  (render/viewport/boxes.ts); sensing against each body's oriented box.
- **A cargo part with its own body** is a `rig` with a `cargo` declaration (`CargoDecl` in core/parts/partPackage.ts:
  `friction`, `massParam`, `colorParam`). It is kind `CARGO_KIND_PART`.

## How a part's own body works

- **Recognised once.** `cargoView` returns a part-bodied view through `partCargoView`, and `isCargoPackage`
  (core/parts/partPackage.ts) is the package-level test the sim, the frame, the scaffold and the product dropdown share.
- **Collider** (core/cargoBody.ts `cargoPieces`): the rig's colliding links at rest pose, by the same rule machine rigs
  use (core/rig/rigLinkBody.ts `rigLinkEmitsBody`). A box link is a box; a cylinder link stays a cylinder (a machine rig's
  cylinder collides as its bounding box). The sim builds one Jolt compound per shape key
  (sim/bodyFactory.ts `buildPartCargoShape`, cached in the cargo registry) and shares it between bodies. A body keeps
  its `shapeKey`, so a unit join or split rebuilds it.
- **Validation:** `validatePartPackage` checks the declaration (a rig, no joints, named params of the right type).
  `validatePart` checks, at default params, that the rig has a colliding link and that their bounds are centred on
  the origin: cargo is centre-origin, and every box-shaped consumer (sensing, wrapping, placement) reads the bounds'
  half extents about the body's position.
- **Frame:** each body carries its shape key (`BoxFrame.shapes`) and the frame carries what each key is
  (`shapeRefs`: product and params). The wire sends shapes like `partIds`, only when they change, and each ref once
  per run (sim/frameWire.ts). The stopped scene's frame (`buildAuthoredCargoFrame`) carries the same, so a placed drum
  draws as a drum before Run.
- **Rendering** (render/parts/partCargoMesh.ts): the part's own visual built once per shape, baked into part-local
  space and merged per material, so every body of that shape draws in one instanced batch per material. The visual is
  built with the colour param white and again black; a material that differs is tinted per body, the rest keep their
  colour. A late-loading model moves the visual's structure version, and the batches rebuild. The builder loads on
  the first part-bodied row (a scene without one never loads it); the row draws nothing until then.
- **Spawning and promotion:** a Spawner whose Product is such a part spawns it as its shape (sim/cargoFlow.ts
  `spawnProduct`). A pick of a part-bodied body reports its product, so selecting a spawned drum makes it a drum, not
  a box (editor/controller/liveCargo.ts `promotedAs`).
- **Sensing** is unchanged: beams cast against the bounds as an oriented box, zones by centre. A beam on a drum reads
  its bounding box, close enough for a beam across a conveyor.

Tests: src/sim/cargoBodies.test.ts (a drum on its side rolls several times as far as a box of its size slides, it
stands on its end, one collider per shape, and the validation), src/sim/frameWire.test.ts, src/editor/controller/liveCargo.test.ts,
and e2e/verify-cargo-bodies.mjs (drums draw as their own visual stopped and running, a Spawner makes drums, 200 drums
cost the draws of 2).

## A part with more than one look

A body's drawn visual is keyed by its collider and colour, so two bodies that differ only in a param the collider ignores
would share one look. `cargo.visualParams` names such params (the Carton's `open`, `flat`, `foldA`, `foldB`, `tapedA` and
`tapedB`); their values go into the shape key (core/cargoBody.ts `cargoShapeKey`), so each combination gets its own
collider cache entry and its own batch. Use it for a handful of states, not a continuous value, since every distinct value
is another shape.

A link's `rotationParams` make a wall or a flap hinge with a param: a frame link whose rotation follows a param in degrees,
with the panel as its child. A cargo body has no joints, so this is how a part with a rigid body folds. The Carton's four
walls hang from frame links turned by `open`, so the section goes from flat to a parallelogram to a rectangle, and each
flap hangs from a hinge on its wall's end edge turned by the end's fold stage. Its collider is hollow too: four thin
walls and a floor across each end once that end is closed (`closedA`, `closedB`), so a product dropped in at an open end
stays in the case (src/sim/cartonFill.test.ts) and one dropped in at an open end it stands on falls through.

A machine changes a body from one look to another with `ctx.reform` / `reformHit` (sim/cargoFlow.ts `reformBoxes`): the
old body is replaced where it stands by one made from the product and params asked for, at the old one's speed, with its
marks, age and dressings, and the old one leaves without a completion. A body a rig gripper holds is remade in the
gripper's hand, at the same offset, so a robot can carry a case through its changes. A beam's hit says which face of the
body it hit (`face`), so a machine knows which end of a case faces it however the robot has turned it.

The Carton is the worked example, and the cell around it is passive. The Carton Opener is the table a flat sleeve lies on:
as the robot lifts the blank the section opens a step at a time. The Flap Folder closes the end that faces down, a stage at
a time as the case goes deeper into its funnel, and the Bottom Taper tapes the seam of whichever end faces its head once
that end is closed (from under the belt, or from over it). Each reads the case's marks through a beam (`open`, `foldA`,
`foldB`, `tapedA`, `tapedB` are product attributes) and reforms the one it sees. Tests: src/sim/cargoReform.test.ts,
src/sim/cartonCell.test.ts (a scripted hand carries a blank through all of it) and e2e/verify-carton-folds.mjs (the looks
draw as separate batches).

## Capabilities, not kinds

The engine never asks whether a body is a box, a pallet or a tote. It asks what the body is to the machine in front of
it, as bits on the body (core/frame.ts `CARGO_CAP_*`, `cargoCapsOf`), declared under `cargo` by any cargo part:

| Capability | What reads it | A built-in that has it |
|---|---|---|
| `forkPockets` | a fork's fit check, which says when the spread does not fit a face (sim/rigDriver.ts, core/pallet.ts) | pallet |
| `heavy` | the firmer solver island for a body that bears loads (sim/bodyFactory.ts makeCargoBody), and flow facts, which never count it dropped or tipped | pallet |
| `loadBase` | the stretch wrap, whose film starts at its mid-height, and the anchor of a unit load (core/cargoWrap.ts) | pallet |
| `separateContacts` | manifold reduction off, so a floor hovering over a foot does not sink (sim/bodyFactory.ts) | tote |
| `nestDepth` | placement: a body of the same shape set on it sits this much lower (core/frame.ts cargoSeatOn) | tote (its foot) |

A box, pallet or tote that declares none gets its kind's capabilities (`capsOfKind`), so stored versions keep
simulating as recorded. The old-parts corpus (src/sim/partCorpus.test.ts) checks this: it runs every stored version and
hashes each body's kind and rest pose. The capabilities travel with each body (`LiveBox.caps`) and in the frame (`BoxFrame.caps`); a frame built without
them (a test's) reads each body's kind's (`frameHasCap`).

## What each body is

Every cargo body carries what it was made as: a key (`cargoRefKey`; a part body's shape key) and, in the frame's
`shapeRefs`, its product and params. A placed part and a product spawn carry their own; a kind-only spawn
(`ctx.spawn({ kind })`, kept so stored part versions keep spawning) is the built-in of its kind at the standard its size
snapped to (`kindSpawnRef`). Selecting a spawned body makes it exactly that part (editor/controller/liveCargo.ts
`promotedAs`); a body made as no product stays transient, never a box guessed from its size. `test-project --cargo`, the
probes' rows and the agent's `get_cargo` report the product.

## Why box, pallet and tote keep their built-in shapes

Their colliders and visuals stay the shape kinds `cargoKind: 'box' | 'pallet' | 'tote'`: a generic vocabulary any part
can use, the way a rig link can be a box or a cylinder, not a rule about three parts. Rebuilding them as rigs would need
their standard sizes (an enum param, `'1200x800'`) to drive link sizes, which a rig's param refs cannot, and their
textured meshes (the cardboard and wood atlases) ported to models, a visual risk to every scene for no change in what
they do. Because the engine names none of them, any of them can move to a library like any other part.

What still names them, in src/core/parts/partIdCoupling.test.ts: a kind-only spawn's product (`kindSpawnRef`) and a stored
unit load that names no pieces (`unitPiecesOf`), both for stored part versions.

## Limits

- **Rollers.** A roller conveyor's deck is one kinematic surface, not individual rollers, so a drum rides it as on a
  belt and never wedges between rollers as a real one can. Boxes get the same simplification.
- **Soft cargo** (sacks, bags) is out of scope: a sack is a rigid body of its shape.
- **Draw cost** with many distinct shapes: each (part, params) pair is its own batches, so drums of twenty sizes are
  twenty sets. Nothing caps the number of distinct shapes.
