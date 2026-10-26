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

// A Carton is hollow: what is dropped in at its open end stays in it, and what is dropped in at a closed end does not.
// A solid box collider would hold everything on top, which is no use on a packing line.

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
const PRODUCT = 0.12

const deck = buildPackage(
  {
    id: 'acme.deck',
    name: 'Deck',
    geometry: { kind: 'rig', links: [{ name: 'deck', shape: { kind: 'box', size: [3, 0.1, 1] }, offset: [0, -0.05, 0], conveys: true }], joints: [], bounds: { length: 3, width: 1, top: 0.1 } },
  },
  'definePart({ step(ctx) { ctx.setSurfaceVelocity({ x: 0, y: 0, z: 0 }) } })',
)

/** a case standing on its A end (the -Z end down), with that end closed or not, and a product dropped in from above */
function dropIn(carton: Record<string, number>, product: [number, number, number] = [0, DECK_Y + 0.7, 0]): { box: [number, number, number]; carton: [number, number, number] } {
  const box = loadExample('box')
  const c = loadExample('carton')
  const parts: PartInstance[] = [
    { id: 'deck', type: 'part', packageId: 'acme.deck', position: [0, DECK_Y, 0], rotationY: 0, params: {} },
    { id: 'case', type: 'part', packageId: c.manifest.id, position: [0, DECK_Y + CASE_H / 2 + 0.002, 0], rotationY: 0, rotationX: -Math.PI / 2, params: carton },
    { id: 'item', type: 'part', packageId: box.manifest.id, position: product, rotationY: 0, params: { length: PRODUCT, width: PRODUCT, height: PRODUCT, mass: 1 } },
  ]
  const res = validateScene({ version: SCENE_VERSION, packages: [deck, buildPackage(box.manifest, box.behavior), buildPackage(c.manifest, c.behavior)], parts })
  if (!res.ok) throw new Error(`scene invalid: ${res.errors.join('; ')}`)
  const w = new SimWorld(Jolt, res.scene)
  for (let s = 0; s < 60 * 4; s++) w.step()
  const f = w.frame()
  const at = (id: string): [number, number, number] => {
    const i = f.partIds.indexOf(id)
    return [f.positions[i * 3]!, f.positions[i * 3 + 1]!, f.positions[i * 3 + 2]!]
  }
  const out = { box: at('item'), carton: at('case') }
  w.dispose()
  return out
}

describe('a carton is hollow', () => {
  it('holds a product dropped in at its open end, on the floor of its closed end', () => {
    const r = dropIn({ foldA: 6, closedA: 1 })
    // inside the walls, below the rim, standing on the floor (10 mm above the deck) and not on the case's top edge
    expect(Math.abs(r.box[0] - r.carton[0])).toBeLessThan(0.15)
    expect(Math.abs(r.box[2] - r.carton[2])).toBeLessThan(0.1)
    expect(r.box[1]).toBeLessThan(DECK_Y + CASE_H)
    expect(r.box[1]).toBeGreaterThan(DECK_Y + 0.01 + PRODUCT / 2 - 0.005)
  })

  it('lets it through to the deck when the end it stands on is open', () => {
    const closed = dropIn({ foldA: 6, closedA: 1 })
    const open = dropIn({ foldA: 0, closedA: 0 })
    expect(open.box[1]).toBeLessThan(DECK_Y + PRODUCT / 2 + 0.004) // all the way down, on the deck
    expect(closed.box[1] - open.box[1]).toBeGreaterThan(0.007) // the floor lifts it
  })
})
