// Carton: a corrugated shipping case that folds, cargo with its own body (docs/cargo-bodies.md). It is a four-walled
// tube with a set of four flaps at each end, and a machine takes it from a flat blank to a taped case with ctx.reform:
//   - a flat blank, as it lies in the magazine: a sleeve pressed flat, `open` 0, with the flaps at both ends folded flat;
//   - a tube opening: `open` grows from 0 to 1 and the section goes from flat to a parallelogram to a rectangle, the
//     walls hinged at their corners, as the robot lifts the blank by one face;
//   - an erected tube: `open` 1, the flaps at both ends standing straight out;
//   - one end's flaps closing, `foldA` or `foldB`, 1 to 6: the short end flaps fold in first (stages 1 to 3, 30 degrees
//     each) and the long side flaps after (4 to 6);
//   - one end taped: `tapedA` or `tapedB`, a strip of tape down the seam of that end.
// The two ends are the tube's -Z end (A) and +Z end (B), each with its own state, so a case closes and tapes one end and
// is turned over to do the other, or is filled through the open end between the two.
//
// The tube runs along the part's Z, its section is Length (X) by Width (Y) and Height is the way it runs. So a blank is
// born lying flat, thin in Y, and the robot stands the case up (Z to world up) when it wants it open end up.
//
// The collider is hollow, so the case can be filled: four walls 10 mm thick, whose spacing follows `open` (flat, they lie one
// on the other), two wings that make a flat sleeve as wide as it is, and a floor across an end once that end is closed
// (`closedA`, `closedB`). An open end has no floor, so a product dropped in at the open end stays in the case and one
// dropped in at a closed end does not. What is drawn is the walls, the flaps and the tape, all with collision off. The
// walls hinge on frame links whose rotation follows `open`, and each flap hinges on its wall's edge, so the folding is the
// rig's `rotationParams` and not a joint (a rigid cargo body has none).
//
// `open`, `flat`, the folds and the tapes change the look but not the collider (apart from opening and closing), so they are
// `visualParams`: the sim and view give each combination its own batch. The state is a product attribute too, so a beam
// that hits a case reads it off its marks, which is how a folding rig knows what is left to do. `flat` is `1 - open`, kept
// as its own param because the wings need a product with it. A machine that changes one changes the other.
//
// Nothing here is simulated, so step() is empty.
//
// This is the part's source. `npm run build-parts` writes behavior.ts and rig.json from it.

// The default case, 0.4 x 0.3 x 0.25. Every number that follows a param carries its ref, spelled out: the build fits a
// ref to a plain linear param, not a product that is clamped, and it cannot fit a rotation to a param at all.
const L = 0.4
const W = 0.3
const H = 0.25

definePart({
  params: {
    length: { type: 'number', attribute: true, default: L, min: 0.1, max: 1.2, step: 0.005, label: 'Length (m)', group: 'Size', desc: 'The tube section along X. Keep it at least as long as the width: the long flaps close over the short ones.' },
    width: { type: 'number', attribute: true, default: W, min: 0.1, max: 1, step: 0.005, label: 'Width (m)', group: 'Size', desc: 'The tube section along Y. This is also how deep each flap is, half of it.' },
    height: { type: 'number', attribute: true, default: H, min: 0.05, max: 1, step: 0.005, label: 'Height (m)', group: 'Size', desc: 'The way the tube runs, along Z: the case stands this tall once the robot sets it upright.' },
    mass: { type: 'number', default: 1.5, min: 0.1, max: 60, step: 0.1, label: 'Mass (kg)', desc: 'Physical mass.' },
    color: { type: 'color', default: '#b98b57', label: 'Color', desc: 'The board. Kraft brown by default.' },
    open: { type: 'number', attribute: true, default: 1, min: 0, max: 1, step: 0.05, label: 'Open', group: 'State', desc: '0 is a flat sleeve and 1 a rectangular tube. Between, the section is a parallelogram. A machine sets this together with Flat.' },
    flat: { type: 'number', default: 0, min: 0, max: 1, step: 0.05, label: 'Flat', group: 'State', desc: '1 minus Open. Set it together with Open.' },
    closedA: { type: 'number', attribute: true, default: 0, min: 0, max: 1, step: 1, label: 'End A closed', group: 'State', desc: '1 puts a floor across the -Z end: what an end with its flaps shut is, to anything set in the case. A machine sets this with End A fold stage 6.' },
    closedB: { type: 'number', attribute: true, default: 0, min: 0, max: 1, step: 1, label: 'End B closed', group: 'State', desc: '1 puts a floor across the +Z end. A machine sets this with End B fold stage 6.' },
    foldA: { type: 'number', attribute: true, default: 0, min: 0, max: 6, step: 1, label: 'End A fold stage', group: 'State', desc: 'The flaps at the -Z end. 0 has them standing straight out, 1 to 3 fold the short end flaps in (30 degrees a stage), 4 to 6 the long side flaps. 6 is a closed end, and a flat sleeve has its flaps folded flat.' },
    foldB: { type: 'number', attribute: true, default: 0, min: 0, max: 6, step: 1, label: 'End B fold stage', group: 'State', desc: 'The flaps at the +Z end, as End A fold stage.' },
    tapedA: { type: 'number', attribute: true, default: 0, min: 0, max: 1, step: 1, label: 'End A taped', group: 'State', desc: '1 puts a strip of tape down the seam at the -Z end.' },
    tapedB: { type: 'number', attribute: true, default: 0, min: 0, max: 1, step: 1, label: 'End B taped', group: 'State', desc: '1 puts a strip of tape down the seam at the +Z end.' },
  },
  step() {},
})
