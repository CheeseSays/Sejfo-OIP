// Bottom Taper: a tape head at a gap in the conveyor that tapes the seam at the end of a case that faces it, as the case
// passes. The case comes down the line standing on its closed end (the Flap Folder closes it), and the head, in a gap
// between rollers, lays a strip of tape down that seam as the case's centre goes over it. With Side set to Top it tapes
// the end that faces up instead, from a head over the line, which is how the other end is taped once the case has been
// filled, folded and turned. Nothing here needs a program.
//
// What it does is one ctx.reformHit on the case at the head: the Carton's `tapedA` or `tapedB` goes from 0 to 1, a strip
// of tape the length of the case down that end's seam. Which end is the one the beam hits (the Carton's -Z end is A and its
// +Z end B). It only tapes an open Carton whose end is closed (fold stage 6) and not yet taped, so a case with open flaps
// goes through untouched, and a case is taped once at each end. The roll turns for a moment as it applies the tape.
//
// Part frame: the origin is on the conveyor surface over the head, with the line flowing along +X. A zone along the line
// says when a case's centre is over the head and a beam at the head reads its face. The bottom head stands under the
// conveying surface in a gap between rollers, and the top head hangs over the line.
//
// This is the part's source. `npm run build-parts` writes behavior.ts and rig.json from it.

const SPIN_FOR = 1.0 // s the roll turns after a case is taped
const SPIN_RATE = 6 // rad/s
const RANGE = 0.6

let spin = 0
let angle = 0
let taped = 0

definePart({
  joints: ['roll'],
  manifest: {
    id: 'oip.bottom-taper',
    name: 'Bottom Taper',
    category: 'Equipment',
    commsParam: 'enableComms',
    materials: [
      { id: 'frame', color: [0.0176, 0.0802, 0.1946], metalness: 0.2, roughness: 0.55 },
      { id: 'steel', color: [0.4793, 0.5149, 0.5647], metalness: 0.5, roughness: 0.35 },
      { id: 'head', color: [0.8879, 0.5089, 0.0048], metalness: 0.1, roughness: 0.5 },
      { id: 'tape', color: [0.55, 0.38, 0.18], metalness: 0, roughness: 0.35 },
    ],
  },
  params: {
    side: { type: 'enum', default: 'bottom', options: [{ value: 'bottom', label: 'Bottom' }, { value: 'top', label: 'Top' }], label: 'Tape the end facing', desc: 'Bottom tapes the end of the case that stands on the belt, with a head under the line. Top tapes the end that faces up, from a head over it.' },
    standHeight: { type: 'number', default: 0.9, min: 0.2, max: 2.5, step: 0.01, label: 'Stand height (m)', desc: 'Height of the conveying surface. The stand runs from the head down to the floor.' },
    frameColor: { type: 'color', default: '#24507a', label: 'Frame color', group: 'Colors', desc: 'Paint of the stand.' },
    showBeam: { type: 'boolean', default: false, label: 'Show beam', desc: 'Draw the eye at the head.' },
    enableComms: { type: 'boolean', default: false, label: 'Enable comms', group: 'Comms', desc: 'Connect this taper to a PLC program. Its tag appears once this is on.' },
    countTag: { type: 'tag', dir: 'out', stType: 'DINT', default: '', label: 'Cases taped tag', group: 'Comms', desc: 'How many ends this taper has taped since the run started.' },
  },
  rig() {
    return {
      links: [
        { name: 'roll', shape: { kind: 'frame' }, offset: [0, -0.16, 0] },
        // the eyes at the head, one looking up from under the line and one looking down from over it
        { name: 'eyeUp', shape: { kind: 'frame' }, offset: [0, -0.3, 0], beam: { range: RANGE, showParam: 'showBeam', axis: [0, 1, 0] } },
        { name: 'eyeDown', shape: { kind: 'frame' }, offset: [0, 0.9, 0], beam: { range: RANGE + 0.3, showParam: 'showBeam', axis: [0, -1, 0] } },
        // a case's centre over the head: a short zone along the line
        { name: 'head', hidden: true, collision: 'none', shape: { kind: 'frame' }, offset: [0, 0.25, 0], zone: { size: [0.08, 0.5, 0.9] } },
      ],
      joints: [{ name: 'roll', link: 'roll', type: 'revolute', axis: [0, 0, 1], min: -Math.PI, max: Math.PI }],
      bounds: { length: 0.6, width: 0.9, top: 1.0, bottom: -1 },
    }
  },
  geometry(g, p) {
    const sh = typeof p.standHeight === 'number' && isFinite(p.standHeight) ? p.standHeight : 0.9
    const top = p.side === 'top'
    const box = (list, x0, x1, y0, y1, z0, z1, square) => {
      list.push(g.bevelBox([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0.004, square))
    }
    const frame = [], steel = [], head = [], tape = []
    if (!top) {
      // the stand: two legs under the head and a plate between them that carries it
      for (const z of [-0.2, 0.2]) box(frame, -0.04, 0.04, -sh, -0.3, z - 0.03, z + 0.03, ['y-'])
      box(frame, -0.08, 0.08, -0.32, -0.3, -0.25, 0.25)
      // the head: a housing, an applicator roller that stands up into the gap, and the roll of tape on the side
      box(head, -0.07, 0.07, -0.3, -0.1, -0.1, 0.1)
      head.push(g.lathe([[0, -0.1], [0.025, -0.1], [0.025, 0.1], [0, 0.1]], { axis: 'z', center: [0, -0.03, 0], segments: 20 }))
      tape.push(g.lathe([[0, 0.12], [0.07, 0.12], [0.07, 0.17], [0, 0.17]], { axis: 'z', center: [0, 0, 0], segments: 28 }))
      tape.push(g.lathe([[0, 0.17], [0.075, 0.17], [0.075, 0.175], [0, 0.175]], { axis: 'z', center: [0, 0, 0], segments: 28 }))
      box(steel, -0.01, 0.01, -0.16, 0.0, 0.1, 0.12)
    } else {
      // a gantry over the line, legs to the floor and a head hanging from it down to the case
      for (const z of [-0.5, 0.5]) box(frame, -0.04, 0.04, -sh, 0.9, z - 0.03, z + 0.03, ['y-'])
      box(frame, -0.08, 0.08, 0.86, 0.9, -0.5, 0.5)
      box(head, -0.07, 0.07, 0.62, 0.86, -0.1, 0.1)
      head.push(g.lathe([[0, -0.1], [0.025, -0.1], [0.025, 0.1], [0, 0.1]], { axis: 'z', center: [0, 0.6, 0], segments: 20 }))
      steel.push(g.lathe([[0, 0.12], [0.07, 0.12], [0.07, 0.17], [0, 0.17]], { axis: 'z', center: [0, 0.74, 0], segments: 28 }))
    }
    const m = (list) => g.merge.apply(g, list)
    return [
      { desc: m(frame), material: 'frame', colorParam: 'frameColor' },
      { desc: m(steel), material: 'steel' },
      { desc: m(head), material: 'head' },
      ...(tape.length ? [{ desc: m(tape), material: 'tape', link: 'roll' }] : []),
    ]
  },
  step(ctx) {
    const p = ctx.params
    const dt = ctx.dt
    // a case whose centre is over the head, its end that faces the head closed and not yet taped
    if (ctx.zone('head') > 0) {
      const beam = p.side === 'top' ? 'eyeDown' : 'eyeUp'
      const hit = ctx.sense(beam)
      const marks = hit.marks
      const end = hit.face === '-z' ? 'A' : hit.face === '+z' ? 'B' : null
      if (hit.hit && marks && marks.open === 1 && end !== null) {
        const fold = marks[end === 'A' ? 'foldA' : 'foldB']
        const done = marks[end === 'A' ? 'tapedA' : 'tapedB']
        if (fold === 6 && done !== 1) {
          ctx.reformHit(beam, { part: 'oip.carton', from: 'oip.carton', params: { [end === 'A' ? 'tapedA' : 'tapedB']: 1 } })
          taped += 1
          spin = SPIN_FOR
        }
      }
    }
    if (spin > 0) {
      spin = Math.max(0, spin - dt)
      angle += SPIN_RATE * dt
      if (angle > Math.PI) angle -= 2 * Math.PI
    }
    ctx.joints.roll = angle
    ctx.display('taped', taped)
    if (p.enableComms && p.countTag) ctx.writeNumber(p.countTag, taped)
  },
})
