// Carton Opener: the table a flat blank lies on, and the hook that opens it as the robot lifts it. A robot lifts the
// blank by one face, and as it rises the sleeve goes from flat to a parallelogram to a rectangular tube, as it does in a
// robotic case-packing cell. Nothing here moves and it needs no program.
//
// What it does is a ctx.reformHit on the blank over the table each time the lift has gone a step further: the Carton's
// `open` rises from 0 to 1 in sixths (15 degrees of shear a step) as the blank's centre climbs from the table to
// `Lift to open` above it, and never goes back down. The blank may be in the robot's gripper: a rig gripper keeps hold
// of a case that is remade in its hand, at the same centre. The flaps at both ends stand straight out from the first,
// as they do on a flat sleeve, so opening only changes the section. Only a Carton that is not yet fully open is touched.
//
// The blank is read by a beam that looks up through the table from under it, so the lift is the height of the blank's
// lowest face. The beam knows the Carton's width and how open it is from its marks, and that gives the centre height even
// as the blank thickens, so the reading does not chase itself.
//
// Part frame: the origin is on the table top where the blanks lie, with the table 0.9 m by 0.6 m, and the stand reaches
// the floor below it. Drop blanks on it from a Spawner set to the Carton with `{"open":0,"flat":1}` as its product
// settings, and they lie flat as they are made.
//
// This is the part's source. `npm run build-parts` writes behavior.ts and rig.json from it.

const STEPS = 6 // sixths of the opening
const EYE_Y = -0.4 // the beam's emitter, under the table top
const FLAT = 0.02 // a flat blank's thickness, as the Carton collides

definePart({
  params: {
    liftToOpen: { type: 'number', unit: 'm', default: 0.3, min: 0.05, max: 0.8, step: 0.01, label: 'Lift to open (m)', desc: 'How high the blank\'s centre has to rise above the table before it is fully open. Between the table and here it opens a step at a time.' },
    standHeight: { type: 'number', default: 0.9, min: 0.2, max: 2.5, step: 0.01, label: 'Stand height (m)', desc: 'Height of the table top above the floor. The legs run from here to the floor.' },
    frameColor: { type: 'color', default: '#24507a', label: 'Frame color', group: 'Colors', desc: 'Paint of the table and legs.' },
    showBeam: { type: 'boolean', default: false, label: 'Show beam', desc: 'Draw the beam that reads how high the blank is.' },
  },
  geometry(g, p) {
    const sh = typeof p.standHeight === 'number' && isFinite(p.standHeight) ? p.standHeight : 0.9
    const box = (list, x0, x1, y0, y1, z0, z1, square) => {
      list.push(g.bevelBox([Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)], [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], 0.004, square))
    }
    const frame = [], steel = [], hook = []
    // the table top and its legs
    box(frame, -0.45, 0.45, -0.04, 0, -0.3, 0.3)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(frame, sx * 0.4 - 0.03, sx * 0.4 + 0.03, -sh, -0.04, sz * 0.25 - 0.03, sz * 0.25 + 0.03, ['y-'])
    box(frame, -0.4, 0.4, EYE_Y - 0.05, EYE_Y - 0.03, -0.25, 0.25)
    box(steel, -0.02, 0.02, EYE_Y - 0.03, EYE_Y, -0.02, 0.02)
    // the hook: a post at the far edge with a plate that leans over the table, which the blank's edge catches on
    box(frame, -0.45, -0.39, 0, 0.45, -0.04, 0.04, ['y-'])
    const a = 0.7
    hook.push(g.transform(g.bevelBox([0.14, 0.012, 0.12], [0, 0, 0], 0.003), { rotate: [0, 0, Math.sin(-a / 2), Math.cos(a / 2)], translate: [-0.34, 0.42, 0] }))
    const m = (list) => g.merge.apply(g, list)
    return [
      { desc: m(frame), material: 'frame', colorParam: 'frameColor' },
      { desc: m(steel), material: 'steel' },
      { desc: m(hook), material: 'hook' },
    ]
  },
  step(ctx) {
    const hit = ctx.sense('lift')
    const marks = hit.marks
    if (!hit.hit || !marks || typeof marks.open !== 'number' || typeof marks.width !== 'number' || marks.open >= 1) return
    // how high the blank's centre is: its lowest face, plus half its thickness, less the half it rests at on the table
    const thickness = Math.max(FLAT, marks.width * marks.open)
    const centre = EYE_Y + hit.distance + thickness / 2
    const lift = centre - FLAT / 2
    const stage = Math.max(0, Math.min(STEPS, Math.floor((lift / ctx.params.liftToOpen) * STEPS)))
    const open = stage / STEPS
    // never back: a blank set down half open stays as open as it got
    if (open > marks.open + 1e-6) ctx.reformHit('lift', { part: 'oip.carton', from: 'oip.carton', params: { open, flat: 1 - open } })
  },
})
