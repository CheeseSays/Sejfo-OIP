import initJolt from 'jolt-physics'
import { describe, expect, it } from 'vitest'
import { validateScene } from '../core/scene/scene'
import type { PartInstance } from '../core/types'
import { SCENE_VERSION } from '../core/types'
import { buildPackage } from './buildPackage'
import { SimWorld } from './world'

// ctx.reform in a real SimWorld: a flat blank erected into a case where it stands. What has to hold is that it is the
// same item to the line: no completion, the same place on the deck, the same marks, and a body of the new shape.

const Jolt = await initJolt()

const DECK_Y = 1
const FLAT = 0.01
const TALL = 0.3

/** a carton whose height is a param: the body's one box link follows it */
const carton = buildPackage(
  {
    id: 'acme.carton',
    name: 'Carton',
    geometry: {
      kind: 'rig',
      links: [{ name: 'body', shape: { kind: 'box', size: [0.4, 0.3, 0.3], sizeParams: [{ axis: 0, param: 'length' }, { axis: 1, param: 'height' }] }, offset: [0, 0, 0] }],
      joints: [],
    },
    cargo: {},
  },
  `definePart({ params: {
    length: { type: 'number', default: 0.4, min: 0.1, max: 1.2, step: 0.005, label: 'Length' },
    height: { type: 'number', default: ${TALL}, min: 0.005, max: 1, step: 0.005, label: 'Height' },
    mass: { type: 'number', default: 1, min: 0.1, max: 50, step: 0.1, label: 'Mass' },
  }, step() {} })`,
)

const deck = buildPackage(
  {
    id: 'acme.deck',
    name: 'Deck',
    geometry: { kind: 'rig', links: [{ name: 'deck', shape: { kind: 'box', size: [6, 0.1, 1] }, offset: [0, -0.05, 0], conveys: true }], joints: [], bounds: { length: 6, width: 1, top: 0.1 } },
  },
  "definePart({ step(ctx) { ctx.setSurfaceVelocity({ x: ctx.readNumber('deck'), y: 0, z: 0 }) } })",
)

/** op 1 erects the cartons in the zone, op 2 asks for a part that is not cargo, op 3 only touches another product */
const station = buildPackage(
  {
    id: 'acme.station',
    name: 'Station',
    geometry: {
      kind: 'rig',
      links: [{ name: 'z', shape: { kind: 'box', size: [1.2, 1.2, 1] }, offset: [0, 0.6, 0], hidden: true, collision: 'none', zone: { size: [1.2, 1.2, 1] } }],
      joints: [],
      bounds: { length: 1.2, width: 1, top: 1.2 },
    },
  },
  `let last = 0
definePart({ step(ctx) {
  const op = ctx.readNumber('op')
  if (op !== last) {
    if (op === 1) ctx.reform('z', { part: 'acme.carton', params: { height: ${TALL} } })
    if (op === 2) ctx.reform('z', { part: 'acme.deck' })
    if (op === 3) ctx.reform('z', { part: 'acme.carton', from: 'oip.box', params: { height: ${TALL} } })
    last = op
  }
  ctx.writeNumber('inZone', ctx.zone('z'))
} })`,
)

const blank = (id: string, x: number): PartInstance => ({ id, type: 'part', packageId: 'acme.carton', position: [x, DECK_Y + FLAT / 2, 0], rotationY: 0, params: { height: FLAT } })

function world(parts: PartInstance[]): SimWorld {
  const res = validateScene({
    version: SCENE_VERSION,
    packages: [deck, carton, station],
    parts: [
      { id: 'deck', type: 'part', packageId: 'acme.deck', position: [0, DECK_Y, 0], rotationY: 0, params: {} },
      { id: 'st', type: 'part', packageId: 'acme.station', position: [0, DECK_Y, 0], rotationY: 0, params: {} },
      ...parts,
    ],
  })
  if (!res.ok) throw new Error(`scene invalid: ${res.errors.join('; ')}`)
  return new SimWorld(Jolt, res.scene)
}

function steps(w: SimWorld, n: number, tags: Record<string, number | boolean> = {}): void {
  w.setBehaviorInputTags(tags)
  for (let i = 0; i < n; i++) w.step()
}

/** every cargo row's centre and half height */
function rows(w: SimWorld): { x: number; y: number; hy: number; hx: number }[] {
  const f = w.frame()
  const out: { x: number; y: number; hy: number; hx: number }[] = []
  for (let i = 0; i < f.count; i++) out.push({ x: f.positions[i * 3]!, y: f.positions[i * 3 + 1]!, hy: f.halfExtents[i * 3 + 1]!, hx: f.halfExtents[i * 3]! })
  return out
}

describe('ctx.reform', () => {
  it('remakes a flat blank as a tall carton on the same footprint, as the same item to the line', () => {
    const w = world([blank('b', 0.1)])
    steps(w, 30, { op: 0, deck: 0 })
    const [flat] = rows(w)
    expect(flat!.hy).toBeCloseTo(FLAT / 2, 3)
    const spawned = w.measurements().spawnedTotal

    steps(w, 3, { op: 1, deck: 0 })
    const made = rows(w)
    expect(made.length).toBe(1) // one item, not two
    expect(made[0]!.hy).toBeCloseTo(TALL / 2, 3)
    expect(made[0]!.y - made[0]!.hy).toBeCloseTo(flat!.y - flat!.hy, 2) // the bottom face stayed on the deck
    expect(Math.abs(made[0]!.x - flat!.x)).toBeLessThan(0.01)
    expect(w.measurements().completedTotal).toBe(0) // a despawn and spawn would have counted one
    expect(w.measurements().spawnedTotal).toBe(spawned + 1)
    w.dispose()
  })

  it('keeps the size and mass the item had where the call names only some params', () => {
    const w = world([{ id: 'b', type: 'part', packageId: 'acme.carton', position: [0.1, DECK_Y + FLAT / 2, 0], rotationY: 0, params: { height: FLAT, length: 0.6, mass: 3 } }])
    steps(w, 30, { op: 0, deck: 0 })
    steps(w, 3, { op: 1, deck: 0 }) // asks for the height alone
    const made = rows(w)[0]!
    expect(made.hx).toBeCloseTo(0.3, 3)
    expect(made.hy).toBeCloseTo(TALL / 2, 3)
    w.dispose()
  })

  it('keeps going at the speed it had, and rests on the deck afterwards', () => {
    const w = world([blank('b', -1)])
    steps(w, 30, { op: 0, deck: 0.5 })
    const x0 = rows(w)[0]!.x
    steps(w, 3, { op: 1, deck: 0.5 })
    steps(w, 60, { op: 1, deck: 0.5 })
    const after = rows(w)[0]!
    expect(after.x - x0).toBeGreaterThan(0.3)
    expect(after.y - after.hy).toBeCloseTo(DECK_Y, 1)
    w.dispose()
  })

  it('does nothing for a part that is not cargo, and for a product the filter does not name', () => {
    for (const op of [2, 3]) {
      const w = world([blank('b', 0.1)])
      steps(w, 30, { op: 0, deck: 0 })
      steps(w, 3, { op, deck: 0 })
      const r = rows(w)
      expect(r.length).toBe(1)
      expect(r[0]!.hy).toBeCloseTo(FLAT / 2, 3)
      w.dispose()
    }
  })
})
