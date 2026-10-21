import { describe, expect, it } from 'vitest'
import { qApply, resolvedGrabZone, rigWorldPoses } from '../../core/rig/rigPose'
import { evalPartGeometry } from '../../core/geometry/geometryEval'
import type { MeshPart } from '../../core/parts/partApi'
import { PACKAGE_FORMAT, validatePartPackage } from '../../core/parts/partPackage'
import { robotForwardKinematics } from './robotKinematics'
import { examplePart, type RigGeo } from './examplePart'
const { geometry: SIX_AXIS_RIG, materials: SIX_AXIS_MATERIALS, assets: SIX_AXIS_ASSETS, behavior: SIX_AXIS_BEHAVIOR } = examplePart<RigGeo>('oip.six-axis-robot')

// The Six-Axis robot, authored as a custom part (examples/parts/six-axis-robot), must place its gripper
// at exactly the same spot the built-in robot does for the same joint angles. Otherwise the "convergence"
// (a first-party part rebuilt on the public SDK) would be only cosmetic. This pins the rig FK (frame links +
// quaternion rest rotations composed by core/rig/rigPose) to robotForwardKinematics, the built-in's source of
// truth. The rig comes from the committed rig.json (built from examples/parts/six-axis-robot/part.js); the GLB/
// textures it names are irrelevant to kinematics, so they're not needed here.

const geo = SIX_AXIS_RIG

// the geometry() the robot draws itself: the flange's vacuum status lamp, and nothing else
const drawn = (): MeshPart[] => evalPartGeometry(SIX_AXIS_BEHAVIOR, {}) ?? []
const D2R = Math.PI / 180
const valuesOf = (deg: number[]): Record<string, number> => ({
  j1: deg[0]! * D2R, j2: deg[1]! * D2R, j3: deg[2]! * D2R, j4: deg[3]! * D2R, j5: deg[4]! * D2R, j6: deg[5]! * D2R,
})

const POSES: [string, number[]][] = [
  ['zero', [0, 0, 0, 0, 0, 0]],
  ['home', [0, -45, 90, 25, 75, 0]],
  ['pick', [0, -15, 55, 0, 80, 0]],
  ['place', [110, -15, 55, 0, 80, 0]],
  ['mixed', [-90, 30, -40, 120, -60, 200]],
]

describe('Six-Axis custom-part rig - kinematic parity with the built-in robot', () => {
  it('is a structurally valid package (rig + a dummy behavior + dummy assets/materials)', () => {
    const pkg = {
      format: PACKAGE_FORMAT, id: 'oip.six-axis-robot', name: 'Six-Axis Robot', params: {},
      behavior: 'definePart({ joints:["j1","j2","j3","j4","j5","j6"], grippers:["gripper"], step(){} })',
      geometry: geo,
      // the committed url-assets stand in as embedded blobs (same ids - the refs are what's validated)
      assets: SIX_AXIS_ASSETS.map((a) => ({ id: a.id, mime: a.mime, data: 'AAAA' })),
      materials: SIX_AXIS_MATERIALS,
    }
    expect(validatePartPackage(pkg)).toEqual([])
  })

  it.each(POSES)('gripper world position matches robotForwardKinematics - %s pose', (_name, deg) => {
    const grip = rigWorldPoses(geo, valuesOf(deg)).get('gripper')!
    const ref = robotForwardKinematics(deg)
    expect(grip.pos[0]).toBeCloseTo(ref.gripper.x, 4)
    expect(grip.pos[1]).toBeCloseTo(ref.gripper.y, 4)
    expect(grip.pos[2]).toBeCloseTo(ref.gripper.z, 4)
  })

  // The tool is not the robot's: it is a Vacuum Tool seated on the flange (vacuumToolPart.test.ts), and it gives the
  // gripper the pickup volume. Alone, the robot's gripper has a 2 cm volume no case's centre is ever inside, so a bare
  // flange picks nothing. The robot's one lamp is a status lamp on the flange, driven by the same vacuum signal the
  // tool's cups compress off.
  it('declares a bare flange that picks nothing, and a vacuum-status lamp on the flange', () => {
    const gripper = geo.links.find((l) => l.name === 'gripper')!
    expect([gripper.grip?.radius, gripper.grip?.radiusParams]).toEqual([undefined, undefined])
    expect(resolvedGrabZone(gripper, {})?.half).toEqual([0.01, 0.01, 0.01])
    // the lamp is drawn, not a box link, so it is no collider riding the arm
    const lamp = drawn().find((m) => m.lamps?.[0]?.name === 'vacuumLamp')!
    const lit = lamp.lamps![0]!.emissive
    expect(lit[1]).toBeGreaterThan(lit[0]) // green-dominant
    expect(lamp.link).toBe('tool')
    expect(geo.links.some((l) => l.name === 'vacuumLamp')).toBe(false)
    expect(SIX_AXIS_BEHAVIOR).toContain('ctx.lamps.vacuumLamp = gripClosed')
  })

  it('places every linkage mesh under a driven pivot (no orphaned links)', () => {
    const names = new Set(geo.links.map((l) => l.name))
    for (const l of geo.links) if (l.parent) expect(names.has(l.parent)).toBe(true)
    // base + 5 linkages + 2 hydraulics + tool plate; the EOAT is drawn by geometry(), not carried as model links
    expect(geo.links.filter((l) => l.shape.kind === 'mesh')).toHaveLength(9)
    expect(geo.joints).toHaveLength(6)
  })

  // The tool flange (mounted flipped 180°-about-Z at the tool pivot + 0.009 on the robot) is the frame a tool part
  // seats on. The tool itself is vacuumToolPart.test.ts's.
  describe('tool flange', () => {
    const link = (name: string) => geo.links.find((l) => l.name === name)!

    it('mounts the flange flipped 180° about Z at the tool pivot + (0, 0.009, 0) - the EOAT mount transform', () => {
      const eoatLink = link('eoat')
      expect(eoatLink.parent).toBe('tool')
      expect(eoatLink.offset).toEqual([0, 0.009, 0])
      expect(eoatLink.quat).toEqual([0, 0, 1, 0])
      expect(eoatLink.shape.kind).toBe('frame')
      // what the robot draws itself rides the tool link, and none of it needs a model or a texture
      for (const m of drawn()) expect(m.link).toBe('tool')
      expect(SIX_AXIS_ASSETS.map((a) => a.id)).toEqual(['glb', 'albedo', 'orm'])
    })

    it('has no tool params: the tool is a part of its own', () => {
      for (const k of ['toolSizeX', 'toolSizeZ', 'cupPitchX', 'cupPitchZ', 'cupMarginX', 'cupMarginZ', 'cupsEnabled']) expect(SIX_AXIS_BEHAVIOR).not.toContain(`${k}:`)
    })
  })

  // The two hydraulic struts are a two-point look-at (C-aim):
  // each anchor aims its +Z at the other so the struts stay connected as J1/J2 bend the arm. The bug this
  // fixes had them frozen at a static rest quat, detaching the instant the arm moved.
  describe('hydraulic struts stay connected as the arm bends', () => {
    const fwd = (q: number[]): number[] => qApply([q[0]!, q[1]!, q[2]!, q[3]!], [0, 0, 1]) // world +Z (aim dir)
    const dirTo = (from: number[], to: number[]): number[] => {
      const v = [to[0]! - from[0]!, to[1]! - from[1]!, to[2]! - from[2]!]
      const l = Math.hypot(v[0]!, v[1]!, v[2]!) || 1
      return [v[0]! / l, v[1]! / l, v[2]! / l]
    }
    const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!

    it('declares the two anchors as mutual aim targets', () => {
      expect(geo.links.find((l) => l.name === 'hydBaseAnchor')?.aim?.target).toBe('hydRodAnchor')
      expect(geo.links.find((l) => l.name === 'hydRodAnchor')?.aim?.target).toBe('hydBaseAnchor')
    })

    it.each(POSES)('each anchor points its +Z at the other - %s pose', (_name, deg) => {
      const w = rigWorldPoses(geo, valuesOf(deg))
      const base = w.get('hydBaseAnchor')!
      const rod = w.get('hydRodAnchor')!
      expect(dot(fwd(base.quat), dirTo(base.pos, rod.pos))).toBeCloseTo(1, 5)
      expect(dot(fwd(rod.quat), dirTo(rod.pos, base.pos))).toBeCloseTo(1, 5)
      // the identity-child hydraulic meshes inherit the aimed orientation exactly
      expect(w.get('hyd1')!.quat).toEqual(base.quat)
      expect(w.get('hyd2')!.quat).toEqual(rod.quat)
    })

    it('re-aims as the arm moves (not frozen at the static rest quat)', () => {
      const a = rigWorldPoses(geo, valuesOf([0, 0, 0, 0, 0, 0])).get('hydRodAnchor')!.quat
      const b = rigWorldPoses(geo, valuesOf([0, -120, 0, 0, 0, 0])).get('hydRodAnchor')!.quat
      const cos = Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!)
      expect(cos).toBeLessThan(0.999) // a real orientation change between two distinct poses
    })
  })
})
