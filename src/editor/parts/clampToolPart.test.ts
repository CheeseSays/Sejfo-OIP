import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Group, Vector3 } from 'three'
import { clearPackages, registerPackage } from '../../core/parts/partRegistry'
import { resolvePartParams } from '../../core/parts/partScript'
import { validatePartPackage } from '../../core/parts/partPackage'
import type { PartPackage } from '../../core/parts/partPackage'
import { evalPartGeometry } from '../../core/geometry/geometryEval'
import { resolvedGrabZone, rigWorldPoses } from '../../core/rig/rigPose'
import type { RigParams } from '../../core/rig/rigPose'
import { computeSceneMounts, withMountedGrips } from '../../core/scene/sceneMounts'
import type { SdkPart } from '../../core/types'
import { buildPackage } from '../../sim/buildPackage'
import { buildRigGizmo } from '../../render/parts/sdk/rigGizmo'
import { bundledPartById } from './bundledExamples'

// The Clamp Gripper (examples/parts/clamp-tool): a tool whose pickup volume is a box set by four params. It rides the
// robot's `eoat` link, and the robot's gripper picks inside the box, so the test seats it on the committed robot and
// reads where the box ends up in the world.

const build = (id: string): PartPackage => {
  const item = bundledPartById(id)!
  return buildPackage(item.manifest, item.behavior)
}
type Rig = Extract<PartPackage['geometry'], { kind: 'rig' }>
const rigOf = (pkg: PartPackage): Rig => pkg.geometry as Rig

const robot = { id: 'arm', type: 'part', packageId: 'oip.six-axis-robot', position: [0, 0, 0], rotationY: 0, params: {} } as unknown as SdkPart
const clamp = (params: Record<string, number> = {}): SdkPart =>
  ({ id: 'clamp', type: 'part', packageId: 'oip.clamp-tool', position: [0, 0, 0], rotationY: 0, params, parent: 'arm' }) as unknown as SdkPart

describe('Clamp Gripper part', () => {
  let tool: PartPackage
  let arm: PartPackage
  beforeEach(() => {
    arm = build('oip.six-axis-robot')
    tool = build('oip.clamp-tool')
    registerPackage(arm)
    registerPackage(tool)
  })
  afterEach(() => clearPackages())

  it('is a valid package that rides the flange and gives the gripper a box', () => {
    expect(validatePartPackage(tool)).toEqual([])
    const mount = rigOf(tool).mount!
    expect(mount.link).toBe('eoat')
    expect(mount.grip!.link).toBe('gripper')
  })

  it('sizes the pickup box from its three size params', () => {
    const grip = computeSceneMounts([robot, clamp({ gripX: 0.8, gripY: 0.3, gripZ: 1.2 })]).hosts.get('arm')![0]!.grip!
    expect(grip.zone.size).toEqual([0.8, 0.3, 1.2])
  })

  // The box centre is gripDepth below the tool flange along the tool axis, whatever the box size: the
  // gripper link sits below the flange with its +Y toward the load, and the offset has to account for that.
  it.each([0.2, 0.4, 1])('puts the box centre %s m below the flange', (gripDepth) => {
    const mounts = computeSceneMounts([robot, clamp({ gripDepth, gripY: 0.5 })]).hosts.get('arm')
    const geo = withMountedGrips(rigOf(arm), mounts)
    const params = resolvePartParams(arm.params, {}) as unknown as RigParams
    const poses = rigWorldPoses(geo, {}, undefined, 1, params)
    const hand = geo.links.find((l) => l.name === 'gripper')!
    const zone = resolvedGrabZone(hand, params)!
    const g = poses.get('gripper')!
    const e = poses.get('eoat')!
    // the box centre is the gripper position plus its offset turned by the gripper's orientation
    const [qx, qy, qz, qw] = g.quat
    const off = new Vector3(...zone.offset).applyQuaternion({ x: qx, y: qy, z: qz, w: qw } as never)
    const centre = new Vector3(...g.pos).add(off)
    const flange = new Vector3(...e.pos)
    // along the flange's own -Y (the way the tool hangs, whatever the arm's pose), by gripDepth and no sideways
    const [ex, ey, ez, ew] = e.quat
    const hang = new Vector3(0, -1, 0).applyQuaternion({ x: ex, y: ey, z: ez, w: ew } as never)
    const rel = centre.clone().sub(flange)
    expect(rel.dot(hang)).toBeCloseTo(gripDepth, 5)
    expect(rel.clone().addScaledVector(hang, -gripDepth).length()).toBeCloseTo(0, 5)
    expect(zone.half[1]).toBeCloseTo(0.25, 6)
  })

  it('draws the box on a grip link at the box centre, with a handle on each axis', () => {
    const geo = rigOf(tool)
    const link = geo.links.find((l) => l.name === 'grip')!
    expect(link.offset).toEqual([0, -0.4, 0])
    expect(link.offsetParams).toEqual([{ axis: 1, param: 'gripDepth', scale: -1 }])
    const handles = Object.entries(tool.params).filter(([, s]) => (s as { handle?: { kind?: string } }).handle?.kind === 'rigSize')
    expect(handles.map(([, s]) => (s as { handle: { axis: string } }).handle.axis).sort()).toEqual(['x', 'y', 'z'])
    const group = new Group()
    const grip = new Group()
    grip.position.set(0, -0.4, 0)
    group.add(grip)
    const gizmo = buildRigGizmo(geo, group, new Map([['eoat', new Group()], ['grip', grip]]), () => {}, tool.params)!
    gizmo.setSizes!({ gripX: 0.4, gripY: 0.4, gripZ: 0.4 })
    const layout = gizmo.api.layout()
    expect(layout.sizes).toHaveLength(3)
    expect(layout.toolOutlines).toHaveLength(6)
  })

  it('keeps the jaws and pads outside the pickup box, however it is sized', () => {
    for (const [gripX, gripY, gripZ, gripDepth] of [[0.2, 0.3, 0.3, 0.3], [0.4, 0.4, 0.4, 0.4], [2, 1, 1, 1.2]] as const) {
      const parts = evalPartGeometry(bundledPartById('oip.clamp-tool')!.behavior, { gripX, gripY, gripZ, gripDepth }) ?? []
      const pads = parts.filter((m) => m.material === 'clampPad')
      const xs = pads.flatMap((m) => Array.from({ length: m.desc.positions.length / 3 }, (_, k) => Math.abs(m.desc.positions[k * 3]!)))
      expect(Math.min(...xs)).toBeCloseTo(gripX / 2, 6) // the pads' inner faces are the box faces
      const ys = pads.flatMap((m) => Array.from({ length: m.desc.positions.length / 3 }, (_, k) => m.desc.positions[k * 3 + 1]!))
      expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(-gripDepth, 6) // centred on the box
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(gripY, 6)
    }
  })
})
