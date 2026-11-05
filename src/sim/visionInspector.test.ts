/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import initJolt from 'jolt-physics'
import { describe, expect, it } from 'vitest'
import { validateScene } from '../core/scene/scene'
import { SCENE_VERSION } from '../core/types'
import { buildPackage } from './buildPackage'
import type { PackageManifest } from './buildPackage'
import { SimWorld } from './world'

// Rotation inspection: the Spawner drops cases straight or at a random heading, and the Vision Inspector over the belt
// measures each one's turn from the expected angle. What has to hold: straight cases pass, randomly turned ones fail
// when they are turned past the tolerance, the verdict follows the expected angle, and a case is checked once.

const Jolt = await initJolt()
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const pkg = (dir: string) => {
  const rig = JSON.parse(readFileSync(join(repo, 'examples', 'parts', dir, 'rig.json'), 'utf8')) as PackageManifest
  return buildPackage(rig, readFileSync(join(repo, 'examples', 'parts', dir, 'behavior.ts'), 'utf8'))
}

const DECK_Y = 1
const deck = buildPackage(
  { id: 'acme.deck', name: 'Deck', geometry: { kind: 'rig', links: [{ name: 'deck', shape: { kind: 'box', size: [12, 0.1, 1.4] }, offset: [0, -0.05, 0], conveys: true }], joints: [], bounds: { length: 12, width: 1.4, top: 0.1 } } },
  'definePart({ step(ctx) { ctx.setSurfaceVelocity({ x: 0.6, y: 0, z: 0 }) } })',
)

function world(spawner: Record<string, string | boolean | number>, inspector: Record<string, string | boolean | number> = {}): SimWorld {
  const res = validateScene({
    version: SCENE_VERSION,
    packages: [deck, pkg('box'), pkg('box-spawner'), pkg('vision-inspector')],
    parts: [
      { id: 'deck', type: 'part', packageId: 'acme.deck', position: [0, DECK_Y, 0], rotationY: 0, params: {} },
      { id: 'feed', type: 'part', packageId: 'oip.box-spawner', position: [-5, DECK_Y + 0.7, 0], rotationY: 0, params: { boxesPerMinute: 20, ...spawner } },
      // its local Z (travel) turned onto the deck's +x
      { id: 'eye', type: 'part', packageId: 'oip.vision-inspector', position: [1, 0, 0], rotationY: Math.PI / 2, params: { width: 1.6, surfaceHeight: DECK_Y, doneTag: 'Done', okTag: 'Ok', angleTag: 'Angle', countTag: 'Count', rejectCountTag: 'Rejects', ...inspector } },
    ],
  })
  if (!res.ok) throw new Error(`scene invalid: ${res.errors.join('; ')}`)
  return new SimWorld(Jolt, res.scene)
}

const tag = (w: SimWorld, name: string): unknown => w.frame().tags?.eye?.[name]

/** run `seconds`, returning the verdict and deviation on the tags at each rising edge of the inspected pulse */
function inspections(w: SimWorld, seconds: number): { ok: boolean; angle: number }[] {
  const out: { ok: boolean; angle: number }[] = []
  let was = false
  for (let i = 0; i < seconds * 60; i++) {
    w.step()
    const done = tag(w, 'Done') === true
    if (done && !was) out.push({ ok: tag(w, 'Ok') === true, angle: tag(w, 'Angle') as number })
    was = done
  }
  return out
}

describe('rotation inspection (spawner yaw, vision inspector verdict)', () => {
  it('passes cases that lie straight, once each', () => {
    const w = world({})
    const r = inspections(w, 20)
    expect(r.length).toBeGreaterThanOrEqual(4)
    for (const x of r) {
      expect(x.ok).toBe(true)
      expect(Math.abs(x.angle)).toBeLessThan(3)
    }
    expect(tag(w, 'Count')).toBe(r.length)
    expect(tag(w, 'Rejects')).toBe(0)
    expect(w.cargoMarks().filter((m) => m?.inspected === true).length).toBe(r.length)
    w.dispose()
  })

  it('fails randomly turned cases past the tolerance, and counts them', () => {
    const w = world({ randomRotation: true })
    const r = inspections(w, 60)
    expect(r.length).toBeGreaterThanOrEqual(10)
    // a half turn looks the same, so the deviation never exceeds 90 degrees
    for (const x of r) {
      expect(Math.abs(x.angle)).toBeLessThanOrEqual(90.001)
      expect(x.ok).toBe(Math.abs(x.angle) <= 10)
    }
    const failed = r.filter((x) => !x.ok).length
    expect(failed).toBeGreaterThan(0)
    expect(failed).toBeLessThan(r.length)
    expect(tag(w, 'Rejects')).toBe(failed)
    w.dispose()
  })

  it('passes everything at the widest tolerance, so the failures above came from the check', () => {
    const w = world({ randomRotation: true }, { tolerance: 90 })
    const r = inspections(w, 40)
    expect(r.length).toBeGreaterThanOrEqual(6)
    expect(r.every((x) => x.ok)).toBe(true)
    w.dispose()
  })

  it('judges against the expected angle', () => {
    const w = world({}, { expectedAngle: 90 })
    const r = inspections(w, 20)
    expect(r.length).toBeGreaterThanOrEqual(4)
    expect(r.every((x) => !x.ok && Math.abs(Math.abs(x.angle) - 90) < 3)).toBe(true)
    w.dispose()
  })
})
