// Mounted tools in the view: a tool (a part whose package declares `geometry.mount`) hangs under the host rig's link group,
// so the host's joint poses carry it with no per-frame work (docs/part-mounts.md). The seam gives each tool its `mountedOn`
// (core/scene/sceneMounts.ts); this module keeps the tool's visual under that link as the host is built, rebuilt and moved.

import type { Group } from 'three'
import { markBundleDirtyPart, notifyBundleStructureChanged } from '../bundleGroups'
import type { Entry } from './viewTypes'
import type { RenderView } from './view'

/** the tools each host carries this sync, by host part id (tool part ids, in scene order) */
export class ViewMountState {
  readonly byHost = new Map<string, string[]>()
}

/** what the mount helpers read from the view */
export type MountHost = Pick<RenderView, 'entries' | 'lastResolved' | 'mounts' | 'partContainer' | 'syncMatrixFreeze'>

/** The host link group this part rides, or null when it rides nothing or its host is not built yet. */
export function mountLinkGroup(view: Pick<RenderView, 'entries' | 'lastResolved'>, partId: string): Group | null {
  const on = view.lastResolved?.get(partId)?.mountedOn
  if (!on) return null
  const link = view.entries.get(on.hostId)?.visual.object.userData.linkGroup as ((name: string) => Group | undefined) | undefined
  return link?.(on.link) ?? null
}

/** Rebuild the host to tools index from this sync's resolved scene. */
export function indexMounts(view: Pick<RenderView, 'lastResolved' | 'mounts'>): void {
  const by = view.mounts.byHost
  by.clear()
  if (!view.lastResolved) return
  for (const [id, ctx] of view.lastResolved) {
    if (!ctx.mountedOn) continue
    const list = by.get(ctx.mountedOn.hostId)
    if (list) list.push(id)
    else by.set(ctx.mountedOn.hostId, [id])
  }
}

/**
 * Put every tool's visual under its host link group. A host rebuild replaces the link groups, which leaves the tool
 * hanging off a group that is no longer in the scene, and a host built after its tool in the scene order has no
 * link group to offer when the tool is first placed. Returns whether any tool moved.
 */
export function rehomeMounts(view: MountHost): boolean {
  let moved = false
  for (const toolIds of view.mounts.byHost.values()) {
    for (const id of toolIds) {
      const entry = view.entries.get(id)
      if (!entry) continue
      const want = view.partContainer(entry.part)
      if (entry.visual.object.parent === want) continue
      want.add(entry.visual.object)
      view.syncMatrixFreeze(entry)
      entry.boundsDirty = true
      moved = true
    }
  }
  if (moved) notifyBundleStructureChanged()
  return moved
}

/** A moved host moves its tools' draws too, which a recorded bundle refreshes by part id. */
export function markMountedDirty(view: Pick<RenderView, 'mounts'>, hostId: string): void {
  const tools = view.mounts.byHost.get(hostId)
  if (tools) for (const id of tools) markBundleDirtyPart(id)
}

/** Whether this entry's visual hangs under a host link (so its bounds follow the host's pose, not its own sync). */
export function isMounted(entry: Entry): boolean {
  return entry.visual.object.userData.mountedOn === true
}
