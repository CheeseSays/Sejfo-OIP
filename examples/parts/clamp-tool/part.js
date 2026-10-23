// Clamp Gripper: an end-of-arm tool for the Six-Axis Robot, and for any rig with a link named `eoat`. Two jaws hang from a
// cross bar and close on the sides of a load, and the pickup volume is the box between them. The box is the part's
// setting: its width, height and depth are params, and the orange dots on a link at the box centre drag the three sizes
// in the viewport, drawn as a wire box that rides the arm. The robot's gripper picks whatever the box holds.
//
// The jaws stand still, drawn closed on the box. This is the source: `npm run build-parts` writes behavior.ts and
// rig.json from it.

const GRIPPER_FROM_EOAT = 0.156672 // the robot's `gripper` link sits this far below `eoat`, on the same axis
const FLANGE_PLATE = -0.0517 // adapter plate underside, in the eoat frame
const BAR_H = 0.05 // cross bar height
const BAR_Z = 0.16 // cross bar width
const JAW_T = 0.02 // jaw plate thickness
const PAD_T = 0.012 // rubber pad thickness, on the box side of the jaw

const GRIP_DEFAULT = 0.4 // the params' defaults: the manifest holds these, and the refs below move them with the params
const r8 = (n) => +n.toFixed(8)

definePart({
  manifest: {
    id: 'oip.clamp-tool',
    name: 'Clamp Gripper',
    category: 'Robot Tools',
    materials: [
      { id: 'clampPaint', color: [0.012, 0.16, 0.33], metalness: 0, roughness: 0.55 },
      { id: 'clampSteel', color: [0.18, 0.18, 0.19], metalness: 0.85, roughness: 0.45 },
      { id: 'clampPad', color: [0.02, 0.02, 0.022], metalness: 0, roughness: 0.8 },
    ],
  },
  // a passive part: it has no behaviour of its own, and its pickup volume is declared in rig()
  step() {},
  params: {
    gripX: { type: 'number', default: 0.4, min: 0.1, max: 3, step: 0.01, label: 'Grip width X (m)', group: 'Grip volume', handle: { kind: 'rigSize', link: 'grip', axis: 'x' }, desc: 'Gap between the jaws, which is the width of the pickup box. The orange dots on the tool drag it in the viewport, and they ride the arm.' },
    gripY: { type: 'number', default: 0.4, min: 0.1, max: 1.5, step: 0.01, label: 'Grip height Y (m)', group: 'Grip volume', handle: { kind: 'rigSize', link: 'grip', axis: 'y' }, desc: 'Height of the pickup box, centred on the box centre. A load whose centre is inside the box is picked.' },
    gripZ: { type: 'number', default: 0.4, min: 0.1, max: 3, step: 0.01, label: 'Grip depth Z (m)', group: 'Grip volume', handle: { kind: 'rigSize', link: 'grip', axis: 'z' }, desc: 'Length of the jaws along the load, and the depth of the pickup box.' },
    gripDepth: { type: 'number', default: 0.4, min: 0.15, max: 1.5, step: 0.01, label: 'Box centre below flange (m)', group: 'Grip volume', desc: 'How far below the tool flange the centre of the pickup box sits. The jaws are as long as it takes to reach the box.' },
  },
  rig(p) {
    const grip = { axis: 1, param: 'gripDepth' }
    return {
      // the frame the tool is drawn on, and the one at the pickup box centre that the size dots and wire box ride
      links: [
        { name: 'eoat', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'grip', parent: 'eoat', shape: { kind: 'frame' }, offset: [0, -GRIP_DEFAULT, 0], offsetParams: [{ ...grip, scale: -1 }] },
      ],
      joints: [],
      // Rides the robot's `eoat` link. The robot's gripper link is GRIPPER_FROM_EOAT below the flange frame, with +Y
      // pointing toward the load, so a box centred gripDepth below the flange is gripDepth - GRIPPER_FROM_EOAT up that
      // link. The robot's gripper link shares the tool's axes, which the box is symmetric about.
      mount: {
        link: 'eoat',
        grip: {
          link: 'gripper',
          zone: {
            size: [GRIP_DEFAULT, GRIP_DEFAULT, GRIP_DEFAULT],
            offset: [0, r8(GRIP_DEFAULT - GRIPPER_FROM_EOAT), 0],
            sizeParams: [{ axis: 0, param: 'gripX' }, { axis: 1, param: 'gripY' }, { axis: 2, param: 'gripZ' }],
            offsetParams: [{ ...grip, add: r8(-GRIPPER_FROM_EOAT) }],
          },
        },
      },
      // Standing alone it rests on the bottom of the box, flange up, until it is seated on a robot. The footprint follows
      // the depth only (a bounds field takes one param), so it is exact at the default box height.
      bounds: { length: r8(p.gripX + 2 * (PAD_T + JAW_T)), width: p.gripZ, top: 0, bottom: r8(-(p.gripDepth + GRIP_DEFAULT / 2)) },
    }
  },
  geometry(g, p) {
    const out = []
    // the adapter the wrist flange bolts to: a plate and a turned boss
    const ADAPTER_TOP = -0.0397
    out.push({
      desc: g.merge(
        g.bevelBox([0.192, 0.012, 0.318], [0, -0.0457, 0], 0.002, ['y-']),
        g.lathe([[0, ADAPTER_TOP], [0.07, ADAPTER_TOP], [0.07, -0.025], [0.062, -0.021], [0.062, -0.013], [0, -0.013]], { segments: 40 }),
      ),
      material: 'clampSteel',
      link: 'eoat',
    })
    // the cross bar under the plate, as wide as the jaws are apart
    const half = p.gripX / 2 + PAD_T + JAW_T
    const barTop = FLANGE_PLATE
    const barBottom = barTop - BAR_H
    const paint = [g.bevelBox([2 * half, BAR_H, BAR_Z], [0, (barTop + barBottom) / 2, 0], 0.004)]
    // jaw plates from the bar down past the bottom of the box, and pads on the box side of each
    const boxBottom = -(p.gripDepth + p.gripY / 2)
    const jawH = Math.max(barBottom - boxBottom, 0.02)
    const pads = []
    for (const sx of [-1, 1]) {
      paint.push(g.bevelBox([JAW_T, jawH, p.gripZ], [sx * (p.gripX / 2 + PAD_T + JAW_T / 2), barBottom - jawH / 2, 0], 0.003))
      pads.push(g.box([PAD_T, p.gripY, p.gripZ * 0.9], [sx * (p.gripX / 2 + PAD_T / 2), -p.gripDepth, 0]))
    }
    out.push({ desc: g.merge(...paint), material: 'clampPaint', link: 'eoat' })
    out.push({ desc: g.merge(...pads), material: 'clampPad', link: 'eoat' })
    return out
  },
})
