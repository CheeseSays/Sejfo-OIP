# Part mounts: a tool that rides a link of another part

A tool is a part of its own that hangs on a link of the part it is parented to, and moves with that link. The Six-Axis
Robot's end-of-arm tool is one: the robot has a flange (the `eoat` link), and a Vacuum Tool seated there goes wherever
the flange goes. Swap the tool, resize it or leave the flange bare without touching the robot.

## Declaring a tool

A rig declares `mount` on its geometry (`RigMount`, [partPackage.ts](../src/core/parts/partPackage.ts)):

```js
rig(p) {
  return {
    links: [{ name: 'eoat', shape: { kind: 'frame' }, offset: [0, 0, 0] }],
    joints: [],
    mount: {
      link: 'eoat', // the host link it rides, by name
      grip: { link: 'gripper', zone: { size: [0.5, 0.7, 0.5], sizeParams: [{ axis: 0, param: 'toolSizeX' }, { axis: 2, param: 'toolSizeZ' }] } },
    },
    bounds: { length: p.toolSizeX, width: p.toolSizeZ, top: 0, bottom: -0.157 },
  }
}
```

- `link` is the host link the tool rides. The tool's origin sits on that link's frame, so the link carries the
  interface: the robot's `eoat` frame already holds the flange's offset and its half turn.
- `grip` is optional: the pickup volume the tool gives the host's gripper link `grip.link`. It is a box in that link's
  frame, sized by the tool's own params (`sizeParams`, the same shape as a box link's). A tool with no `grip` leaves the
  host's gripper as it is.
- The host declares nothing. Any rig with a link of that name takes the tool, and the link is usually a `frame`. A host
  gripper that has a tool picks inside the tool's volume. With no tool it should pick nothing, so the robot declares a
  2 cm volume on `gripper`: a case's centre is never inside it.

A part does not need a `snap` block to be seated. `geometry.mount` is its plug.

## Seating

A tool is seated when its `parent` is a part whose rig has the link `mount.link`. The parent is the ordinary soft
parent ([scene-composition.md](scene-composition.md)), so deleting or duplicating the host takes the tool with it, and the
scene tree shows the tool under the arm.

Dropping a tool near a host seats it: the snap engine solves a `linkSeat` plug
([part-snap-connectors.md](part-snap-connectors.md)) against every host link of that name. The tool goes to the link at
the pose the host rests in (its idle `pose`, its `scale`, its yaw) when the drag is within 0.25 m of it in plan, and the
commit soft-parents it. The link is metres above the floor, so the height of the drag does not matter: drop the tool
under the flange. A link that already carries a tool refuses another, and a tool never hosts one. The headless
`snap-part --write` and the agent's `snap_part` commit the same way. `check-layout` reports a tool that has no host.

A second tool that is parented to a link that already has one by other means is not seated: the first in the scene wins.

## What the host resolves

Seating is a seam ([seam-resolvers.md](seam-resolvers.md)), computed in [sceneMounts.ts](../src/core/scene/sceneMounts.ts)
and carried in `ResolvedContext`:

- `mountedOn` (render only) tells the tool where it rides.
- `mounts` (sim only) tells the host what tools are on it, with each tool's grip volume already resolved against the
  tool's own params. A tool resized, added or removed rebuilds the host's rig in the sim and nothing else.

## In the sim

The tool has no bodies. The host's rig is built with the tool's grip volume in place of the host link's own
(`withMountedGrips`), so the gripper picks what the tool's plate covers. The host's `scale` multiplies the volume as it
does every grip volume.

## In the view

A seated tool's visual is a child of the host's link group ([viewMounts.ts](../src/render/viewport/viewMounts.ts)), so every
joint pose, the host's scale and the host's own placement carry it with no per-frame work. The view re-seats it after the
host is rebuilt, because a rebuild replaces the link groups. It is excluded from the instance pool with the rest of the
link's subtree, and a moved host marks its tools dirty for the render bundle.

The host's lamps go to its tools: the tool's cups squash and its LED lights on the robot's `vacuumLamp`. The robot draws
a status lamp of its own on the flange for that lamp to exist.

## In the editor

A seated tool takes its pose from the link, so the editor does not transform it: no move or rotate gizmo, no
reposition, and the Inspector's Position and Rotation are disabled. Its stored position is where the flange stood at the
host's idle pose when it was seated, and nothing reads it while it is seated. To place a tool elsewhere, Unparent it in the
scene tree.

A tool with `rigSize` param handles draws its resize dots on the tool itself. A rig with no joints and such handles gets a
gizmo of the dots and the outline alone ([rigGizmo.ts](../src/render/parts/sdk/rigGizmo.ts)).

## Tests and gates

- [sceneMounts.test.ts](../src/core/scene/sceneMounts.test.ts): the seam, its keys and the seat position.
- [snapLinkSeat.test.ts](../src/core/snap/snapLinkSeat.test.ts): the snap and its commit.
- [multiGrab.test.ts](../src/sim/multiGrab.test.ts): a tool gives the hand its volume, and a bare hand picks nothing.
- [verify-tool-mount.mjs](../e2e/verify-tool-mount.mjs): drop the tool on the flange, follow every pose, scale, rebuild,
  lamp, resize dots, delete and undo.
