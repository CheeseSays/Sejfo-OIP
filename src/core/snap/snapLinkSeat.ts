import { SNAP_HEIGHT_COST_WEIGHT } from '../types'
import type { PartInstance } from '../types'
import type { RigMount } from '../parts/partPackage'
import { restLinkWorld } from '../scene/sceneMounts'
import type { SnapCandidate, SnapPose } from './snapFeatures'

/** how far (m, in plan) a tool dragged beside a host's link still seats on it */
const LINK_SEAT_REACH = 0.5

/**
 * A tool seats on a link of the host's rig (`geometry.mount`): its origin goes to that link at the pose the host rests
 * in, and the commit soft-parents it under the host, which is what makes it ride the link (docs/part-mounts.md). The
 * seat is where the drag is, in plan: a flange is metres above the floor, so the height of the drag does not gate it.
 * A link that already carries a tool takes no second one.
 */
export function snapLinkSeat(moving: PartInstance, proposed: SnapPose, target: PartInstance, mount: RigMount, occupied: ReadonlySet<string> | undefined): SnapCandidate | null {
  if (target.type !== 'part') return null
  if (occupied?.has(`${target.id}/${mount.link}`)) return null
  const at = restLinkWorld(target, mount.link)
  if (!at) return null
  const plan = Math.hypot(proposed.position[0] - at.x, proposed.position[2] - at.z)
  if (plan > LINK_SEAT_REACH) return null
  return {
    pose: { position: [at.x, at.y, at.z], rotationY: target.rotationY },
    targetId: target.id,
    cost: plan + SNAP_HEIGHT_COST_WEIGHT * Math.abs(proposed.position[1] - at.y),
    junction: { x: at.x, y: at.y, z: at.z },
    attach: true,
  }
}
