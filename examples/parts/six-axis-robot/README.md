# Six-Axis Robot: a first-party part on the public SDK

The built-in Six-Axis robot is authored **entirely against the public part SDK**, the same SDK external authors
use. Built-ins are custom parts, so an author can read any first-party part to learn from it.

Its kinematics are exact: a [kinematic-parity test](../../../src/render/parts/sixAxisRigParity.test.ts) pins its
gripper to the world position `robotForwardKinematics` (`src/render/parts/robotKinematics.ts`) gives, for every
joint pose.

## What's here

- **`part.js`** is the source to read, and a robot controller in miniature. The robot owns its jobs: short
  programs of steps (Move to a named waypoint, stopping on it or blending through it; Vacuum on/off; Wait; Wait for
  an input; Set an output) taught in the Inspector. A PLC runs a job by number (command tag + an Execute edge) and
  waits for Done. An Enable input holds the arm where it is while the cell is unsafe. Motion is one coordinated
  trapezoidal profile per move, and blend points overlap two moves so each joint's speed changes smoothly instead
  of jumping. A robot with no jobs falls back to single moves (the command is a waypoint row). It is authored only
  against `ctx`, with no host handles and no `Date`/`Math.random` (the determinism gate enforces it).
  [src/sim/sixAxisRobotJobs.test.ts](../../../src/sim/sixAxisRobotJobs.test.ts) pins the job contract, and
  [src/editor/palletizerCell.test.ts](../../../src/editor/palletizerCell.test.ts) runs the demo's jobs against it.
- **`rig.json`** is the rig: a tree of 21 links (12 transform-only `frame` pivots and 9 per-node `mesh` links) and
  6 revolute joints, plus the ORM material `sixaxis` for the arm and two plain finishes for the flange's vacuum
  status lamp. The pivot positions, the shoulder and elbow frames, and each linkage's mesh-local placement come from
  the project's own robot model. Placements are quaternions, because they are CAD axis permutations that Euler
  angles can't express cleanly.
- **The tool** is not the robot's. The `eoat` frame on the wrist flange is where a tool part seats, and the robot
  draws only a vacuum status lamp on the flange. The [Vacuum Tool](../vacuum-tool/part.js) is the first-party tool: a
  resizable suction plate that is dropped on the flange, rides it through every joint move, and gives the robot's
  `gripper` link the pickup volume (its plate). A robot with no tool picks nothing. The robot's vacuum lamp reaches
  the tool, so the cups close with the vacuum. See [part-mounts.md](../../../docs/part-mounts.md) and the
  [part authoring guide](../../../docs/part-authoring-guide.md#riding-a-hosts-link-mount-a-tool).

## How it's built

`part.js` is the source: the kinematics, the rig (`rig()`), the flange lamp `geometry()` and the controller.
`rig.json` + `behavior.ts` are **built** from it, so edit `part.js`, not the output. The committed `rig.json`
names its GLB + textures as URL assets (`/models/SixAxisRobot.glb` and `/models/sixaxis/…`, served from
`public/models/`), so it loads on its own in the app. The multi-MB model files are not committed in this folder.

```sh
npm run build-parts -- six-axis-robot
# → examples/parts/six-axis-robot/{rig.json, behavior.ts}
```

The parity test loads the committed example itself (`examplePart('oip.six-axis-robot')`).

Browser smoke tests (each starts its own server, see [e2e/_server.mjs](../../../e2e/_server.mjs)):

```sh
node e2e/verify-robot-cycle.mjs            # the arm articulates and picks a layer in the running demo
node e2e/verify-robot-jobs-inspector.mjs   # the Inspector's job editor: named steps, pose preview, live step
node e2e/verify-prod-draco-rigs.mjs        # meshes decode and textures load from the production build
```

## Capabilities it uses

The robot relies on three general-purpose features of the custom-part format:

- **`frame` links**: transform-only pivots (no geometry), for kinematic joint chains.
- **`quat` rest rotations**: for arbitrary rotation matrices an Euler angle can't express.
- **package `materials`**: a PBR/ORM material (albedo + packed ORM + optional normal) a `mesh` link references
  to override the GLB's own material, plus geometry-only per-node mesh refs (the rig owns placement).
