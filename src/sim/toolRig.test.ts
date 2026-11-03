import initJolt from 'jolt-physics'
import { afterEach, describe, expect, it } from 'vitest'
import { SCENE_VERSION } from '../core/types'
import type { SdkPart, SceneJSON } from '../core/types'
import { registerPackage, unregisterPackage } from '../core/parts/partRegistry'
import type { RigLink } from '../core/parts/partPackage'
import { buildPackage } from './buildPackage'
import { SimWorld } from './world'

// A tool with a rig of its own (docs/part-mounts.md): its links, joints and grippers are rooted on the host link it rides,
// so a section of the tool that slides on a joint takes its pickup volume and its load along, and each section opens on
// its own command. The pattern is a pitch-change head that picks a row of products and sets them down in two places.

const Jolt = await initJolt()

const HOST = 'test.toolrig.host'
const TOOL = 'test.toolrig.tool'
const HAND_Y = 0.5

// The host lifts its hand steadily, so whatever the tool holds rides up with it.
const HOST_SCRIPT = `
  let lift = 0
  definePart({
    joints: ['lift'],
    step(ctx) {
      lift = Math.min(lift + ctx.dt * 2, 1.5)
      ctx.joints.lift = lift
    },
  })`

// Both sections close on the first tick. The head then spreads by \`spread\` metres, and section B opens after \`openB\` ticks.
const TOOL_SCRIPT = `
  let t = 0
  definePart({
    joints: ['slideA', 'slideB'],
    grippers: ['secA', 'secB'],
    params: {
      spread: { type: 'number', default: 0.6, min: 0, max: 2, step: 0.01, label: 'Spread (m)' },
      openB: { type: 'number', default: 1000000, min: 1, max: 1000000, step: 1, label: 'Open B after (ticks)' },
    },
    step(ctx) {
      t += 1
      ctx.grips.secA = true
      ctx.grips.secB = t <= ctx.params.openB
      const s = t > 20 ? ctx.params.spread : 0
      ctx.joints.slideA = -s / 2
      ctx.joints.slideB = s / 2
    },
  })`

function setup(toolParams: Record<string, unknown> = {}): SimWorld {
  registerPackage(
    buildPackage(
      {
        id: HOST,
        name: 'Host',
        geometry: {
          kind: 'rig',
          links: [
            { name: 'base', shape: { kind: 'frame' }, offset: [0, 0, 0] },
            { name: 'hand', parent: 'base', shape: { kind: 'frame' }, offset: [0, HAND_Y, 0] },
          ],
          joints: [{ name: 'lift', link: 'hand', type: 'prismatic', axis: [0, 1, 0], min: 0, max: 2 }],
        },
      },
      HOST_SCRIPT,
    ),
  )
  const section = (name: string, x: number): RigLink => ({ name, parent: 'head', shape: { kind: 'frame' }, offset: [x, 0, 0], grip: { zone: { size: [0.3, 0.4, 0.4] } } })
  registerPackage(
    buildPackage(
      {
        id: TOOL,
        name: 'Split head',
        geometry: {
          kind: 'rig',
          links: [{ name: 'head', shape: { kind: 'frame' }, offset: [0, 0, 0] }, section('secA', -0.2), section('secB', 0.2)],
          joints: [
            { name: 'slideA', link: 'secA', type: 'prismatic', axis: [1, 0, 0], min: -1, max: 1 },
            { name: 'slideB', link: 'secB', type: 'prismatic', axis: [1, 0, 0], min: -1, max: 1 },
          ],
          mount: { link: 'hand' },
        },
      },
      TOOL_SCRIPT,
    ),
  )
  const parts = [
    { id: 'host', type: 'part', packageId: HOST, position: [0, 0, 0], rotationY: 0, params: {} },
    { id: 'tool', type: 'part', packageId: TOOL, position: [0, HAND_Y, 0], rotationY: 0, params: toolParams, parent: 'host' },
  ] as unknown as SdkPart[]
  const w = new SimWorld(Jolt, { version: SCENE_VERSION, parts } as SceneJSON)
  w.spawnBoxAt(-0.2, HAND_Y, 0, 0.12, 0.1, 0.12)
  w.spawnBoxAt(0.2, HAND_Y, 0, 0.12, 0.1, 0.12)
  return w
}

/** box centres [x, y] in spawn order, read off the frame snapshot */
function boxes(w: SimWorld): [number, number][] {
  const f = w.frame()
  const out: [number, number][] = []
  for (let i = 0; i < f.ids.length; i++) out.push([f.positions[i * 3] as number, f.positions[i * 3 + 1] as number])
  return out
}

function run(w: SimWorld, ticks: number): void {
  for (let i = 0; i < ticks; i++) w.step()
}

describe('a tool with a rig of its own', () => {
  let world: SimWorld | null = null
  afterEach(() => {
    world?.dispose()
    world = null
    unregisterPackage(HOST)
    unregisterPackage(TOOL)
  })

  it('carries what its sections hold along with the host link', () => {
    const w = (world = setup({ spread: 0 }))
    run(w, 60)
    for (const [, y] of boxes(w)) expect(y).toBeGreaterThan(HAND_Y + 0.5)
  })

  it('moves a section on its joint, with the pickup volume and the load', () => {
    const w = (world = setup({ spread: 0.6 }))
    run(w, 90)
    const [a, b] = boxes(w)
    expect(a![1]).toBeGreaterThan(HAND_Y + 0.5)
    expect(b![1]).toBeGreaterThan(HAND_Y + 0.5)
    // 0.4 m apart at the pick, 0.6 m more after the spread
    expect(b![0] - a![0]).toBeCloseTo(1.0, 1)
  })

  it('opens one section on its own, leaving the other holding', () => {
    const w = (world = setup({ openB: 40 }))
    run(w, 120)
    const [a, b] = boxes(w)
    expect(a![1]).toBeGreaterThan(HAND_Y + 0.5)
    expect(b![1]).toBeLessThan(HAND_Y)
  })

  it('picks nothing when a section is not commanded closed', () => {
    const w = (world = setup({ openB: 1 }))
    run(w, 60)
    const [, b] = boxes(w)
    expect(b![1]).toBeLessThan(HAND_Y)
  })
})
