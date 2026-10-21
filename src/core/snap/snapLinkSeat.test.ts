import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearPackages, registerPackage } from '../parts/partRegistry'
import { PACKAGE_FORMAT } from '../parts/partPackage'
import type { PartPackage } from '../parts/partPackage'
import type { PartInstance, SdkPart } from '../types'
import { findSnap } from './snapFeatures'
import { commitSnap } from './snapCommit'

// A tool seats on the link its package names (`geometry.mount`), at the pose the host rests in, and the commit
// soft-parents it under the host: that parent is what makes it ride the link (core/scene/sceneMounts.ts).

const hostPkg = (): PartPackage =>
  ({
    format: PACKAGE_FORMAT,
    id: 'acme.arm',
    name: 'Acme Arm',
    params: { pose: { type: 'numberList', arity: 1, default: [[0]] } },
    behavior: 'definePart({ joints:["j1"], step(){} })',
    geometry: {
      kind: 'rig',
      links: [
        { name: 'boom', shape: { kind: 'frame' }, offset: [0, 0, 0] },
        { name: 'flange', parent: 'boom', shape: { kind: 'frame' }, offset: [1, 2, 0] },
      ],
      joints: [{ name: 'j1', link: 'boom', type: 'revolute', axis: [0, 1, 0], min: -Math.PI, max: Math.PI }],
      bounds: { length: 2, width: 1, top: 3 },
    },
  }) as unknown as PartPackage

const toolPkg = (): PartPackage =>
  ({
    format: PACKAGE_FORMAT,
    id: 'acme.plate',
    name: 'Acme Plate',
    params: {},
    behavior: 'definePart({ step(){} })',
    geometry: {
      kind: 'rig',
      links: [{ name: 'face', shape: { kind: 'frame' }, offset: [0, 0, 0] }],
      joints: [],
      mount: { link: 'flange' },
      bounds: { length: 0.5, width: 0.5, top: 0, bottom: -0.15 },
    },
  }) as unknown as PartPackage

const arm = (over: Partial<SdkPart> = {}): SdkPart =>
  ({ id: 'arm', type: 'part', packageId: 'acme.arm', position: [10, 0, 5], rotationY: 0, params: { pose: [[0]] }, ...over }) as unknown as SdkPart
const plate = (position: [number, number, number]): SdkPart =>
  ({ id: 'plate', type: 'part', packageId: 'acme.plate', position, rotationY: 0, params: {} }) as unknown as SdkPart

describe('a tool seats on a host link', () => {
  beforeEach(() => {
    registerPackage(hostPkg())
    registerPackage(toolPkg())
  })
  afterEach(() => clearPackages())

  it('goes to the link at the pose the host rests in', () => {
    const moving = plate([11.1, 0, 5.1])
    const c = findSnap(moving, { position: [11.1, 0, 5.1], rotationY: 0 }, [arm()])!
    expect(c.targetId).toBe('arm')
    expect(c.via).toBe('mount -> link:flange')
    expect(c.pose.position[0]).toBeCloseTo(11, 6)
    expect(c.pose.position[1]).toBeCloseTo(2, 6)
    expect(c.pose.position[2]).toBeCloseTo(5, 6)
    expect(c.attach).toBe(true)
    // the host's idle pose moves the seat: 90° about Y swings the flange from +X to -Z
    const swung = findSnap(moving, { position: [10, 0, 4], rotationY: 0 }, [arm({ params: { pose: [[90]] } as never })])!
    expect(swung.pose.position[0]).toBeCloseTo(10, 6)
    expect(swung.pose.position[2]).toBeCloseTo(4, 6)
  })

  it('soft-parents the tool under the host when committed', () => {
    const moving = plate([11.1, 0, 5.1])
    const parts: PartInstance[] = [arm(), moving]
    const c = findSnap(moving, { position: [11.1, 0, 5.1], rotationY: 0 }, parts)!
    const after = commitSnap(parts, 'plate', c)
    const tool = after.find((p) => p.id === 'plate')!
    expect(tool.parent).toBe('arm')
    expect(tool.position[1]).toBeCloseTo(2, 6)
  })

  it('seats only close to the link in plan, and not by being dropped over the host', () => {
    // the flange stands at (11, 2, 5) in plan: a drop 0.4 m from it seats, 0.6 m from it does not
    const near = findSnap(plate([11.4, 0, 5]), { position: [11.4, 0, 5], rotationY: 0 }, [arm()])
    expect(near?.via).toBe('mount -> link:flange')
    expect(findSnap(plate([11.6, 0, 5]), { position: [11.6, 0, 5], rotationY: 0 }, [arm()])).toBeNull()
    // over the host's footprint but away from the flange: no seat
    expect(findSnap(plate([9.4, 0, 5]), { position: [9.4, 0, 5], rotationY: 0 }, [arm()])).toBeNull()
    expect(findSnap(plate([0, 0, 0]), { position: [0, 0, 0], rotationY: 0 }, [arm()])).toBeNull()
  })

  it('does not seat on a link that already has a tool, but a seated tool can be re-seated on its own link', () => {
    const first = { ...plate([11, 2, 5]), id: 'first', parent: 'arm' } as SdkPart
    const second = { ...plate([11, 0, 5]), id: 'second' } as SdkPart
    expect(findSnap(second, { position: [11, 0, 5], rotationY: 0 }, [arm(), first, second])).toBeNull()
    const again = findSnap(first, { position: [11, 0, 5], rotationY: 0 }, [arm(), first, second])
    expect(again?.targetId).toBe('arm')
  })

  it('does not seat on another tool, even one whose own frame has the name of the link it rides', () => {
    registerPackage({ ...toolPkg(), id: 'acme.plate2', geometry: { ...(toolPkg().geometry as object), links: [{ name: 'flange', shape: { kind: 'frame' }, offset: [0, 0, 0] }] } } as PartPackage)
    const other = { ...plate([3, 2, 3]), id: 'other', packageId: 'acme.plate2' } as SdkPart
    expect(findSnap(plate([3, 0, 3]), { position: [3, 0, 3], rotationY: 0 }, [other])).toBeNull()
  })

  it('does not seat on a host without the link', () => {
    const noLink: SdkPart = { ...arm({ id: 'other', packageId: 'acme.plate' }) }
    expect(findSnap(plate([10, 0, 5]), { position: [10, 0, 5], rotationY: 0 }, [noLink])).toBeNull()
  })
})
