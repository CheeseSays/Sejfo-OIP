/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import initJolt from 'jolt-physics'
import { describe, expect, it } from 'vitest'
import { validateScene } from '../core/scene/scene'
import type { PartInstance } from '../core/types'
import { SCENE_VERSION } from '../core/types'
import { buildPackage } from './buildPackage'
import type { PackageManifest } from './buildPackage'
import { SimWorld } from './world'

// The case-packing cell's static rigs (examples/parts: Carton, Carton Opener, Flap Folder, Bottom Taper) in a real
// SimWorld, with a scripted hand standing in for the robot. What has to hold is that a flat blank carried through the cell
// becomes a case taped at both ends without ever leaving the hand until it is set on the belt: it opens as it is lifted off
// the table, the funnel closes the end that faces down a stage at a time and never backs out, the hand can turn the case
// over to close the other end, and the tapers tape the end that faces them once its flaps are shut.

const Jolt = await initJolt()
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

function loadExample(dir: string): { manifest: PackageManifest; behavior: string } {
  const rig = JSON.parse(readFileSync(join(repo, 'examples', 'parts', dir, 'rig.json'), 'utf8')) as {
    id: string
    name: string
    category?: string
    geometry: PackageManifest['geometry']
    cargo?: PackageManifest['cargo']
    materials?: PackageManifest['materials']
  }
  const behavior = readFileSync(join(repo, 'examples', 'parts', dir, 'behavior.ts'), 'utf8')
  return { manifest: { id: rig.id, name: rig.name, category: rig.category, geometry: rig.geometry, cargo: rig.cargo, materials: rig.materials }, behavior }
}

const DECK_Y = 1
const CASE_H = 0.25 // the tube's length, which is the case's height once it stands
const FLAT = 0.02

/** a belt along +X at DECK_Y, running at 0.4 m/s while the `belt` tag is up */
const deck = buildPackage(
  {
    id: 'acme.deck',
    name: 'Deck',
    geometry: { kind: 'rig', links: [{ name: 'deck', shape: { kind: 'box', size: [9, 0.1, 1] }, offset: [0, -0.05, 0], conveys: true }], joints: [], bounds: { length: 9, width: 1, top: 0.1 } },
  },
  "definePart({ step(ctx) { ctx.setSurfaceVelocity({ x: ctx.readTag('belt') ? 0.4 : 0, y: 0, z: 0 }) } })",
)

/** the robot's stand-in: a hand that goes where the gx / gy / gz tags say, turns about X to grx, and grips on `grip` */
const hand = buildPackage(
  {
    id: 'acme.hand',
    name: 'Hand',
    geometry: {
      kind: 'rig',
      links: [
        { name: 'ax', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'ay', parent: 'ax', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'az', parent: 'ay', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'ar', parent: 'az', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'hand', parent: 'ar', shape: { kind: 'frame' }, offset: [0, 0, 0], grip: { zone: { size: [0.9, 0.9, 0.9] } } },
      ],
      joints: [
        { name: 'x', link: 'ax', type: 'prismatic', axis: [1, 0, 0], min: -10, max: 10 },
        { name: 'y', link: 'ay', type: 'prismatic', axis: [0, 1, 0], min: -10, max: 10 },
        { name: 'z', link: 'az', type: 'prismatic', axis: [0, 0, 1], min: -10, max: 10 },
        { name: 'r', link: 'ar', type: 'revolute', axis: [1, 0, 0], min: -3.2, max: 3.2 },
      ],
      bounds: { length: 0.3, width: 0.3, top: 0.3 },
    },
  },
  "definePart({ joints: ['x', 'y', 'z', 'r'], grippers: ['hand'], step(ctx) { ctx.joints.x = ctx.readNumber('gx'); ctx.joints.y = ctx.readNumber('gy'); ctx.joints.z = ctx.readNumber('gz'); ctx.joints.r = ctx.readNumber('grx'); ctx.grips.hand = ctx.readTag('grip') } })",
)

const OPENER_X = -2
const FOLDER_X = 0
const TAPER_X = 2.2
const TOP_TAPER_X = 3.4

function scene(blank: Partial<PartInstance>): SimWorld {
  const opener = loadExample('carton-opener')
  const folder = loadExample('flap-folder')
  const taper = loadExample('bottom-taper')
  const carton = loadExample('carton')
  const parts: PartInstance[] = [
    { id: 'deck', type: 'part', packageId: 'acme.deck', position: [0.5, DECK_Y, 0], rotationY: 0, params: {} },
    { id: 'hand', type: 'part', packageId: 'acme.hand', position: [0, 0, 0], rotationY: 0, params: {} },
    { id: 'opener', type: 'part', packageId: opener.manifest.id, position: [OPENER_X, DECK_Y, 0], rotationY: 0, params: {} },
    { id: 'folder', type: 'part', packageId: folder.manifest.id, position: [FOLDER_X, DECK_Y, 0], rotationY: 0, params: {} },
    { id: 'taper', type: 'part', packageId: taper.manifest.id, position: [TAPER_X, DECK_Y, 0], rotationY: 0, params: {} },
    { id: 'topTaper', type: 'part', packageId: taper.manifest.id, position: [TOP_TAPER_X, DECK_Y, 0], rotationY: 0, params: { side: 'top' } },
    { id: 'blank', type: 'part', packageId: carton.manifest.id, rotationY: 0, position: [OPENER_X, DECK_Y + FLAT / 2, 0], params: {}, ...blank } as PartInstance,
  ]
  const res = validateScene({
    version: SCENE_VERSION,
    packages: [deck, hand, buildPackage(opener.manifest, opener.behavior), buildPackage(folder.manifest, folder.behavior), buildPackage(taper.manifest, taper.behavior), buildPackage(carton.manifest, carton.behavior)],
    parts,
  })
  if (!res.ok) throw new Error(`scene invalid: ${res.errors.join('; ')}`)
  return new SimWorld(Jolt, res.scene)
}

/** the single carton body in the world: its params as it was last made, and where it is */
function theCarton(w: SimWorld): { params: Record<string, number>; pos: [number, number, number] } {
  const f = w.frame()
  expect(f.count).toBe(1)
  const key = f.shapes?.[0]
  const ref = key ? f.shapeRefs?.[key as string] : undefined
  if (!ref) throw new Error('the carton has no shape ref')
  return { params: { open: 1, flat: 0, foldA: 0, foldB: 0, tapedA: 0, tapedB: 0, ...(ref.params as Record<string, number>) }, pos: [f.positions[0]!, f.positions[1]!, f.positions[2]!] }
}

/** drives the hand: the target moves at `speed` m/s per axis, a tick at a time, so a beam sees the whole path */
class Driver {
  pos: [number, number, number]
  rot = 0
  grip = false
  belt = false
  constructor(private readonly w: SimWorld, start: [number, number, number]) {
    this.pos = [...start]
  }
  private tags(): Record<string, number | boolean> {
    return { gx: this.pos[0], gy: this.pos[1], gz: this.pos[2], grx: this.rot, grip: this.grip, belt: this.belt }
  }
  hold(steps: number): void {
    this.w.setBehaviorInputTags(this.tags())
    for (let i = 0; i < steps; i++) this.w.step()
  }
  /** `onTick` sees the carton after every step of the move */
  moveTo(target: [number, number, number], speed = 0.8, onTick?: () => void): void {
    const dt = 1 / 60
    for (let guard = 0; guard < 60 * 20; guard++) {
      let done = true
      for (let k = 0; k < 3; k++) {
        const d = target[k]! - this.pos[k]!
        const s = Math.max(-speed * dt, Math.min(speed * dt, d))
        if (Math.abs(d) > 1e-9) done = false
        this.pos[k] = this.pos[k]! + s
      }
      this.hold(1)
      onTick?.()
      if (done) return
    }
  }
  turnTo(deg: number): void {
    const target = (deg * Math.PI) / 180
    while (Math.abs(target - this.rot) > 1e-9) {
      this.rot += Math.max(-0.03, Math.min(0.03, target - this.rot))
      this.hold(1)
    }
  }
}

describe('carton cell: opener, folder and tapers', () => {
  it('opens a flat blank as it is lifted, closes and tapes one end, turns it over and does the other', () => {
    // the blank lies flat on the table with its flaps out, the hand on it
    const w = scene({ params: { open: 0, flat: 1 } })
    const d = new Driver(w, [OPENER_X, DECK_Y + FLAT / 2, 0])
    d.hold(30)
    expect(theCarton(w).params.open).toBe(0)
    d.grip = true
    d.hold(10)

    // lifted off the table, it opens a step at a time and never goes back, and the hand keeps it
    const opens: number[] = []
    d.moveTo([OPENER_X, DECK_Y + 0.6, 0], 0.3, () => opens.push(theCarton(w).params.open!))
    expect(opens.some((o) => o > 0 && o < 1)).toBe(true)
    for (let i = 1; i < opens.length; i++) expect(opens[i]).toBeGreaterThanOrEqual(opens[i - 1]!)
    let c = theCarton(w)
    expect(c.params.open).toBe(1)
    expect(c.params.flat).toBeCloseTo(0, 6)
    expect(c.pos[1]).toBeGreaterThan(DECK_Y + 0.5) // it is still in the hand: it rose with it

    // stood on its +Z end (turned a quarter about X), over the funnel, and pushed in: that end closes in stages, the other not
    d.moveTo([FOLDER_X, DECK_Y + 0.6, 0])
    d.turnTo(90)
    expect(theCarton(w).params.foldB).toBe(0)
    const stages: number[] = []
    for (let i = 0; i < 40; i++) {
      d.moveTo([FOLDER_X, DECK_Y + 0.6 - (0.6 + 0.095) * ((i + 1) / 40), 0], 0.4)
      stages.push(theCarton(w).params.foldB!)
    }
    expect(stages.at(-1)).toBe(6)
    expect(stages.some((s) => s >= 1 && s <= 5)).toBe(true)
    for (let i = 1; i < stages.length; i++) expect(stages[i]).toBeGreaterThanOrEqual(stages[i - 1]!)
    d.moveTo([FOLDER_X, DECK_Y + 0.6, 0])
    expect(theCarton(w).params.foldB).toBe(6) // lifted out, it stays folded
    expect(theCarton(w).params.foldA).toBe(0) // and the end that was up has not been touched

    // turned over, the other end goes in
    d.turnTo(-90)
    for (let i = 0; i < 40; i++) d.moveTo([FOLDER_X, DECK_Y + 0.6 - (0.6 + 0.095) * ((i + 1) / 40), 0], 0.4)
    d.moveTo([FOLDER_X, DECK_Y + 0.6, 0])
    c = theCarton(w)
    expect(c.params.foldA).toBe(6)
    expect(c.params.foldB).toBe(6)

    // set on the belt on its A end: the bottom taper tapes A, and the top taper then tapes the B end that faces up
    d.moveTo([TAPER_X - 1.2, DECK_Y + 0.6, 0])
    d.moveTo([TAPER_X - 1.2, DECK_Y + CASE_H / 2 + 0.002, 0], 0.3)
    expect(theCarton(w).params.tapedA).toBe(0)
    d.grip = false
    d.belt = true
    d.hold(60 * 5)
    c = theCarton(w)
    expect(c.pos[0]).toBeGreaterThan(TAPER_X)
    expect(c.params.tapedA).toBe(1)
    expect(c.params.tapedB).toBe(0)
    d.hold(60 * 4)
    c = theCarton(w)
    expect(c.params.tapedA).toBe(1)
    expect(c.params.tapedB).toBe(1)
    expect(w.measurements().completedTotal).toBe(0)
    w.dispose()
  })

  it('leaves an open case alone at the tapers: the flaps have to be shut first', () => {
    // an erected case standing on its A end, flaps out, run through both tapers
    const w = scene({ position: [TAPER_X - 1.4, DECK_Y + CASE_H / 2 + 0.002, 0], rotationX: -Math.PI / 2, params: { open: 1, flat: 0 } })
    const d = new Driver(w, [0, 0, 0])
    d.belt = true
    d.hold(60 * 12)
    const c = theCarton(w)
    expect(c.pos[0]).toBeGreaterThan(TOP_TAPER_X) // it went right through
    expect(c.params.tapedA).toBe(0)
    expect(c.params.tapedB).toBe(0)
    w.dispose()
  })
})
