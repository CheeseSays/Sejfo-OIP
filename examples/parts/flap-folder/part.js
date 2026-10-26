// Flap Folder: a static funnel of plows that folds the flaps at one end of a case pushed down into it. A robot carries an
// open case, the end it wants closed first, and presses it into the funnel. The two end plows close the short flaps and
// the two side plows then close the long ones, so the deeper the case goes the more of that end is shut. Nothing here
// moves, and it needs no program.
//
// What it does is one ctx.reformHit each time the case goes a stage deeper: the end's fold stage (the Carton's `foldA` or
// `foldB`) rises from 0 to 6, three stages for the short end flaps and three for the long side flaps. The stage is read
// from where that end's face is, by a beam that looks up from under the funnel, and which end it is comes from the face
// the beam hits, so the robot can present either end and the other stays as it was. It never goes back: lifting the case
// out leaves it folded. The case may stay in the robot's gripper throughout (a rig gripper keeps hold of a case that is
// remade in its hand). Only an open Carton is folded, and only at an end that faces down.
//
// Part frame: the origin is at the centre of the funnel's mouth, with the funnel running 0.22 m down from it and the beam
// looking up from 0.4 m below. The case is pushed straight down, the end to close first. Set the case's section so the
// funnel fits it; the plows end 5 mm clear of it.
//
// This is the part's source. `npm run build-parts` writes behavior.ts and rig.json from it.

const DEPTH = 0.22 // from the mouth down to the throat: the stroke over which the flaps close
const EYE_Y = -0.4 // the beam's emitter, under the throat
const FLARE = 0.12 // how far each plow stands off the case at the mouth
const CLEAR = 0.005

definePart({
  manifest: {
    id: 'oip.flap-folder',
    name: 'Flap Folder',
    category: 'Equipment',
    materials: [
      { id: 'frame', color: [0.0176, 0.0802, 0.1946], metalness: 0.2, roughness: 0.55 },
      { id: 'steel', color: [0.4793, 0.5149, 0.5647], metalness: 0.5, roughness: 0.35 },
      { id: 'plow', color: [0.8879, 0.5089, 0.0048], metalness: 0.1, roughness: 0.5 },
    ],
  },
  params: {
    cartonLength: { type: 'number', default: 0.4, min: 0.1, max: 1.2, step: 0.005, label: 'Case length (m)', desc: 'The case\'s section along X. The two end plows close to it.' },
    cartonWidth: { type: 'number', default: 0.3, min: 0.1, max: 1, step: 0.005, label: 'Case width (m)', desc: 'The case\'s section along Z. The two side plows close to it.' },
    standHeight: { type: 'number', default: 0.9, min: 0.2, max: 2.5, step: 0.01, label: 'Stand height (m)', desc: 'Height of the funnel mouth above the floor. The legs run from the funnel down to it.' },
    frameColor: { type: 'color', default: '#24507a', label: 'Frame color', group: 'Colors', desc: 'Paint of the legs and the funnel frame.' },
    showBeam: { type: 'boolean', default: false, label: 'Show beam', desc: 'Draw the depth beam under the funnel.' },
  },
  rig() {
    return {
      links: [{ name: 'depth', shape: { kind: 'frame' }, offset: [0, EYE_Y, 0], beam: { range: 0.6, showParam: 'showBeam', axis: [0, 1, 0] } }],
      joints: [],
      bounds: { length: 1.0, width: 0.9, top: 0.1, bottom: -1 },
    }
  },
  geometry(g, p) {
    const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d)
    const L = num(p.cartonLength, 0.4), W = num(p.cartonWidth, 0.3), sh = num(p.standHeight, 0.9)
    const box = (list, x0, x1, y0, y1, z0, z1, square) => {
      list.push(g.bevelBox([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0.004, square))
    }
    const frame = [], steel = [], plow = []
    // the plows: a plate on each side, leaning in from the mouth to the throat
    const lean = (flare) => Math.atan2(flare, DEPTH)
    const slant = Math.hypot(FLARE, DEPTH)
    for (const s of [-1, 1]) {
      // end plows (±X), rotated about Z so the top leans out
      const ax = lean(FLARE) * -s
      const cx = s * (L / 2 + CLEAR + FLARE / 2)
      plow.push(g.transform(g.bevelBox([0.01, slant, W + 0.2], [0, 0, 0], 0.003), { rotate: [0, 0, Math.sin(ax / 2), Math.cos(ax / 2)], translate: [cx, -DEPTH / 2, 0] }))
      // side plows (±Z), rotated about X so the top leans out
      const az = lean(FLARE) * s
      const cz = s * (W / 2 + CLEAR + FLARE / 2)
      plow.push(g.transform(g.bevelBox([L + 0.2, slant, 0.01], [0, 0, 0], 0.003), { rotate: [Math.sin(az / 2), 0, 0, Math.cos(az / 2)], translate: [0, -DEPTH / 2, cz] }))
    }
    // the frame: a ring round the mouth on four legs to the floor, and a cross member under the throat that holds the beam
    const ox = L / 2 + FLARE + 0.05, oz = W / 2 + FLARE + 0.05
    box(frame, -ox, ox, -0.03, 0, -oz, oz)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(frame, sx * ox - 0.025, sx * ox + 0.025, -sh, 0, sz * oz - 0.025, sz * oz + 0.025, ['y-'])
    box(frame, -ox, ox, EYE_Y - 0.05, EYE_Y - 0.02, -0.02, 0.02)
    box(steel, -0.02, 0.02, EYE_Y - 0.02, EYE_Y, -0.02, 0.02)
    const m = (list) => g.merge.apply(g, list)
    return [
      { desc: m(frame), material: 'frame', colorParam: 'frameColor' },
      { desc: m(steel), material: 'steel' },
      { desc: m(plow), material: 'plow' },
    ]
  },
  step(ctx) {
    const hit = ctx.sense('depth')
    const marks = hit.marks
    if (!hit.hit || !marks || marks.open !== 1) return
    // the end that faces down is the one the beam hit: the case's -Z end is A and its +Z end B
    const end = hit.face === '-z' ? 'A' : hit.face === '+z' ? 'B' : null
    if (end === null) return
    const key = end === 'A' ? 'foldA' : 'foldB'
    const have = marks[key]
    if (typeof have !== 'number') return
    // the end face, below the mouth: 0 at the mouth, 1 at the throat
    const bottom = EYE_Y + hit.distance
    const progress = (0 - bottom) / DEPTH
    // a little slack, so a case pushed to the throat to within a few millimetres closes its last stage
    const stage = Math.max(0, Math.min(6, Math.floor(progress * 6 + 0.12)))
    // never back: a case lifted out stays as folded as it got
    // the end is a floor once it is closed
    if (stage > have) ctx.reformHit('depth', { part: 'oip.carton', from: 'oip.carton', params: { [key]: stage, [end === 'A' ? 'closedA' : 'closedB']: stage === 6 ? 1 : 0 } })
  },
})
