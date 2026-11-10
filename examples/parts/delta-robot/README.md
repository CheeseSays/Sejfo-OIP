# Delta Robot: a parallel-arm pick-and-place robot with a proxy model

A first-party part on the public SDK, with the Six-Axis Robot's job logic. Its model is a proxy built from primitives; a
real delta model is meant to replace the meshes and keep everything else.

## What's here

- **`part.js`** is the source: the mechanism's numbers, the rig (`rig()`), the status lamp (`geometry()`) and the
  controller. The controller is the Six-Axis Robot's: jobs of Move, Vacuum, Wait, Wait for and Set steps, run by a command
  number and an Execute edge, with Done, Enable and four inputs and outputs. It differs in what a waypoint is: a place
  (x, y, and z lowered below home, in metres) rather than joint angles, reached by a straight line under one trapezoidal
  profile (m/s, m/s²), with via points blended by overlapping two moves.
- **`rig.json`** and **`behavior.ts`** are built from it (`npm run build-parts -- delta-robot`). Edit `part.js`.

## How the rig works

The platform rides three prismatic joints, `x`, `y` and `z` (z is down), on the frames `slideX`, `slideY` and `platform`. The
three arm joints `a1`..`a3` are `cosmetic`: nothing commands them. The rig's `delta` block ([RigDelta](../../../src/core/parts/partPackage.ts))
makes the pose resolver solve them from the platform's place ([rigPose.ts](../../../src/core/rig/rigPose.ts)
`deltaArmAngles`), so the arms follow the platform in a run, in the pose gizmo and at the idle pose. Each rod pair is two
`aim` links from the elbow to its `end` frame on the platform.

Because the gizmo, the idle `pose` row and Capture Pose list only non-cosmetic joints, they see `x`, `y` and `z`, and the
end-effector drag moves the platform in space. The solver clamps the platform joints to their limits first, and the work area (±0.3 m across, 0.45 m of lowering) keeps every arm inside its own limits
([deltaRigParity.test.ts](../../../src/render/parts/deltaRigParity.test.ts) sweeps it).

## Tracking a moving product

The platform can ride a frame that slides with an external value, so it picks a product as it travels on a conveyor. The
value is the **Tracking position tag** (a REAL: a distance sensor's reading, or a conveyor's encoder). While tracking is
on, the platform is offset along the **Tracking direction** (degrees across the work plane, 0 along +X) by the tag's
change since tracking began, times the **Tracking scale** (metres per unit, negative to reverse).

Tracking switches on from a `Track` job step or the **Track tag** (true follows; for robots without jobs). It starts
with no jump, and the moves that follow are planned in the moving frame, so a Move down, a Vacuum step and a Move up
stay over the product. `Track Off` keeps the platform where it is and the next move leaves from there. The tracked place
is clamped to the work area, and a robot that is not enabled keeps its place on the frame.

## Tools

The `eoat` frame under the platform is where a tool part seats, as on the Six-Axis Robot's flange, and the bare `gripper`
link takes the tool's pickup volume (`mount.grip`). A Vacuum Tool dropped under the platform seats and rides it
([part-mounts.md](../../../docs/part-mounts.md)).

## Replacing the proxy

Keep the link names a behavior, a tool or a test reads (`platform`, `eoat`, `gripper`, the slides and the arm joints), the
`delta` numbers, and the platform-level rule. Replace the primitive links with `mesh` links on the same frames. The
numbers `UPPER`, `ROD`, `ANCHOR`, `SHOULDER_R` and `SHOULDER_Y` in `part.js` must then match the model's pivots.

```sh
npm run build-parts -- delta-robot
node e2e/verify-delta-robot.mjs    # a tool seats, every rod keeps its length, the gizmo drags the platform
```
