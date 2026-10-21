// Vacuum Tool: an end-of-arm tool for the Six-Axis Robot, and for any rig with a link named `eoat`. It is a part of its
// own, so it is chosen, resized or swapped without touching the robot: drop it on the robot's flange (it seats there and
// is soft-parented under the arm) and it rides the flange through every joint move. Delete it and the robot keeps
// its flange and picks nothing.
//
// The tool is engineered hardware, so it is code: a painted plate framed by slotted rails and corner caps, the adapter
// the wrist flange bolts to, the vacuum LED, and a pitch/margin grid of turned cups that squash off that LED. The
// robot's vacuum lamp reaches the tool through the mount, so the cups close when the robot switches its vacuum on.
// Its pickup volume is the plate itself, which is what the robot's gripper picks inside (`mount.grip`).
//
// This is the part's source. `npm run build-parts` writes behavior.ts (this script as the app ships it, with the
// _shared/ modules it imports joined in and `manifest` / `rig()` left out) and rig.json (the manifest, with the
// rig compiled from rig()).

// The tool, in the eoat frame (+Y toward the wrist, the cups hanging toward -Y). Its numbers are the tool model
// this replaced: plate back face -0.0517 and front face -0.101, rails 59 mm deep centred on -0.075 with their outer
// faces 3 mm outside ±size/2, cups mounted at -0.1035 and 53 mm tall, the adapter 192 x 318 mm reaching -0.013
// toward the flange. The cup grid is the host's `grid` array rule (count = floor(usable / pitch) + 1 per axis,
// spread edge to edge across ±usable/2, thinned to 256 cups by spreading the longer axis), so a bed laid by either
// reads the same. The cups are one turned bellows cup drawn at every grid point; they compress ~15% about the rim
// while the vacuum holds, so the lip stays seated on the load and the bellows fold up into the mount. The vacuum
// LED is the grip tell (vacuumLamp): a round lens in a black bezel, flush on the plate's back face, riding the
// +X/+Z corner so it tracks the plate as the tool resizes.
const CUP_RIM_Y = -0.1035 - 0.0532 // the lowest point of a cup, in the eoat frame

definePart({
  manifest: {
    id: 'oip.vacuum-tool',
    name: 'Vacuum Tool',
    category: 'Equipment',
    // The tool is plain finishes, colours LINEAR: orange paint (sRGB #d0601a) on the plate and caps, black anodised
    // aluminium rails, a steel adapter, blue rubber cups (sRGB #2b5ba8), and the vacuum LED: a black plastic bezel
    // round a lens that is dark green until it lights.
    materials: [
      { id: 'eoatPaint', color: [0.639, 0.116, 0.0066], metalness: 0, roughness: 0.55 },
      { id: 'eoatRail', color: [0.04, 0.04, 0.045], metalness: 0.7, roughness: 0.35 },
      { id: 'eoatSteel', color: [0.18, 0.18, 0.19], metalness: 0.85, roughness: 0.45 },
      { id: 'eoatCup', color: [0.024, 0.104, 0.4], metalness: 0, roughness: 0.75 },
      { id: 'eoatPlastic', color: [0.02, 0.02, 0.022], metalness: 0, roughness: 0.5 },
      { id: 'eoatLens', color: [0.03, 0.06, 0.03], metalness: 0, roughness: 0.25 },
    ],
  },
  lamps: ['vacuumLamp'],
  // a passive part: the robot's vacuum lamp reaches it through the mount, and its pickup volume is declared in rig()
  step() {},
  params: {
    toolSizeX: { type: 'number', default: 0.5, min: 0.5, max: 3, step: 0.01, label: 'Tool size X (m)', handle: { kind: 'rigSize', link: 'eoat', axis: 'x', frameY: -0.075 }, desc: 'Length of the vacuum plate. The orange dots on the tool itself drag this in the viewport, and they ride the arm, so you can size the tool in whatever pose you are inspecting. Size it to the product you are picking - the plate is also the grab reach.' },
    toolSizeZ: { type: 'number', default: 0.5, min: 0.5, max: 3, step: 0.01, label: 'Tool size Z (m)', handle: { kind: 'rigSize', link: 'eoat', axis: 'z', frameY: -0.075 }, desc: 'Width of the vacuum plate, dragged by the same orange dots on the tool.' },
    cupPitchX: { type: 'number', default: 0.1, min: 0.01, max: 0.5, step: 0.005, label: 'Cup pitch X (m)', group: 'Cups', desc: 'Centre-to-centre spacing of the suction cups along the plate length. The plate fits as many as the pitch allows, so tightening it adds cups rather than moving them.' },
    cupPitchZ: { type: 'number', default: 0.1, min: 0.01, max: 0.5, step: 0.005, label: 'Cup pitch Z (m)', group: 'Cups', desc: 'Centre-to-centre spacing of the suction cups across the plate width.' },
    cupMarginX: { type: 'number', default: 0.05, min: 0, max: 0.5, step: 0.005, label: 'Cup margin X (m)', group: 'Cups', desc: 'Inset from each end of the plate before the first cup, so the grid does not run off the edge.' },
    cupMarginZ: { type: 'number', default: 0.05, min: 0, max: 0.5, step: 0.005, label: 'Cup margin Z (m)', group: 'Cups', desc: 'Inset from each side of the plate before the first cup.' },
    cupsEnabled: { type: 'boolean', default: true, label: 'Suction cups', group: 'Cups', desc: 'Draw the cup grid under the plate. Appearance only - the grip itself comes from the robot\'s vacuum, not from the cups being visible.' },
  },
  rig(p) {
    return {
      // the frame the tool is drawn on, and the one its resize dots ride
      links: [{ name: 'eoat', shape: { kind: 'frame' }, offset: [0, 0, 0] }],
      joints: [],
      // Rides the robot's `eoat` link, the tool flange. The pickup volume is the plate itself (toolSizeX x toolSizeZ,
      // 1:1 - the plate is the vacuum, so anything under it is picked and anything beside it is not): sized to one
      // case it picks one, sized to a layer it lifts the whole formed layer in one grip, which is what a palletizer
      // does. The 0.7 m of vertical reach is centred on the cup rim (the robot's `gripper` link), so it swallows the
      // centre of any case up to 0.7 m tall standing under the plate without reaching down into the layer BELOW the
      // one being picked. The robot's gripper link shares the tool's axes, so the volume is centred on it as it is.
      mount: {
        link: 'eoat',
        grip: {
          link: 'gripper',
          zone: { size: [0.5, 0.7, 0.5], sizeParams: [{ axis: 0, param: 'toolSizeX' }, { axis: 2, param: 'toolSizeZ' }] },
        },
      },
      // Standing alone it rests on its cups, plate up, until it is seated on a robot.
      bounds: { length: p.toolSizeX, width: p.toolSizeZ, top: 0, bottom: CUP_RIM_Y },
    }
  },
  geometry(g, p) {
    const hx = p.toolSizeX / 2
    const hz = p.toolSizeZ / 2
    const RAIL_Y = -0.075 // rail centreline
    const RAIL_H = 0.059 // rail depth, back to front
    const RAIL_OUT = 0.003 // rail face, outside the plate edge
    const RAIL_W = 0.015 // rail width
    const CAP = 0.019 // corner cap, square in plan
    const out = []
    // plate and corner caps
    const paint = [g.box([2 * (hx - RAIL_W + RAIL_OUT) + 0.002, 0.0493, 2 * (hz - RAIL_W + RAIL_OUT) + 0.002], [0, -0.07635, 0])]
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      paint.push(g.bevelBox([CAP, RAIL_H + 0.004, CAP], [sx * (hx + RAIL_OUT - CAP / 2 + 0.002), RAIL_Y, sz * (hz + RAIL_OUT - CAP / 2 + 0.002)], 0.002))
    }
    out.push({ desc: g.merge(...paint), material: 'eoatPaint', link: 'eoat' })
    // rails: a slotted extrusion between the caps
    const section = (edge) => {
      const o = edge + RAIL_OUT
      const i = o - RAIL_W
      const y0 = RAIL_Y - RAIL_H / 2
      const y1 = RAIL_Y + RAIL_H / 2
      const pts = [[i, y0], [o, y0]]
      for (const gy of [-0.015, 0.015]) pts.push([o, RAIL_Y + gy - 0.003], [o - 0.003, RAIL_Y + gy - 0.003], [o - 0.003, RAIL_Y + gy + 0.003], [o, RAIL_Y + gy + 0.003])
      pts.push([o, y1], [i, y1])
      return pts
    }
    const mirror = (pts) => pts.map((q) => [-q[0], q[1]])
    const runZ = hz + RAIL_OUT - CAP + 0.002 // to the cap
    const runX = hx + RAIL_OUT - CAP + 0.002
    const swap = (pts) => pts.map((q) => [q[1], q[0]]) // x-axis outline is (y, z)
    out.push({
      desc: g.merge(
        g.extrude(section(hx), -runZ, runZ, { axis: 'z', bevel: 0.0008 }),
        g.extrude(mirror(section(hx)), -runZ, runZ, { axis: 'z', bevel: 0.0008 }),
        g.extrude(swap(section(hz)), -runX, runX, { axis: 'x', bevel: 0.0008 }),
        g.extrude(swap(mirror(section(hz))), -runX, runX, { axis: 'x', bevel: 0.0008 }),
      ),
      material: 'eoatRail',
      link: 'eoat',
    })
    // adapter: a plate and a turned boss up to the flange
    const ADAPTER_TOP = -0.0397
    out.push({
      desc: g.merge(
        g.bevelBox([0.192, 0.012, 0.318], [0, -0.0457, 0], 0.002, ['y-']),
        g.lathe([[0, ADAPTER_TOP], [0.07, ADAPTER_TOP], [0.07, -0.025], [0.062, -0.021], [0.062, -0.013], [0, -0.013]], { segments: 40 }),
      ),
      material: 'eoatSteel',
      link: 'eoat',
    })
    const bolts = []
    for (const bx of [-0.078, 0.078]) for (const bz of [-0.14, 0, 0.14]) {
      bolts.push(g.lathe([[0, ADAPTER_TOP], [0.008, ADAPTER_TOP], [0.008, ADAPTER_TOP + 0.005], [0, ADAPTER_TOP + 0.005]], { segments: 6, smooth: false, center: [bx, 0, bz] }))
    }
    out.push({ desc: g.merge(...bolts), finish: 'bolt', link: 'eoat' })
    // vacuum LED, 0.07 m in from the +X/+Z corner
    const BACK = -0.0517 // plate back face
    const lx = hx - 0.07
    const lz = hz - 0.07
    out.push({ desc: g.lathe([[0, BACK], [0.0175, BACK], [0.0175, BACK + 0.005], [0.0155, BACK + 0.007], [0, BACK + 0.007]], { segments: 32, center: [lx, 0, lz] }), material: 'eoatPlastic', link: 'eoat' })
    out.push({
      desc: g.lathe([[0, BACK + 0.007], [0.0135, BACK + 0.007], [0.012, BACK + 0.0105], [0.007, BACK + 0.0128], [0, BACK + 0.0135]], { segments: 32, center: [lx, 0, lz] }),
      material: 'eoatLens',
      link: 'eoat',
      lamps: [{ name: 'vacuumLamp', emissive: [0.15, 0.85, 0.2], offColor: [0.03, 0.06, 0.03] }],
    })
    // cup bed, squashed about the rims while the vacuum holds
    if (p.cupsEnabled) {
      const axis = (size, pitch, margin) => {
        const usable = Math.max(size - Math.max(margin, 0) * 2, 0)
        const n = Math.max(1, Math.min(64, Math.floor(usable / Math.max(pitch, 1e-4) + 1e-6) + 1))
        if (n === 1) return [0]
        const at = []
        for (let k = 0; k < n; k++) at.push(-usable / 2 + (k * usable) / (n - 1))
        return at
      }
      const cup = g.lathe([
        [0, -0.0417], [0.0187, -0.0417], [0.0262, -0.047], [0.0286, -0.0532], [0.0328, -0.0532], [0.0338, -0.052],
        [0.0336, -0.0506], [0.0328, -0.0495], [0.0213, -0.0374], [0.0246, -0.0358], [0.0245, -0.035], [0.0152, -0.0232],
        [0.0112, -0.013], [0.0081, -0.0121], [0.0081, 0], [0, 0],
      ], { segments: 20 })
      // at most 256 cups, thinned as the host's grid is
      const xs = axis(p.toolSizeX, p.cupPitchX, p.cupMarginX)
      const zs = axis(p.toolSizeZ, p.cupPitchZ, p.cupMarginZ)
      let nx = xs.length
      let nz = zs.length
      while (nx * nz > 256) {
        if (nx >= nz) nx--
        else nz--
      }
      const thin = (at, n) => (n === at.length ? at : n === 1 ? [0] : Array.from({ length: n }, (_, k) => at[0] + ((at[at.length - 1] - at[0]) * k) / (n - 1)))
      const instances = []
      for (const cx of thin(xs, nx)) for (const cz of thin(zs, nz)) instances.push({ position: [cx, -0.1035, cz] })
      out.push({ desc: cup, material: 'eoatCup', link: 'eoat', instances, squash: { amount: 0.15, lamp: 'vacuumLamp' } })
    }
    return out
  },
})
