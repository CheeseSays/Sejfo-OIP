import { describe, expect, it } from 'vitest'
import { arrayInstanceDeltas, resolvedBoxSize } from '../../core/rig/rigPose'
import { evalPartGeometry } from '../../core/geometry/geometryEval'
import { resolvedBounds } from '../../core/parts/partGeometry'
import type { MeshPart } from '../../core/parts/partApi'
import { PACKAGE_FORMAT, validatePartPackage } from '../../core/parts/partPackage'
import { examplePart, type RigGeo } from './examplePart'
const { geometry: TOOL_RIG, materials: TOOL_MATERIALS, behavior: TOOL_BEHAVIOR } = examplePart<RigGeo>('oip.vacuum-tool')

// The Vacuum Tool (examples/parts/vacuum-tool), the end-of-arm tool of the Six-Axis Robot, as a part of its own. It rides the
// robot's `eoat` link (mount), gives the robot's gripper its pickup volume, and draws the tool at the size its params ask for.

const P = (over: Record<string, number | boolean> = {}): Record<string, number | boolean> => ({
  toolSizeX: 0.5, toolSizeZ: 0.5, cupPitchX: 0.1, cupPitchZ: 0.1, cupMarginX: 0.05, cupMarginZ: 0.05, cupsEnabled: true, ...over,
})
const drawn = (p: Record<string, number | boolean>): MeshPart[] => evalPartGeometry(TOOL_BEHAVIOR, p) ?? []
/** the suction-cup bed: the instanced submesh */
const cupBed = (p: Record<string, number | boolean>): MeshPart | undefined => drawn(p).find((m) => m.material === 'eoatCup' && m.instances !== undefined)
/** the box round every submesh of one material */
const box = (parts: readonly MeshPart[], material: string): { min: number[]; max: number[] } => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const m of parts) {
    if (m.material !== material) continue
    const pos = m.desc.positions
    for (let i = 0; i < pos.length; i += 3) {
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a]!, pos[i + a]!)
        max[a] = Math.max(max[a]!, pos[i + a]!)
      }
    }
  }
  return { min, max }
}

describe('Vacuum Tool part', () => {
  it('is a structurally valid package', () => {
    const pkg = {
      format: PACKAGE_FORMAT, id: 'oip.vacuum-tool', name: 'Vacuum Tool', params: {},
      behavior: 'definePart({ lamps:["vacuumLamp"], step(){} })',
      geometry: TOOL_RIG,
      materials: TOOL_MATERIALS,
    }
    expect(validatePartPackage(pkg)).toEqual([])
  })

  it('rides the robot flange and gives its gripper the plate as the pickup volume', () => {
    expect(TOOL_RIG.mount?.link).toBe('eoat')
    expect(TOOL_RIG.mount?.grip?.link).toBe('gripper')
    const zone = TOOL_RIG.mount!.grip!.zone
    // C-multigrab: the pickup volume's footprint is the plate 1:1 - that is what makes "everything under the plate,
    // nothing beside it" true. It also decides how many cases the tool takes, with no mode to set: sized to the layer it
    // lifts the whole formed layer in one grip, sized to one case it picks one.
    expect(resolvedBoxSize(zone.size, zone.sizeParams, { toolSizeX: 1.2, toolSizeZ: 1.0 })).toEqual([1.2, 0.7, 1.0])
    expect(resolvedBoxSize(zone.size, zone.sizeParams, { toolSizeX: 0.5, toolSizeZ: 0.5 })).toEqual([0.5, 0.7, 0.5])
  })

  it('has its own rig frame, whose resize dots ride the arm with the tool', () => {
    expect(TOOL_RIG.links.map((l) => l.name)).toEqual(['eoat'])
    expect(TOOL_BEHAVIOR).toContain("handle: { kind: 'rigSize', link: 'eoat', axis: 'x', frameY: -0.075 }")
    expect(TOOL_BEHAVIOR).toContain("handle: { kind: 'rigSize', link: 'eoat', axis: 'z', frameY: -0.075 }")
    // every piece of the tool is drawn on that frame
    for (const m of drawn(P())) expect(m.link).toBe('eoat')
  })

  it('stands on its cups, with a footprint that follows the plate', () => {
    const at = (toolSizeX: number, toolSizeZ: number) => resolvedBounds(TOOL_RIG.bounds!, { toolSizeX, toolSizeZ })
    expect(at(1.5, 0.75)).toMatchObject({ length: 1.5, width: 0.75, top: 0 })
    expect(at(0.5, 0.5).bottom).toBeCloseTo(-0.1567, 4)
  })

  // The vacuum indicator is a green LED on the tool, driven by the robot's vacuum lamp. It is drawn, not a box link, so it is
  // no collider; the cups do not glow, they physically compress 15% along their axis off the same lamp.
  it('draws a vacuum LED the cups compress with, not glowing cups', () => {
    const led = drawn(P()).find((m) => m.lamps?.[0]?.name === 'vacuumLamp')!
    const lit = led.lamps![0]!.emissive
    expect(lit[1]).toBeGreaterThan(lit[0]) // green-dominant
    expect(TOOL_RIG.links.some((l) => l.name === 'vacuumLamp')).toBe(false)
    const cups = cupBed(P())!
    expect(cups.lamps).toBeUndefined()
    expect(cups.squash).toEqual({ amount: 0.15, lamp: 'vacuumLamp' })
  })

  // The LED sits at the +X/+Z plate corner, 0.07 m in, so a resized tool tracks it instead of stranding it off the
  // enlarged plate: seated on the back face, inside the frame and clear of the adapter at every size.
  it.each([[0.5, 0.5], [1.5, 0.75], [3, 3]] as const)('seats the vacuum LED on the plate, inside the frame - %s x %s m', (sx, sz) => {
    const parts = drawn(P({ toolSizeX: sx, toolSizeZ: sz }))
    const bezel = box(parts, 'eoatPlastic')
    expect(bezel.min[1]).toBeCloseTo(-0.0517, 6) // on the back face
    expect((bezel.min[0]! + bezel.max[0]!) / 2).toBeCloseTo(sx / 2 - 0.07, 3) // tracks the corner
    expect((bezel.min[2]! + bezel.max[2]!) / 2).toBeCloseTo(sz / 2 - 0.07, 3)
    expect(bezel.max[0]).toBeLessThan(sx / 2 - 0.012) // short of the rails' inner faces
    expect(bezel.max[2]).toBeLessThan(sz / 2 - 0.012)
    expect(bezel.min[0]! > 0.096 || bezel.min[2]! > 0.159).toBe(true) // clear of the 192 x 318 mm adapter plate
    // the lens sits in the bezel
    const lens = box(parts, 'eoatLens')
    expect(lens.min[1]).toBeCloseTo(bezel.max[1]!, 6)
    expect(lens.max[0]! - lens.min[0]!).toBeLessThan(bezel.max[0]! - bezel.min[0]!)
  })

  // The tool is built at the size the params ask for: the plate and frame grow with toolSizeX/Z while the rail section and
  // the caps keep their size, and the cup grid regenerates.
  describe('resizes (toolSizeX/Z, cup grid, cupsEnabled)', () => {
    it("frames the plate at its size: rails 3 mm outside ±size/2, centred on the handles' frameY", () => {
      for (const [sx, sz] of [[0.5, 0.5], [1.5, 0.75], [3, 2.5]] as const) {
        const parts = drawn(P({ toolSizeX: sx, toolSizeZ: sz }))
        const rails = box(parts, 'eoatRail')
        expect(rails.min[0]).toBeCloseTo(-sx / 2 - 0.003, 6)
        expect(rails.max[0]).toBeCloseTo(sx / 2 + 0.003, 6)
        expect(rails.min[2]).toBeCloseTo(-sz / 2 - 0.003, 6)
        expect(rails.max[2]).toBeCloseTo(sz / 2 + 0.003, 6)
        expect((rails.min[1]! + rails.max[1]!) / 2).toBeCloseTo(-0.075, 6)
        // the plate and its corner caps (2 mm proud of the rails), and the plate's back face the LED sits on
        const paint = box(parts, 'eoatPaint')
        expect(paint.max[0]).toBeCloseTo(sx / 2 + 0.005, 6)
        expect(paint.max[2]).toBeCloseTo(sz / 2 + 0.005, 6)
      }
    })

    it('keeps the rail section at its own size, however big the plate (no stretching)', () => {
      const small = drawn(P()).find((m) => m.material === 'eoatRail')!
      const big = drawn(P({ toolSizeX: 3, toolSizeZ: 3 })).find((m) => m.material === 'eoatRail')!
      // the same extrusions, longer: the vertex count is the section's, not the length's
      expect(big.desc.positions.length).toBe(small.desc.positions.length)
      const b = box([big], 'eoatRail')
      expect(b.max[1]! - b.min[1]!).toBeCloseTo(0.059, 6)
    })

    it('regenerates the cup grid by the host grid rule: floor(usable/pitch)+1 per axis, edge-to-edge', () => {
      const cupsAt = (p: Record<string, number | boolean>): number[][] => (cupBed(p)?.instances ?? []).map((i) => [...i.position])
      // default: usable = 0.5 − 2·0.05 = 0.4 → 5×5 cups from −0.2 to +0.2, mounted under the plate
      const cups = cupsAt(P())
      expect(cups).toHaveLength(25)
      const xs = [...new Set(cups.map((d) => d[0]!.toFixed(6)))].map(Number).sort((a, b) => a - b)
      expect(xs).toEqual([-0.2, -0.1, 0, 0.1, 0.2])
      for (const c of cups) expect(c[1]).toBeCloseTo(-0.1035, 10)
      // the same cells the rig's `grid` array lays, its 256-cup thinning included, so a bed reads the same whichever drew it
      const grid = {
        x: { sizeParam: 'toolSizeX', pitchParam: 'cupPitchX', marginParam: 'cupMarginX' },
        z: { sizeParam: 'toolSizeZ', pitchParam: 'cupPitchZ', marginParam: 'cupMarginZ' },
      }
      const key = (v: number[]): string => v.map((n) => n.toFixed(6)).join(',')
      const cases: Record<string, number>[] = [{}, { toolSizeX: 1.9 }, { toolSizeX: 2.2, toolSizeZ: 1.3, cupPitchX: 0.07, cupMarginZ: 0.12 }, { cupMarginX: 0.3 }, { toolSizeX: 3, toolSizeZ: 3 }]
      for (const over of cases) {
        const host = arrayInstanceDeltas({ grid }, P(over)).map((d) => [d[0], d[2]])
        const cells = cupsAt(P(over)).map((c) => [c[0]!, c[2]!])
        expect(cells.length).toBe(host.length)
        expect(new Set(cells.map(key))).toEqual(new Set(host.map(key)))
      }
      // cupsEnabled=false → no cups
      expect(cupsAt(P({ cupsEnabled: false }))).toHaveLength(0)
    })
  })
})
