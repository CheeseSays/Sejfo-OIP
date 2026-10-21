import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearPackages, registerPackage } from '../parts/partRegistry'
import { PACKAGE_FORMAT } from '../parts/partPackage'
import type { PartPackage } from '../parts/partPackage'
import type { PartInstance, SdkPart } from '../types'
import { renderResolvedKey, resolveScene, simResolvedKey } from './sceneResolve'
import { computeSceneMounts, restLinkWorld, withMountedGrips } from './sceneMounts'

// A host with a flange link two metres up and a gripper link on it, and a tool that rides the flange and gives the
// gripper a plate-sized pickup volume.
function hostPkg(): PartPackage {
  return {
    format: PACKAGE_FORMAT,
    id: 'acme.arm',
    name: 'Acme Arm',
    params: { pose: { type: 'numberList', arity: 1, default: [[0]] }, scale: { type: 'number', default: 1 } },
    behavior: 'definePart({ joints:["j1"], grippers:["gripper"], step(){} })',
    geometry: {
      kind: 'rig',
      links: [
        { name: 'boom', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'flange', parent: 'boom', shape: { kind: 'frame' }, offset: [1, 2, 0] },
        { name: 'gripper', parent: 'flange', shape: { kind: 'frame' }, offset: [0, -0.1, 0], grip: { zone: { size: [0.02, 0.02, 0.02] } } },
      ],
      joints: [{ name: 'j1', link: 'boom', type: 'revolute', axis: [0, 1, 0], min: -Math.PI, max: Math.PI }],
      bounds: { length: 2, width: 1, top: 3 },
    },
  } as unknown as PartPackage
}

function toolPkg(link = 'flange'): PartPackage {
  return {
    format: PACKAGE_FORMAT,
    id: 'acme.plate',
    name: 'Acme Plate',
    params: { plateX: { type: 'number', default: 0.5 }, plateZ: { type: 'number', default: 0.5 } },
    behavior: 'definePart({ step(){} })',
    geometry: {
      kind: 'rig',
      links: [{ name: 'face', shape: { kind: 'frame' }, offset: [0, 0, 0] }],
      joints: [],
      mount: { link, grip: { link: 'gripper', zone: { size: [0.5, 0.7, 0.5], sizeParams: [{ axis: 0, param: 'plateX' }, { axis: 2, param: 'plateZ' }] } } },
      bounds: { length: 0.5, width: 0.5, top: 0 },
    },
  } as unknown as PartPackage
}

const host = (over: Partial<SdkPart> = {}): SdkPart =>
  ({ id: 'arm', type: 'part', packageId: 'acme.arm', position: [10, 0, 5], rotationY: 0, params: { pose: [[0]], scale: 1 }, ...over }) as unknown as SdkPart
const tool = (over: Record<string, unknown> = {}, params: Record<string, unknown> = {}): SdkPart =>
  ({ id: 'plate', type: 'part', packageId: 'acme.plate', position: [0, 0, 0], rotationY: 0, params: { plateX: 1.2, plateZ: 1, ...params }, parent: 'arm', ...over }) as unknown as SdkPart

describe('mounts', () => {
  beforeEach(() => {
    registerPackage(hostPkg())
    registerPackage(toolPkg())
  })
  afterEach(() => clearPackages())

  it('seats a tool on the link of its parent, and tells each side', () => {
    const m = computeSceneMounts([host(), tool()])
    expect(m.tools.get('plate')).toEqual({ hostId: 'arm', link: 'flange' })
    expect(m.hosts.get('arm')).toEqual([{ id: 'plate', link: 'flange', grip: { link: 'gripper', zone: { size: [1.2, 0.7, 1] } } }])
  })

  it('does not seat a tool with no parent, a parent without the link, or a second tool on a taken link', () => {
    expect(computeSceneMounts([host(), tool({ parent: undefined })]).tools.size).toBe(0)
    expect(computeSceneMounts([host(), tool({ parent: 'nobody' })]).tools.size).toBe(0)
    registerPackage(toolPkg('wrist'))
    expect(computeSceneMounts([host(), tool()]).tools.size).toBe(0)
    registerPackage(toolPkg())
    const second = tool({ id: 'plate2' })
    const m = computeSceneMounts([host(), tool(), second])
    expect([...m.tools.keys()]).toEqual(['plate'])
  })

  it('reads the grip volume from the tool params, defaults included', () => {
    const bare = tool()
    ;(bare.params as Record<string, unknown>) = {}
    expect(computeSceneMounts([host(), bare]).hosts.get('arm')![0]!.grip!.zone.size).toEqual([0.5, 0.7, 0.5])
  })

  it('gives render the tool and sim the host, and nothing else to either', () => {
    const parts: PartInstance[] = [host(), tool()]
    const render = resolveScene(parts, 'render')
    expect(render.get('plate')?.mountedOn).toEqual({ hostId: 'arm', link: 'flange' })
    expect(render.get('arm')?.mounts).toBeUndefined()
    const sim = resolveScene(parts, 'sim')
    expect(sim.get('arm')?.mounts).toHaveLength(1)
    expect(sim.get('plate')?.mountedOn).toBeUndefined()
  })

  it('moves the keys only when something the consumer builds from changes', () => {
    const base = resolveScene([host(), tool()], 'sim')
    const renderBase = resolveScene([host(), tool()], 'render')
    // the tool resized: the host's gripper volume changed, so the sim rebuilds the host; the tool's seat did not move
    const grown = resolveScene([host(), tool({}, { plateX: 1.5 })], 'sim')
    expect(simResolvedKey('arm', grown.get('arm'))).not.toBe(simResolvedKey('arm', base.get('arm')))
    expect(renderResolvedKey('plate', resolveScene([host(), tool({}, { plateX: 1.5 })], 'render').get('plate'))).toBe(renderResolvedKey('plate', renderBase.get('plate')))
    // the tool moved in the document: neither side rebuilds
    const moved = resolveScene([host(), tool({ position: [3, 3, 3] })], 'sim')
    expect(simResolvedKey('arm', moved.get('arm'))).toBe(simResolvedKey('arm', base.get('arm')))
    // unparented: the tool is no longer seated
    expect(renderResolvedKey('plate', resolveScene([host(), tool({ parent: undefined })], 'render').get('plate'))).toBe('')
  })

  it('swaps the pickup volume of the gripper link and leaves every other link alone', () => {
    const geo = hostPkg().geometry as Extract<PartPackage['geometry'], { kind: 'rig' }>
    const tools = computeSceneMounts([host(), tool()]).hosts.get('arm')
    const seated = withMountedGrips(geo, tools)
    expect(seated.links.find((l) => l.name === 'gripper')?.grip?.zone).toEqual({ size: [1.2, 0.7, 1] })
    expect(seated.links.filter((l) => l.name !== 'gripper')).toEqual(geo.links.filter((l) => l.name !== 'gripper'))
    // no tool, no change: the same object, so nothing rebuilds
    expect(withMountedGrips(geo, undefined)).toBe(geo)
    expect(geo.links.find((l) => l.name === 'gripper')?.grip?.zone).toEqual({ size: [0.02, 0.02, 0.02] })
  })

  it('finds a link where the host rests: its idle pose, scale and yaw', () => {
    // the joint is j1 about Y: an idle pose of 90° swings the flange from +X round to -Z
    const at = restLinkWorld(host({ params: { pose: [[90]], scale: 1 } as never }), 'flange')!
    expect(at.x).toBeCloseTo(10, 6)
    expect(at.y).toBeCloseTo(2, 6)
    expect(at.z).toBeCloseTo(5 - 1, 6)
    // scaled and yawed a quarter turn: the 1 m reach becomes 2 m, along the host's turned +X
    const turned = restLinkWorld(host({ rotationY: Math.PI / 2, params: { pose: [[0]], scale: 2 } as never }), 'flange')!
    expect(turned.y).toBeCloseTo(4, 6)
    expect(Math.hypot(turned.x - 10, turned.z - 5)).toBeCloseTo(2, 6)
    expect(restLinkWorld(host(), 'nope')).toBeNull()
  })
})
