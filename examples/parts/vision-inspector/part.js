// Vision Inspector - an inspection arch over a conveyor whose camera checks that each case crosses it turned the way
// the line expects. Its local Z is the direction of travel, the two columns stand at +-X either side of the bed, and
// the part origin is the centre of the arch, on the floor.
//
// A case is inspected once, as it crosses the scan line just above the belt with its centre in the read window. The
// host reports the case's yaw with the hit (ctx.sense().yaw). The camera takes the case's length axis (its local X, the
// way a spawned box lies when it left a spawner facing the travel) and measures how far it is turned from the expected
// angle, folded by the product's symmetry: a box looks the same after a half turn, a square case after a quarter turn.
// A deviation within the tolerance passes. The result is held on the tags until the next case, with a pulse for the
// edge, a pass lamp and a fail lamp, and two counts, so a program can divert a case that fails.
//
// It sees the case's turn about the vertical only. Tilt, flipped faces and printed labels are not read.
//
// This is the part's source. `npm run build-parts` writes behavior.ts and rig.json from it.

const PULSE = 0.25 // s the done pulse and the pass or fail lamp stay lit after an inspection
const TAU = 2 * Math.PI
const RAD = Math.PI / 180
const SYMMETRY = { box: Math.PI, square: Math.PI / 2, none: TAU } // the turn after which the case looks the same

/** `a` folded into [-period / 2, period / 2] */
function fold(a, period) {
  return a - period * Math.round(a / period)
}

let count = 0
let rejects = 0
let pulse = 0 // s left on the done pulse and the lamp
let ok = false // the last verdict
let deviation = 0 // the last deviation in degrees, signed, + turned left seen from above

definePart({
  manifest: {
    id: 'oip.vision-inspector',
    name: 'Vision Inspector',
    category: 'Devices',
    materials: [
      { id: 'housing', color: [0.479, 0.509, 0.539], metalness: 0.6, roughness: 0.35 },
      { id: 'head', color: [0.06, 0.065, 0.075], metalness: 0.2, roughness: 0.5 },
      { id: 'cap', color: [0.05, 0.3, 0.55], metalness: 0.1, roughness: 0.45 },
      { id: 'lens', color: [0.18, 0.18, 0.18], metalness: 0, roughness: 0.3 },
    ],
  },
  lamps: ['scan', 'pass', 'fail'],
  params: {
    width: { type: 'number', default: 1.0, min: 0.4, max: 3, step: 0.01, label: 'Clear width (m)', desc: 'The gap between the two columns, across the direction of travel. Wider than the conveyor, so the columns stand clear of its legs.' },
    surfaceHeight: { type: 'number', default: 0.8, min: 0.2, max: 2, step: 0.01, label: 'Conveyor height (m)', desc: 'Height of the conveying surface under the arch: the bottom of the read zone.' },
    clearance: { type: 'number', default: 0.6, min: 0.2, max: 2, step: 0.01, label: 'Clearance (m)', desc: 'From the conveying surface up to the camera head. The tallest load must pass under it; the read zone fills that height.' },
    readDepth: { type: 'number', default: 0.5, min: 0.1, max: 2, step: 0.05, label: 'Read depth (m)', desc: 'How far along the direction of travel (local Z) the read window reaches, centred under the head. A case is inspected as it crosses the scan line once its CENTRE is in the window.' },
    expectedAngle: { type: 'number', default: 0, min: -180, max: 180, step: 1, label: 'Expected angle (deg)', desc: 'How a good case is turned, measured from the direction of travel to the case\'s length axis, + turning left seen from above. 0 is a case lying along the belt, 90 a case lying across it.' },
    tolerance: { type: 'number', default: 10, min: 0, max: 90, step: 0.5, label: 'Tolerance (deg)', desc: 'How far from the expected angle a case may be turned and still pass, either way.' },
    symmetry: {
      type: 'enum', default: 'box', label: 'Case symmetry',
      options: [{ value: 'box', label: 'Looks the same every half turn (box)' }, { value: 'square', label: 'Every quarter turn (square case)' }, { value: 'none', label: 'Only a full turn (front matters)' }],
      desc: 'Which turns of the case the camera cannot tell apart. A plain rectangular case is the same after a half turn, so one turned 180 degrees passes. Choose the last for a product whose front must face forward: its front is the case\'s own +X end.',
    },
    showBeam: { type: 'boolean', default: false, label: 'Show scan line', desc: 'Draw the scan line across the conveyor. A viewing aid only.' },
    beamColor: { type: 'color', default: '#0d4d8c', label: 'Beam color', desc: 'Paint of the crossbeam the head hangs from.' },
    doneTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Inspected tag (pulse)', group: 'Comms', desc: 'Goes true for a quarter of a second each time a case is inspected. Take its rising edge to read the result tags.' },
    okTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Rotation OK tag', group: 'Comms', desc: 'The last verdict: true when the case was within tolerance, false when it was turned too far. Set on the same scan the inspected pulse rises, and held until the next case.' },
    angleTag: { type: 'tag', dir: 'out', stType: 'REAL', default: '', label: 'Deviation tag (deg)', group: 'Comms', desc: 'How far the last case was from the expected angle, in degrees, + turned left. Within plus or minus half the symmetry turn.' },
    countTag: { type: 'tag', dir: 'out', stType: 'DINT', default: '', label: 'Inspected count tag', group: 'Comms', desc: 'Running total of cases inspected this run.' },
    rejectCountTag: { type: 'tag', dir: 'out', stType: 'DINT', default: '', label: 'Rejected count tag', group: 'Comms', desc: 'Running total of cases that failed the rotation check this run.' },
  },
  rig(p) {
    return {
      links: [
        { name: 'surface', shape: { kind: 'frame' }, offset: [0, p.surfaceHeight, 0] },
        { name: 'read', parent: 'surface', shape: { kind: 'frame' }, offset: [0, p.clearance * 0.5, 0], zone: { size: [p.width, p.clearance, p.readDepth] } },
        { name: 'scanLine', parent: 'surface', shape: { kind: 'frame' }, offset: [-p.width * 0.5, 0.05, 0], beam: { range: 1.0, rangeParam: 'width', showParam: 'showBeam', axis: [1, 0, 0] } },
      ],
      joints: [],
      bounds: { length: p.width + 0.17, width: 0.2, top: p.surfaceHeight + p.clearance + 0.264 },
    }
  },
  geometry(g, p) {
    const width = typeof p.width === 'number' && p.width > 0 ? p.width : 1.0
    const s = typeof p.surfaceHeight === 'number' ? p.surfaceHeight : 0.8
    const c = typeof p.clearance === 'number' && p.clearance > 0 ? p.clearance : 0.6
    // two aluminium profiles on floor plates and a crossbeam resting on them, as the Barcode Scanner's arch. The head
    // hangs under the beam's centre: a camera body, a lens barrel pointing down and a ring light round it
    const PW = 0.05, PD = 0.1, FOOT_X = 0.14, FOOT_Z = 0.22, FOOT_T = 0.012, B = 0.003
    const HEAD_H = 0.12, BEAM_H = 0.08
    const hw = width / 2
    const beamBottom = s + c + HEAD_H
    const top = beamBottom + BEAM_H
    const win = s + c
    const bb = (size, center, square) => g.bevelBox(size, center, B, square)
    const parts = []
    for (const side of [-1, 1]) {
      const cx = side * (hw + PW / 2)
      parts.push({
        desc: g.merge(
          bb([PW, beamBottom - FOOT_T, PD], [cx, (FOOT_T + beamBottom) / 2, 0], ['y-', 'y+']),
          bb([FOOT_X, FOOT_T, FOOT_Z], [cx, FOOT_T / 2, 0], ['y-']),
        ),
        material: 'housing', collision: 'box',
      })
    }
    parts.push({ desc: bb([width + 2 * PW, BEAM_H, PD], [0, beamBottom + BEAM_H / 2, 0]), material: 'cap', colorParam: 'beamColor', collision: 'box' })
    const dark = []
    const bodyTop = beamBottom - 0.028
    dark.push(bb([0.14, bodyTop - win - 0.05, 0.1], [0, (win + 0.05 + bodyTop) / 2, 0]))
    dark.push(g.lathe([[0, win + 0.05], [0.032, win + 0.05], [0.032, win + 0.012], [0.026, win + 0.012], [0, win + 0.012]], { axis: 'y', center: [0, 0, 0], segments: 20 }))
    dark.push(bb([0.1, 0.028, 0.07], [0, bodyTop + 0.014, 0], ['y+']))
    parts.push({ desc: g.merge(...dark), material: 'head' })
    // the ring light round the lens, lit while a case is in the window
    parts.push({ desc: g.lathe([[0.034, win + 0.014], [0.062, win + 0.014], [0.062, win + 0.024], [0.034, win + 0.024]], { axis: 'y', center: [0, 0, 0], segments: 24 }), material: 'lens', lamps: [{ name: 'scan', emissive: [0.9, 0.95, 1] }] })
    // the verdict lamps on top of the beam: green for a pass, red for a fail
    parts.push({ desc: g.lathe([[0, 0], [0.026, 0], [0.026, 0.024], [0, 0.03]], { axis: 'y', center: [-0.04, top, 0], segments: 14 }), material: 'lens', lamps: [{ name: 'pass', emissive: [0.1, 1, 0.2] }] })
    parts.push({ desc: g.lathe([[0, 0], [0.026, 0], [0.026, 0.024], [0, 0.03]], { axis: 'y', center: [0.04, top, 0], segments: 14 }), material: 'lens', lamps: [{ name: 'fail', emissive: [1, 0.1, 0.05] }] })
    return parts
  },
  step(ctx) {
    const inZone = ctx.zone('read')
    // a case is inspected once: it must be in the window, unchecked, and on the scan line. Marks land after the tick,
    // so a case checked this tick shows as marked from the next one
    const unchecked = inZone - ctx.marked('read', 'inspected')
    const line = ctx.sense('scanLine')
    if (unchecked > 0 && line.hit && typeof line.yaw === 'number' && !(line.marks && line.marks.inspected)) {
      const period = SYMMETRY[ctx.params.symmetry] || SYMMETRY.box
      // the part's local +Z points at heading - 90 degrees, and the camera measures from there
      const travel = ctx.heading() - Math.PI / 2
      const dev = fold(line.yaw - travel - ctx.params.expectedAngle * RAD, period)
      deviation = dev / RAD
      ok = Math.abs(deviation) <= ctx.params.tolerance + 1e-9
      count += 1
      if (!ok) rejects += 1
      pulse = PULSE
      ctx.markHit('scanLine', 'inspected', true)
      ctx.markHit('scanLine', 'rotationOk', ok)
    } else if (pulse > 0) {
      pulse = Math.max(0, pulse - ctx.dt)
    }
    ctx.lamps.scan = inZone > 0
    ctx.lamps.pass = pulse > 0 && ok
    ctx.lamps.fail = pulse > 0 && !ok
    if (ctx.params.doneTag) ctx.writeTag(ctx.params.doneTag, pulse > 0)
    if (ctx.params.okTag) ctx.writeTag(ctx.params.okTag, ok)
    if (ctx.params.angleTag) ctx.writeNumber(ctx.params.angleTag, deviation)
    if (ctx.params.countTag) ctx.writeNumber(ctx.params.countTag, count)
    if (ctx.params.rejectCountTag) ctx.writeNumber(ctx.params.rejectCountTag, rejects)
  },
})
