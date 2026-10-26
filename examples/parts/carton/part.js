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

const T = 0.004 // board thickness
const FLAT = 0.02 // the thickness of a flat sleeve, as a collider: two walls of board
const WALL = 0.01 // a collider wall
const TAPE_T = 0.003 // how far the tape stands off the closed flaps
const TAPE_W = 0.048 // the width of the tape strip
const ref = (axis, param, rest = {}) => ({ axis, param, ...rest })

// The default case, 0.4 x 0.3 x 0.25. Every number that follows a param carries its ref, spelled out: the build fits a
// ref to a plain linear param, not a product that is clamped, and it cannot fit a rotation to a param at all.
const L = 0.4
const W = 0.3
const H = 0.25

// the four walls: `s` is +1 when a flap on the A end folds toward +Y of the wall's own frame (the B end folds the other
// way). The short end flaps (walls 2 and 4) close before the long ones (walls 1 and 3).
const WALLS = [
  { name: 'wall1', s: 1, major: true },
  { name: 'wall3', s: -1, major: true },
  { name: 'wall2', s: 1, major: false },
  { name: 'wall4', s: -1, major: false },
]

definePart({
  manifest: {
    id: 'oip.carton',
    name: 'Carton',
    category: 'Products',
    cargo: { friction: 0.5, visualParams: ['open', 'flat', 'foldA', 'foldB', 'tapedA', 'tapedB'] }, // the closed ends change the collider too, which keys the shape by itself
    materials: [],
  },
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
  rig() {
    const wall = (name, parent, size, sizeParams, offset, offsetParams, rotationParams) => ({
      name, parent, shape: { kind: 'box', size, sizeParams }, offset, offsetParams, rotationParams, collision: 'none', colorParam: 'color', roughness: 0.9,
    })
    const links = [
      // the collider is hollow, so a case can be filled: four walls, and a floor at an end only once that end is closed. A
      // wall is 10 mm of board inside its drawn face. The long walls sit at +-(width * open) / 2, so flat they lie one on
      // the other, and the short walls shrink with them
      { name: 'cFront', hidden: true, shape: { kind: 'box', size: [L, WALL, H], sizeParams: [ref(0, 'length'), ref(2, 'height')] }, offset: [0, W / 2 - WALL / 2, 0], offsetParams: [ref(1, 'width', { mulParam: 'open', scale: 0.5, add: -WALL / 2 })] },
      { name: 'cBack', hidden: true, shape: { kind: 'box', size: [L, WALL, H], sizeParams: [ref(0, 'length'), ref(2, 'height')] }, offset: [0, -W / 2 + WALL / 2, 0], offsetParams: [ref(1, 'width', { mulParam: 'open', scale: -0.5, add: WALL / 2 })] },
      { name: 'cRight', hidden: true, shape: { kind: 'box', size: [WALL, W, H], sizeParams: [ref(1, 'width', { mulParam: 'open', min: FLAT }), ref(2, 'height')] }, offset: [L / 2 - WALL / 2, 0, 0], offsetParams: [ref(0, 'length', { scale: 0.5, add: -WALL / 2 })] },
      { name: 'cLeft', hidden: true, shape: { kind: 'box', size: [WALL, W, H], sizeParams: [ref(1, 'width', { mulParam: 'open', min: FLAT }), ref(2, 'height')] }, offset: [-L / 2 + WALL / 2, 0, 0], offsetParams: [ref(0, 'length', { scale: -0.5, add: WALL / 2 })] },
      // a closed end's floor, inside the end plane. An open end has none, but a pin
      { name: 'cFloorA', hidden: true, shape: { kind: 'box', size: [0.0005, 0.0005, WALL], sizeParams: [ref(0, 'length', { mulParam: 'closedA', min: 0.0005 }), ref(1, 'width', { mulParam: 'closedA', min: 0.0005 })] }, offset: [0, 0, -H / 2 + WALL / 2], offsetParams: [ref(2, 'height', { scale: -0.5, add: WALL / 2 })] },
      { name: 'cFloorB', hidden: true, shape: { kind: 'box', size: [0.0005, 0.0005, WALL], sizeParams: [ref(0, 'length', { mulParam: 'closedB', min: 0.0005 }), ref(1, 'width', { mulParam: 'closedB', min: 0.0005 })] }, offset: [0, 0, H / 2 - WALL / 2], offsetParams: [ref(2, 'height', { scale: 0.5, add: -WALL / 2 })] },
      // a flat sleeve is wider than its tube: wings out past the short walls, as wide as the sleeve is
      { name: 'wingR', hidden: true, shape: { kind: 'box', size: [0.0005, FLAT, H], sizeParams: [ref(0, 'width', { mulParam: 'flat', scale: 0.5, min: 0.0005 }), ref(2, 'height')] }, offset: [L / 2, 0, 0], offsetParams: [ref(0, 'length', { scale: 0.5 })] },
      { name: 'wingL', hidden: true, shape: { kind: 'box', size: [0.0005, FLAT, H], sizeParams: [ref(0, 'width', { mulParam: 'flat', scale: 0.5, min: 0.0005 }), ref(2, 'height')] }, offset: [-L / 2, 0, 0], offsetParams: [ref(0, 'length', { scale: -0.5 })] },
      // the drawn shell hangs from a root of its own, so the hidden collider takes none of it with it
      { name: 'shell', shape: { kind: 'frame' }, offset: [0, 0, 0], collision: 'none' },
      // the section's shear: turned by the opening angle, the long walls hang from it and turn back so they stay level
      { name: 'shear', parent: 'shell', shape: { kind: 'frame' }, offset: [0, 0, 0], rotationParams: [ref(2, 'open', { scale: 90 })], collision: 'none' },
      wall('wall1', 'shear', [L, T, H], [ref(0, 'length'), ref(2, 'height')], [-W / 2, 0, 0], [ref(0, 'width', { scale: -0.5 })], [ref(2, 'open', { scale: -90 })]),
      wall('wall3', 'shear', [L, T, H], [ref(0, 'length'), ref(2, 'height')], [W / 2, 0, 0], [ref(0, 'width', { scale: 0.5 })], [ref(2, 'open', { scale: -90 })]),
      // the short walls, turned with the shear
      wall('wall2', 'shell', [W, T, H], [ref(0, 'width'), ref(2, 'height')], [L / 2, 0, 0], [ref(0, 'length', { scale: 0.5 })], [ref(2, 'open', { scale: 90 })]),
      wall('wall4', 'shell', [W, T, H], [ref(0, 'width'), ref(2, 'height')], [-L / 2, 0, 0], [ref(0, 'length', { scale: -0.5 })], [ref(2, 'open', { scale: 90 })]),
    ]
    // the flaps: at each end of each wall a hinge frame on the wall's end edge and a panel W/2 deep hung from it
    for (const [end, zSign, foldParam] of [['A', -1, 'foldA'], ['B', 1, 'foldB']]) {
      for (const w of WALLS) {
        const s = end === 'A' ? w.s : -w.s // the way this flap folds about the wall's x axis: positive tips it toward +Y
        const angle = w.major
          ? { axis: 0, param: foldParam, scale: 30 * s, add: -90 * s, min: s > 0 ? 0 : -90, max: s > 0 ? 90 : 0 }
          : { axis: 0, param: foldParam, scale: 30 * s, min: s > 0 ? 0 : -90, max: s > 0 ? 90 : 0 }
        const hinge = `hinge${w.name.slice(4)}${end}`
        links.push({ name: hinge, parent: w.name, shape: { kind: 'frame' }, offset: [0, 0, zSign * H / 2], offsetParams: [ref(2, 'height', { scale: zSign * 0.5 })], rotationParams: [angle], collision: 'none' })
        // a panel's thickness sits on the side that ends up outside the end once it has folded, and the long flaps lie over the short ones
        const layer = w.major ? 1.5 : 0.5
        const lenParam = w.name === 'wall1' || w.name === 'wall3' ? 'length' : 'width'
        links.push(wall(`flap${w.name.slice(4)}${end}`, hinge, [lenParam === 'length' ? L : W, T, W / 2], [ref(0, lenParam), ref(2, 'width', { scale: 0.5 })], [0, -s * layer * T, zSign * W / 4], [ref(2, 'width', { scale: zSign * 0.25 })], undefined))
      }
    }
    // the tape down each end's seam, outside the closed flaps
    for (const [end, zSign, tapedParam] of [['A', -1, 'tapedA'], ['B', 1, 'tapedB']]) {
      links.push({
        name: `tape${end}`,
        parent: 'shell',
        shape: { kind: 'box', size: [0.001, 0.001, TAPE_T], sizeParams: [ref(0, 'length', { mulParam: tapedParam, min: 0.001 }), ref(1, tapedParam, { scale: TAPE_W, min: 0.001 })] },
        offset: [0, 0, zSign * (H / 2 + 3 * T + TAPE_T / 2)],
        offsetParams: [ref(2, 'height', { scale: zSign * 0.5, add: zSign * (3 * T + TAPE_T / 2) })],
        collision: 'none',
        color: [0.62, 0.5, 0.3],
        roughness: 0.25,
        metalness: 0.1,
      })
    }
    return { links, joints: [] }
  },
  step() {},
})
