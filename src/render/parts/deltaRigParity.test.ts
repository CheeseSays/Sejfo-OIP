import { describe, expect, it } from 'vitest'
import { deltaArmAngles, jointLimits, qApply, rigWorldPoses } from '../../core/rig/rigPose'
import type { LinkPose } from '../../core/rig/rigPose'
import { PACKAGE_FORMAT } from '../../core/parts/partPackage'
import { validatePartPackage } from '../../core/parts/partValidate'
import { examplePart, type RigGeo } from './examplePart'

const { geometry: geo, materials } = examplePart<RigGeo>('oip.delta-robot')
const delta = geo.delta!

// The Delta Robot's rig solves its arm joints from the platform's three slides (geometry.delta). What matters is the
// mechanism the rig draws: every rod is as long as the rod is, the platform stays level, and the tool seat and the
// gripper go where the slides say, wherever in the work area the platform stands.

const dist = (a: LinkPose, b: LinkPose): number => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2])
const limits = (name: string): [number, number] => jointLimits(geo.joints.find((j) => j.name === name)!)
/** the corners, edge middles and centre of the work box, at the top, middle and bottom of its lowering */
const sweep = (): Record<string, number>[] => {
  const out: Record<string, number>[] = []
  const [xl, xh] = limits('x')
  const [yl, yh] = limits('y')
  const [zl, zh] = limits('z')
  for (const x of [xl, 0, xh]) for (const y of [yl, 0, yh]) for (const z of [zl, (zl + zh) / 2, zh]) out.push({ x, y, z })
  return out
}

describe('Delta Robot rig', () => {
  it('is a structurally valid package', () => {
    const pkg = {
      format: PACKAGE_FORMAT, id: 'oip.delta-robot', name: 'Delta Robot', params: {},
      behavior: 'definePart({ joints:["x","y","z"], grippers:["gripper"], step(){} })',
      geometry: geo,
      assets: [],
      materials,
    }
    expect(validatePartPackage(pkg)).toEqual([])
  })

  it('keeps every rod its length across the whole work area', () => {
    for (const v of sweep()) {
      const poses = rigWorldPoses(geo, v)
      for (const arm of [1, 2, 3]) {
        for (const k of ['a', 'b']) {
          // the rod frame starts beside the elbow by the pair's half gap; its far end is the platform's rod end
          const rod = poses.get(`rod${arm}${k}`)!
          const end = poses.get(`end${arm}${k}`)!
          expect(dist(rod, end), `rod ${arm}${k} at ${JSON.stringify(v)}`).toBeCloseTo(delta.rod, 5)
          expect(dist(rod, poses.get(`elbow${arm}`)!)).toBeCloseTo(0.04, 6)
        }
      }
    }
  })

  it('keeps every arm inside its limits across the whole work area', () => {
    const arm = geo.joints.find((j) => j.name === 'a1')!
    for (const v of sweep()) {
      const point: [number, number, number] = [delta.center[0] + v.x!, delta.center[1] - v.z!, delta.center[2] + v.y!]
      for (const a of deltaArmAngles(delta, point)) {
        expect(a).toBeGreaterThan(arm.min + 0.05)
        expect(a).toBeLessThan(arm.max - 0.05)
      }
    }
  })

  it('keeps the platform level and puts the tool seat and the gripper where the slides say', () => {
    for (const v of sweep()) {
      const poses = rigWorldPoses(geo, v)
      const platform = poses.get('platform')!
      expect(Math.hypot(platform.quat[0], platform.quat[1], platform.quat[2])).toBeLessThan(1e-9)
      expect(platform.pos[0]).toBeCloseTo(delta.center[0] + v.x!, 9)
      expect(platform.pos[1]).toBeCloseTo(delta.center[1] - v.z!, 9)
      expect(platform.pos[2]).toBeCloseTo(delta.center[2] + v.y!, 9)
      const eoat = poses.get('eoat')!
      expect(eoat.pos[1]).toBeCloseTo(platform.pos[1] - 0.016, 9)
      expect(poses.get('gripper')!.pos[1]).toBeCloseTo(platform.pos[1] - 0.016 - 0.1567, 9)
      // a tool hangs toward -Y of the eoat frame, as on the Six-Axis Robot's flange
      expect(qApply(eoat.quat, [0, -1, 0])[1]).toBeCloseTo(-1, 9)
    }
  })

  it('draws the arms at rest from no joint values at all', () => {
    const rest = rigWorldPoses(geo, {})
    for (const [name, pose] of rigWorldPoses(geo, { x: 0, y: 0, z: 0 })) expect(rest.get(name)!.pos).toEqual(pose.pos)
  })

  it('shows only the platform slides to the gizmo and the idle pose', () => {
    expect(geo.joints.filter((j) => !j.cosmetic).map((j) => j.name)).toEqual(['x', 'y', 'z'])
    expect(geo.posable).toBe(true)
  })
})

describe('deltaArmAngles', () => {
  it('stretches an arm toward a point it cannot reach, without a NaN', () => {
    for (const a of deltaArmAngles(delta, [5, -5, 5])) expect(Number.isFinite(a)).toBe(true)
    for (const a of deltaArmAngles(delta, [delta.center[0], delta.arms[0]!.shoulder[1], 0])) expect(Number.isFinite(a)).toBe(true)
  })
})
