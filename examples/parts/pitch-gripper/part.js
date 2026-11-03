// Pitch Gripper: an end-of-arm tool for the Six-Axis Robot, and for any rig with a link named `eoat`. Two sections ride
// a cross rail, each a carriage with its own pickup volume, and a linear axis slides them apart or together. A cell
// picks a row of products with the sections close, then spreads them to set the two halves down in separate boxes.
//
// The tool is a part of its own with joints and grippers of its own, rooted on the robot's flange (docs/part-mounts.md).
// The program drives it by tags, since the robot's gripper is not the tool's: a pitch setpoint, one close command per
// section, and feedback for the pitch and for each section holding. Each section picks every product whose centre is in
// its box, so the count follows the box size and the pitch.
//
// This is the source. `npm run build-parts` writes behavior.ts and rig.json from it.

const RAIL_Y = -0.077 // rail centreline in the eoat frame, under the adapter plate
const RAIL_H = 0.05
const RAIL_Z = 0.16
const CARRIAGE_X = 0.16 // carriage length along the rail
const JAW_T = 0.02 // jaw plate thickness
const PAD_T = 0.012 // rubber pad thickness, on the product side of the jaw
const MAX_TRAVEL = 2 // joint envelope: half the largest open pitch the param allows
const AT_PITCH = 0.002 // pitch within this of the setpoint reads as arrived (m)

const r8 = (n) => +n.toFixed(8)

// the axis position, kept here because a part's state lives in its script
let pitch = null

definePart({
  manifest: {
    id: 'oip.pitch-gripper',
    name: 'Pitch Gripper',
    category: 'Robot Tools',
    commsParam: 'enableComms',
    materials: [
      { id: 'pitchPaint', color: [0.012, 0.16, 0.33], metalness: 0, roughness: 0.55 },
      { id: 'pitchSteel', color: [0.18, 0.18, 0.19], metalness: 0.85, roughness: 0.45 },
      { id: 'pitchPad', color: [0.02, 0.02, 0.022], metalness: 0, roughness: 0.8 },
    ],
  },
  joints: ['slideA', 'slideB'],
  grippers: ['gripA', 'gripB'],
  params: {
    sectionX: { type: 'number', default: 0.4, min: 0.1, max: 2, step: 0.01, label: 'Section length X (m)', group: 'Sections', handle: { kind: 'rigSize', link: 'gripA', axis: 'x' }, desc: 'Length of each section\'s pickup box along the rail. Size it to the products one section should take: a section picks every product whose centre is inside its box. The orange dots on the tool drag it, and they ride the arm.' },
    sectionY: { type: 'number', default: 0.4, min: 0.1, max: 1.5, step: 0.01, label: 'Section height Y (m)', group: 'Sections', handle: { kind: 'rigSize', link: 'gripA', axis: 'y' }, desc: 'Height of each pickup box, centred on the box centre.' },
    sectionZ: { type: 'number', default: 0.4, min: 0.1, max: 2, step: 0.01, label: 'Section depth Z (m)', group: 'Sections', handle: { kind: 'rigSize', link: 'gripA', axis: 'z' }, desc: 'Depth of each pickup box across the rail, and the length of the jaws.' },
    gripDepth: { type: 'number', default: 0.4, min: 0.15, max: 1.5, step: 0.01, label: 'Box centre below flange (m)', group: 'Sections', desc: 'How far below the tool flange the centre of each pickup box sits. The jaws are as long as it takes to reach the box.' },
    pitchMin: { type: 'number', default: 0.5, min: 0.1, max: 2, step: 0.01, label: 'Closed pitch (m)', group: 'Axis', desc: 'Centre-to-centre distance between the two boxes with the axis closed, which is where the tool rests. Keep it at least the section length, or the boxes overlap and a product between them is taken by both.' },
    pitchMax: { type: 'number', default: 1.2, min: 0.1, max: 4, step: 0.01, label: 'Open pitch (m)', group: 'Axis', desc: 'Centre-to-centre distance at the end of the axis travel. A setpoint beyond it is held at it.' },
    axisSpeed: { type: 'number', default: 0.5, min: 0.05, max: 3, step: 0.05, label: 'Axis speed (m/s)', group: 'Axis', desc: 'How fast the pitch changes. The two sections each travel half of it.' },
    enableComms: { type: 'boolean', default: false, label: 'Enable comms', group: 'Comms', desc: 'Connect this tool to a PLC program. Its tags appear once this is on. Without a program the tool rests closed with both sections open.' },
    pitchTag: { type: 'tag', dir: 'in', stType: 'REAL', default: '', label: 'Pitch tag (m, centre to centre)', group: 'Comms', desc: 'The pitch the program commands, between the closed and the open pitch. The axis moves there at the axis speed, so wait for Pitch reached before the sections set the load down.' },
    gripATag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Section A grip tag (true closes)', group: 'Comms', desc: 'Close section A on the products in its box. It is read continuously, so hold it true for the whole carry and drop it only once the products are where they belong. Section A is the one at the lower X.' },
    gripBTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Section B grip tag (true closes)', group: 'Comms', desc: 'Close section B, separately from section A. Section B is the one at the higher X.' },
    pitchOkTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Pitch reached tag', group: 'Comms', desc: 'True while the axis is at the commanded pitch.' },
    heldATag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Section A holding tag', group: 'Comms', desc: 'True while section A holds at least one product. A close that finds nothing in the box leaves it false.' },
    heldBTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Section B holding tag', group: 'Comms', desc: 'True while section B holds at least one product.' },
  },
  rig(p) {
    // each section sits half the closed pitch from the centre, and its joint adds half of whatever the axis has opened
    const side = (name, grip, sign) => [
      { name, parent: 'eoat', shape: { kind: 'frame' }, offset: [sign * p.pitchMin / 2, 0, 0] },
      // the frame at the pickup box centre: it carries the box, and the size dots ride it
      {
        name: grip,
        parent: name,
        shape: { kind: 'frame' },
        offset: [0, -p.gripDepth, 0],
        grip: { zone: { size: [p.sectionX, p.sectionY, p.sectionZ] } },
      },
    ]
    return {
      links: [{ name: 'eoat', shape: { kind: 'frame' }, offset: [0, 0, 0] }, ...side('secA', 'gripA', -1), ...side('secB', 'gripB', 1)],
      joints: [
        // the travel is set by the pitch params, which the behavior clamps to, so the limits are only the outer envelope
        { name: 'slideA', link: 'secA', type: 'prismatic', axis: [1, 0, 0], min: -MAX_TRAVEL, max: 0 },
        { name: 'slideB', link: 'secB', type: 'prismatic', axis: [1, 0, 0], min: 0, max: MAX_TRAVEL },
      ],
      // Rides the robot's `eoat` link. It gives the robot's gripper no volume: the tool's own sections do the picking.
      mount: { link: 'eoat' },
      // the footprint follows the open pitch only (a bounds field takes one param)
      bounds: { length: r8(p.pitchMax + CARRIAGE_X + 0.04), width: p.sectionZ, top: 0, bottom: r8(-(p.gripDepth + 0.2)) },
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
      material: 'pitchSteel',
      link: 'eoat',
    })
    // the cross rail the sections run on, long enough for both at the open pitch
    out.push({ desc: g.bevelBox([p.pitchMax + CARRIAGE_X + 0.04, RAIL_H * 0.6, RAIL_Z * 0.6], [0, -0.0517 - RAIL_H * 0.3, 0], 0.003), material: 'pitchSteel', link: 'eoat' })
    // each section: a carriage on the rail, and jaw plates either side of its box that reach below it
    const boxBottom = -(p.gripDepth + p.sectionY / 2)
    const jawTop = RAIL_Y - RAIL_H / 2
    const jawH = Math.max(jawTop - boxBottom, 0.02)
    for (const link of ['secA', 'secB']) {
      const paint = [g.bevelBox([CARRIAGE_X, RAIL_H, RAIL_Z], [0, RAIL_Y, 0], 0.004)]
      const pads = []
      for (const sx of [-1, 1]) {
        paint.push(g.bevelBox([JAW_T, jawH, p.sectionZ], [sx * (p.sectionX / 2 + PAD_T + JAW_T / 2), jawTop - jawH / 2, 0], 0.003))
        pads.push(g.box([PAD_T, p.sectionY, p.sectionZ * 0.9], [sx * (p.sectionX / 2 + PAD_T / 2), -p.gripDepth, 0]))
      }
      out.push({ desc: g.merge(...paint), material: 'pitchPaint', link })
      out.push({ desc: g.merge(...pads), material: 'pitchPad', link })
    }
    return out
  },
  // The axis ramps to the commanded pitch at the axis speed, holding its place between commands. Each joint travels half.
  step(ctx) {
    const { params } = ctx
    const comms = params.enableComms
    const lo = params.pitchMin
    const hi = Math.max(params.pitchMax, lo)
    const want = comms && params.pitchTag ? Math.min(Math.max(ctx.readNumber(params.pitchTag), lo), hi) : lo
    const cur = pitch === null ? lo : pitch
    const next = cur + Math.min(Math.max(want - cur, -params.axisSpeed * ctx.dt), params.axisSpeed * ctx.dt)
    pitch = next
    ctx.joints.slideA = -(next - lo) / 2
    ctx.joints.slideB = (next - lo) / 2
    ctx.grips.gripA = comms && params.gripATag ? !!ctx.readTag(params.gripATag) : false
    ctx.grips.gripB = comms && params.gripBTag ? !!ctx.readTag(params.gripBTag) : false
    if (comms) {
      if (params.pitchOkTag) ctx.writeTag(params.pitchOkTag, Math.abs(want - next) < AT_PITCH)
      if (params.heldATag) ctx.writeTag(params.heldATag, ctx.measured.grips.gripA)
      if (params.heldBTag) ctx.writeTag(params.heldBTag, ctx.measured.grips.gripB)
    }
  },
})
