import type { PartInstance, SdkPart } from '../types'
import { getPackage } from '../parts/partRegistry'
import { toWorldXZ } from '../parts/partGeometry'
import { resolvePartParams } from '../parts/partScript'
import type { ParamValue } from '../parts/partApi'
import type { PartPackage } from '../parts/partPackage'
import { idleJointValues, resolvedBoxSize, resolvedOffset, rigWorldPoses } from '../rig/rigPose'
import type { RigParams, Vec3 } from '../rig/rigPose'

/**
 * Mounts: a rig whose package declares `geometry.mount` (a tool) rides the link of the part it is soft-parented under
 * (docs/part-mounts.md). The host resolves it from the scene, like every other cross-part effect (docs/seam-resolvers.md):
 * the tool learns where it rides, and the host learns what is on its links.
 */

/** What a host knows about one tool riding it. The grip volume is already resolved against the tool's own params. */
export interface MountedTool {
  /** the tool's part id */
  id: string
  /** the host link it rides */
  link: string
  /** the volume this tool gives the host's gripper link `link`, in that link's frame */
  grip?: { link: string; zone: { size: Vec3; offset?: Vec3 } }
}

/** Where a tool rides: its host part and the host link. */
export interface MountedOn {
  hostId: string
  link: string
}

export interface SceneMounts {
  /** by host part id: its tools, in scene order */
  hosts: Map<string, MountedTool[]>
  /** by tool part id */
  tools: Map<string, MountedOn>
}

const EMPTY: SceneMounts = { hosts: new Map(), tools: new Map() }

/** the rig a part package draws, when it is one */
function rigOf(pkg: PartPackage | undefined): Extract<PartPackage['geometry'], { kind: 'rig' }> | null {
  return pkg && pkg.geometry.kind === 'rig' ? pkg.geometry : null
}

/** What a part's package declares it rides, when it is a tool (`geometry.mount`). */
function mountOf(part: PartInstance): { sdk: SdkPart; pkg: PartPackage; mount: NonNullable<Extract<PartPackage['geometry'], { kind: 'rig' }>['mount']> } | null {
  if (part.type !== 'part' || part.parent === undefined) return null
  const pkg = getPackage(part.packageId)
  const mount = rigOf(pkg)?.mount
  return mount ? { sdk: part, pkg: pkg!, mount } : null
}

/**
 * Every tool in the scene that is seated on a host: its parent is a part whose rig has the link it names. A tool
 * whose parent has no such link, or whose link already carries a tool earlier in the scene, is not seated and stays
 * where it was placed.
 */
export function computeSceneMounts(parts: readonly PartInstance[]): SceneMounts {
  let out: SceneMounts | null = null
  let byId: Map<string, PartInstance> | null = null
  for (const part of parts) {
    const m = mountOf(part)
    if (!m) continue
    byId ??= new Map(parts.map((p) => [p.id, p]))
    const host = byId.get(m.sdk.parent!)
    if (!host || host.type !== 'part' || host.id === part.id) continue
    const hostRig = rigOf(getPackage(host.packageId))
    // a tool carries no tool: its own frame link shares a name with the link it rides
    if (!hostRig || hostRig.mount || !hostRig.links.some((l) => l.name === m.mount.link)) continue
    out ??= { hosts: new Map(), tools: new Map() }
    const taken = out.hosts.get(host.id)
    if (taken?.some((t) => t.link === m.mount.link)) continue
    let tool: MountedTool = { id: part.id, link: m.mount.link }
    const grip = m.mount.grip
    if (grip) {
      const params = resolvePartParams(m.pkg.params, m.sdk.params as Record<string, ParamValue>) as unknown as RigParams
      const size = resolvedBoxSize(grip.zone.size, grip.zone.sizeParams, params)
      const offset = grip.zone.offset || grip.zone.offsetParams ? resolvedOffset(grip.zone.offset ?? [0, 0, 0], grip.zone.offsetParams, params) : undefined
      tool = { ...tool, grip: { link: grip.link, zone: { size, ...(offset ? { offset } : {}) } } }
    }
    if (taken) taken.push(tool)
    else out.hosts.set(host.id, [tool])
    out.tools.set(part.id, { hostId: host.id, link: m.mount.link })
  }
  return out ?? EMPTY
}

// The link poses of a host as it rests, kept per part snapshot (parts are immutable, so a drag over a host
// solves its forward kinematics once, not once per pointer move)
const restLinkPoses = new WeakMap<PartInstance, ReturnType<typeof rigWorldPoses>>()

/**
 * The world position of one link of a rig part at the pose it rests in (its idle `pose`), or null when it has no such
 * link. It is where a tool seats when it is placed, and where its stored position is written: while the part is
 * mounted the view follows the live link instead.
 */
export function restLinkWorld(host: PartInstance, link: string): { x: number; y: number; z: number } | null {
  if (host.type !== 'part') return null
  const pkg = getPackage(host.packageId)
  const geo = pkg?.geometry
  if (geo?.kind !== 'rig' || geo.mount || !geo.links.some((l) => l.name === link)) return null
  let poses = restLinkPoses.get(host)
  if (!poses) {
    // a placed part may leave a param at its default unwritten, and the idle pose is one
    const params = resolvePartParams(pkg!.params, host.params as Record<string, ParamValue>) as unknown as RigParams
    const scale = typeof params.scale === 'number' && params.scale > 0 ? params.scale : 1
    poses = rigWorldPoses(geo, idleJointValues(geo, params.pose), undefined, scale, params)
    restLinkPoses.set(host, poses)
  }
  const local = poses.get(link)
  if (!local) return null
  const xz = toWorldXZ(host, local.pos[0], local.pos[2])
  return { x: xz.x, y: host.position[1] + local.pos[1], z: xz.z }
}

/** The signature of what a host's tools do to it: changes only when a tool arrives, leaves, or changes its grip volume. */
export function hostMountsKey(tools: readonly MountedTool[] | undefined): string {
  return tools === undefined || tools.length === 0 ? '' : JSON.stringify(tools)
}

/** The signature of where a tool rides. */
export function toolMountKey(on: MountedOn | undefined): string {
  return on === undefined ? '' : `${on.hostId}/${on.link}`
}

/** Whether `part` is a tool seated on its host in `parts`: its pose is its host link's, so the editor does not transform it. */
export function isSeatedTool(parts: readonly PartInstance[], part: PartInstance): boolean {
  return mountOf(part) !== null && computeSceneMounts(parts).tools.has(part.id)
}

/** The tools in `parts` that are not seated: a tool with no parent, or whose parent has no link of the name it rides. */
export function unseatedTools(parts: readonly PartInstance[]): { part: SdkPart; link: string }[] {
  let seated: SceneMounts | null = null
  const out: { part: SdkPart; link: string }[] = []
  for (const part of parts) {
    if (part.type !== 'part') continue
    const mount = rigOf(getPackage(part.packageId))?.mount
    if (!mount) continue
    seated ??= computeSceneMounts(parts)
    if (!seated.tools.has(part.id)) out.push({ part, link: mount.link })
  }
  return out
}

/**
 * The host's rig as its tools change it: each tool's grip volume replaces the `grip` of the host link it names. The
 * volume is the tool's own, so it is not resized by the host's params (the host's `scale` still applies to it, as it
 * does to every grip volume).
 */
export function withMountedGrips<G extends Extract<PartPackage['geometry'], { kind: 'rig' }>>(geo: G, tools: readonly MountedTool[] | undefined): G {
  if (tools === undefined || tools.length === 0) return geo
  const grips = new Map<string, NonNullable<MountedTool['grip']>['zone']>()
  for (const t of tools) if (t.grip) grips.set(t.grip.link, t.grip.zone)
  if (grips.size === 0) return geo
  return { ...geo, links: geo.links.map((l) => (grips.has(l.name) ? { ...l, grip: { ...l.grip, zone: grips.get(l.name)! } } : l)) }
}
