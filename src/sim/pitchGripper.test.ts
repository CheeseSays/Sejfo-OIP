import initJolt from 'jolt-physics'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { registerPackage, unregisterPackage } from '../core/parts/partRegistry'
import { validatePartPackage } from '../core/parts/partValidate'
import { SCENE_VERSION } from '../core/types'
import type { SceneJSON, SdkPart } from '../core/types'
import { buildPackage } from './buildPackage'
import type { PackageManifest } from './buildPackage'
import { SimWorld } from './world'

// The Pitch Gripper (examples/parts/pitch-gripper) as the app ships it: a tool whose two sections each pick the products
// in their own box, and whose linear axis spreads them. A PLC drives it by tags, so the test does the same, on a host with
// an `eoat` link standing 1 m up. It picks two products per section at the closed pitch, spreads, and sets one section
// down on its own.

const Jolt = await initJolt()

const HOST = 'test.pitch.host'
const EOAT_Y = 1
/** where the pickup boxes are centred: gripDepth (0.4) below the flange */
const BOX_Y = EOAT_Y - 0.4

const base = fileURLToPath(new URL('../../examples/parts/pitch-gripper/', import.meta.url))
const toolPackage = () =>
  buildPackage(JSON.parse(readFileSync(`${base}rig.json`, 'utf8')) as PackageManifest, readFileSync(`${base}behavior.ts`, 'utf8'))

function setup(): SimWorld {
  registerPackage(
    buildPackage(
      {
        id: HOST,
        name: 'Host',
        geometry: {
          kind: 'rig',
          links: [
            { name: 'base', shape: { kind: 'frame' }, offset: [0, 0, 0] },
            { name: 'eoat', parent: 'base', shape: { kind: 'frame' }, offset: [0, EOAT_Y, 0] },
          ],
          joints: [],
        },
      },
      'definePart({ step() {} })',
    ),
  )
  registerPackage(toolPackage())
  const comms = { enableComms: true, pitchTag: 'pitch', gripATag: 'gripA', gripBTag: 'gripB', heldATag: 'heldA', heldBTag: 'heldB', pitchOkTag: 'pitchOk' }
  const parts = [
    { id: 'host', type: 'part', packageId: HOST, position: [0, 0, 0], rotationY: 0, params: {} },
    { id: 'tool', type: 'part', packageId: 'oip.pitch-gripper', position: [0, EOAT_Y, 0], rotationY: 0, params: comms, parent: 'host' },
  ] as unknown as SdkPart[]
  const w = new SimWorld(Jolt, { version: SCENE_VERSION, parts } as SceneJSON)
  // two products in each section's box at the closed pitch of 0.5 (the boxes span x -0.45..-0.05 and 0.05..0.45)
  for (const x of [-0.35, -0.15, 0.15, 0.35]) w.spawnBoxAt(x, BOX_Y, 0, 0.08, 0.1, 0.08)
  return w
}

const xs = (w: SimWorld): number[] => {
  const f = w.frame()
  return Array.from({ length: f.ids.length }, (_, i) => f.positions[i * 3] as number)
}
const ys = (w: SimWorld): number[] => {
  const f = w.frame()
  return Array.from({ length: f.ids.length }, (_, i) => f.positions[i * 3 + 1] as number)
}
const run = (w: SimWorld, ticks: number): void => {
  for (let i = 0; i < ticks; i++) w.step()
}

describe('Pitch Gripper', () => {
  let world: SimWorld | null = null
  afterEach(() => {
    world?.dispose()
    world = null
    unregisterPackage(HOST)
    unregisterPackage('oip.pitch-gripper')
  })

  it('is a valid package that rides the flange and leaves the robot gripper alone', () => {
    const pkg = toolPackage()
    expect(validatePartPackage(pkg)).toEqual([])
    const geo = pkg.geometry as { mount?: { link: string; grip?: unknown } }
    expect(geo.mount).toEqual({ link: 'eoat' })
  })

  it('holds each section\'s products and spreads them apart when the pitch opens', () => {
    const w = (world = setup())
    w.setBehaviorInputTags({ pitch: 0.5, gripA: true, gripB: true })
    run(w, 30)
    expect(w.frame().tags?.tool?.heldA).toBe(true)
    expect(w.frame().tags?.tool?.heldB).toBe(true)
    // 1.2 m centre to centre is 0.7 m more than the closed pitch, so each section travels 0.35 m, at 0.5 m/s
    w.setBehaviorInputTags({ pitch: 1.2, gripA: true, gripB: true })
    run(w, 240)
    expect(w.frame().tags?.tool?.pitchOk).toBe(true)
    const [a1, a2, b1, b2] = xs(w) as [number, number, number, number]
    expect(a1).toBeCloseTo(-0.7, 1)
    expect(a2).toBeCloseTo(-0.5, 1)
    expect(b1).toBeCloseTo(0.5, 1)
    expect(b2).toBeCloseTo(0.7, 1)
    // the products stayed in the sections' hands the whole way
    for (const y of ys(w)) expect(y).toBeCloseTo(BOX_Y, 1)
  })

  it('sets one section down while the other keeps holding', () => {
    const w = (world = setup())
    w.setBehaviorInputTags({ pitch: 0.5, gripA: true, gripB: true })
    run(w, 30)
    w.setBehaviorInputTags({ pitch: 0.5, gripA: true, gripB: false })
    run(w, 60)
    const y = ys(w)
    expect(y[0]).toBeCloseTo(BOX_Y, 1)
    expect(y[1]).toBeCloseTo(BOX_Y, 1)
    expect(y[2]).toBeLessThan(BOX_Y - 0.2)
    expect(y[3]).toBeLessThan(BOX_Y - 0.2)
    expect(w.frame().tags?.tool?.heldB).toBe(false)
    expect(w.frame().tags?.tool?.heldA).toBe(true)
  })

  it('picks nothing until the program closes a section', () => {
    const w = (world = setup())
    w.setBehaviorInputTags({ pitch: 0.5, gripA: false, gripB: false })
    run(w, 60)
    for (const y of ys(w)) expect(y).toBeLessThan(BOX_Y - 0.2)
  })
})
