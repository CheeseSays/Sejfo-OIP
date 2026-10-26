// The product flow through the running line: cargo spawned and despawned by parts (ctx.spawn / ctx.despawn, the line
// completions measurements() counts), the product state behaviors put on it (ctx.mark / dress / join), and authored
// unit loads seeded at the first step. It works on the cargo through the registry and finds each part's zones in the
// sensor registry. SimWorld owns one; tickBehaviors hands it each behavior's requests in call order.
import { CARGO_CAP_LOAD_BASE, CARGO_KIND_BOX, CARGO_KIND_PALLET, CARGO_KIND_TOTE, DEFAULT_DRESS_OPACITY, cargoRefKey, kindSpawnRef, cargoFriction, cargoView, partChildren, unitMembers, unitStart } from '../core/frame'
import type { FrameDressing } from '../core/frame'
import { fitLoad, wrapAnchor } from '../core/cargoWrap'
import type { WrapBody } from '../core/cargoWrap'
import type { CargoMarkValue } from '../core/parts/partPackage'
import { isCargoPackage } from '../core/parts/partPackage'
import { reportPartDiagnostic } from '../core/parts/partDiagnostics'
import { getPackage } from '../core/parts/partRegistry'
import { hexToRgb } from '../core/math'
import type { PartInstance } from '../core/types'
import { BOX_FRICTION, BOX_MASS, PALLET_FRICTION, TOTE_FRICTION, TOTE_MASS } from '../core/types'
import { palletFootprint } from '../core/pallet'
import { toteSizeOf } from '../core/tote'
import type { BodyHolds } from './bodyHolds'
import { filmWeb, loadInZone, markPiece, packageMaterialColor, rowsInZone } from './cargoLoads'
import type { CargoRegistry } from './cargoRegistry'
import { pointInZone } from './cargoSensing'
import type { ZoneBox } from './cargoSensing'
import type { CargoOp, ReformReq } from './embeddedBehavior'
import type { SensorRegistry } from './sensorRegistry'
import type { BehaviorRecord, LiveBox, PartGroup, RigInstance, StepClock } from './worldTypes'

/** one ctx.spawn request as the behavior runtime hands it over (embeddedBehavior.ts SpawnReq) */
export interface SpawnRequest {
  part?: string
  params?: Record<string, number | boolean | string>
  kind?: 'box' | 'pallet' | 'tote'
  size?: [number, number, number]
  color?: [number, number, number]
  mass?: number
  offset?: [number, number, number]
  /** facts the item starts with (ctx.spawn `marks`) */
  marks?: Record<string, CargoMarkValue>
}

export class CargoFlow {
  /** authored unit loads still to be joined / marked / dressed: at the first step, once every body exists */
  private unitsPending = true
  /** unit loads rebuilt mid-run (an edit while running), to be seeded again at the next step */
  private readonly unitsRebuilt = new Set<string>()
  /** where each wrapping behavior's film roll stood last tick (world x/z), which says which way it is travelling */
  private readonly webRollPrev = new Map<BehaviorRecord, [number, number]>()
  /** line completions (items removed by a despawner) and their summed cycle time, for measurements() */
  private completedCount = 0
  private totalCycleSeconds = 0

  /**
   * `boxes` is the registry's cargo list; `holds` says which cargo a person carries (never despawned); `sensors`
   * holds each part's zones; `rigs` are the running rigs a film web hangs from; `partGroups` names the package a
   * behavior's part came from; `clock` + `hz` give the sim time of a completion or a mark.
   */
  constructor(
    private readonly cargo: CargoRegistry,
    private readonly boxes: readonly LiveBox[],
    private readonly holds: BodyHolds,
    private readonly sensors: SensorRegistry,
    private readonly rigs: readonly RigInstance[],
    private readonly partGroups: ReadonlyMap<string, PartGroup>,
    private readonly dressings: ReadonlyMap<number, ReadonlyMap<string, FrameDressing>>,
    private readonly clock: StepClock,
    private readonly hz: number,
  ) {}

  /** line completions so far (measurements' completedTotal) */
  get completed(): number {
    return this.completedCount
  }

  /** their summed cycle time, s */
  get cycleSeconds(): number {
    return this.totalCycleSeconds
  }

  /** whether authored unit loads wait to be seeded at this step (the first one, or after a mid-run rebuild) */
  get seedDue(): boolean {
    return this.unitsPending || this.unitsRebuilt.size > 0
  }

  /** a unit-load part rebuilt mid-run: seed it again at the next step (before the first, everything is pending) */
  noteUnitRebuilt(partId: string): void {
    if (!this.unitsPending) this.unitsRebuilt.add(partId)
  }

  // C-despawn: remove the cargo inside each requested zone (a sink). Each removal counts as a line completion.
  fulfillDespawns(b: BehaviorRecord, names: string[]): void {
    const zones = b.partId ? this.sensors.zonesOf(b.partId) : undefined
    if (!zones) return
    const set = new Set(names)
    for (const z of zones) {
      if (!set.has(z.name)) continue
      // fetch per zone pass: a removal below bumps boxesRev, so the next zone re-snapshots rather than
      // reading shifted rows. Within one pass the downward iteration keeps row i aligned with boxes[i]
      // across removals (splice leaves lower indices untouched - same pattern as the cull loop).
      const snap = this.cargo.beamSnapshot()
      for (let i = this.boxes.length - 1; i >= 0; i--) {
        const box = this.boxes[i]
        if (!box || this.holds.personHeld(box)) continue
        let inZone: boolean
        if (snap) {
          const o = i * 7
          inZone = pointInZone(z, snap[o] as number, snap[o + 1] as number, snap[o + 2] as number)
        } else {
          const p = box.body.GetPosition()
          inZone = pointInZone(z, p.GetX(), p.GetY(), p.GetZ())
        }
        if (inZone) {
          this.completedCount++
          this.totalCycleSeconds += this.clock.step / this.hz - box.spawnTime
          this.cargo.removeBox(i)
        }
      }
    }
  }

  /** leave marks on a piece (cargoLoads markPiece); a mark refused for its declared kind is reported at this step */
  private markPiece(box: LiveBox, marks: Readonly<Record<string, CargoMarkValue>>, by?: BehaviorRecord): void {
    markPiece(box, marks, by, this.clock.step / this.hz)
  }

  /** the package a behavior's part was placed from (its scene part's packageId; else the record's own key) */
  private packageIdOf(b: BehaviorRecord): string | null {
    const part = b.partId ? this.partGroups.get(b.partId)?.sigPart : undefined
    const id = (part as { packageId?: unknown } | undefined)?.packageId
    return typeof id === 'string' ? id : b.key
  }

  // Authored unit loads (a part whose package declares `unit`), once every authored body stands where it was placed:
  // each is exactly its cargo children (no inference), anchored on its lowest pallet, dressed as the stopped view
  // drew it (core/frame unitDressings), then joined and marked with its attributes as its params say.
  seedAuthoredUnits(parts: readonly PartInstance[]): void {
    const only = this.unitsPending ? null : new Set(this.unitsRebuilt)
    this.unitsPending = false
    this.unitsRebuilt.clear()
    const rowOf = new Map<string, number>()
    const ownRows = new Map<string, number[]>()
    this.boxes.forEach((b, i) => {
      if (b.partId) rowOf.set(b.partId, i)
      if (b.ownerId) {
        let list = ownRows.get(b.ownerId)
        if (!list) ownRows.set(b.ownerId, (list = []))
        list.push(i)
      }
    })
    const bodies = this.cargo.wrapBodies()
    const kids = partChildren(parts)
    const joins: { rows: number[]; start: NonNullable<ReturnType<typeof unitStart>>; partId: string }[] = []
    for (const part of parts) {
      if (only && !only.has(part.id)) continue
      const start = unitStart(part)
      if (!start) continue
      // its filed cargo, else the pieces it stacked itself (unitPieces)
      let member = unitMembers(parts, part.id, kids).map((m) => rowOf.get(m.id)).filter((i): i is number => i !== undefined)
      if (member.length === 0) member = ownRows.get(part.id) ?? []
      // a load already joined (a mid-run rebuild of something else) is left as it is
      if (member.length === 0 || member.some((i) => this.boxes[i]!.unit)) continue
      const a = wrapAnchor(member.map((i) => ({ index: i, y: bodies[i]!.pos[1], pallet: (this.boxes[i]!.caps & CARGO_CAP_LOAD_BASE) !== 0 })))
      const rows = [a, ...member.filter((i) => i !== a)]
      const anchor = this.boxes[a]!
      const box = fitLoad(a, rows, bodies, (anchor.caps & CARGO_CAP_LOAD_BASE) !== 0)
      for (const d of start.dress) this.cargo.setDressing({ anchor: anchor.id, id: d.id, min: [...box.min], max: [...box.max], color: [...d.color], opacity: d.opacity })
      if (start.join && rows.length > 1) joins.push({ rows, start, partId: part.id })
      else for (const r of rows) this.markPiece(this.boxes[r]!, start.marks)
    }
    // joined last: a join re-bodies the pieces, and every fit above read the loose bodies' poses
    for (const j of joins) {
      const unit = this.cargo.joinRows(j.rows)
      if (unit) {
        Object.assign(unit.marks, j.start.marks)
        unit.attrTypes = j.start.types
        unit.partId = j.partId
      } else for (const r of j.rows) this.markPiece(this.boxes[r]!, j.start.marks)
    }
  }

  // ctx.mark / dress / join: each on the cargo in a named zone of the calling part, in call order. ctx.markHit: on the
  // body a beam of the part hit this step.
  fulfillCargoOps(b: BehaviorRecord, ops: CargoOp[]): void {
    const zones = b.partId ? this.sensors.zonesOf(b.partId) : undefined
    for (const op of ops) {
      if (op.op === 'markHit') {
        const box = b.beamBoxes?.[op.beam]
        if (box) this.markPiece(box, { [op.key]: op.value }, b)
        continue
      }
      if (op.op === 'reformHit') {
        const box = b.beamBoxes?.[op.beam]
        const at = box ? this.boxes.indexOf(box) : -1
        if (box && at >= 0) this.reformBoxes(b, [{ box, pose: this.cargo.wrapBodies()[at]! }], op)
        continue
      }
      const z = zones?.find((zz) => zz.name === op.zone)
      if (!z) continue
      const bodies = this.cargo.wrapBodies() // fresh per op: a join or split re-bodies the pieces
      if (op.op === 'mark') {
        for (const i of rowsInZone(z, bodies)) this.markPiece(this.boxes[i]!, { [op.key]: op.value }, b)
      } else if (op.op === 'dress') {
        this.dressLoad(b, z, op, bodies)
      } else if (op.op === 'join') {
        const load = loadInZone(z, bodies, this.boxes)
        if (load && load.rows.length > 1) this.cargo.joinRows(load.rows)
      } else if (op.op === 'reform') {
        this.reformInZone(b, z, op, bodies)
      }
    }
  }

  // ctx.dress: fit the dressing to the load in the zone and grow it up to the requested height. It never shrinks,
  // so a film carriage coming back down on a second pass leaves it as it is.
  private dressLoad(
    b: BehaviorRecord,
    z: ZoneBox,
    op: Extract<CargoOp, { op: 'dress' }>,
    bodies: WrapBody[],
  ): void {
    const load = loadInZone(z, bodies, this.boxes)
    if (!load || !load.box) return
    const a = load.rows[0]!
    const anchor = this.boxes[a]!
    const fit = load.box
    // the requested height, in the anchor's frame (a load on a conveyor stands level, so height is height)
    const top = op.upTo === undefined ? fit.max[1] : Math.min(fit.max[1], b.pos[1] + op.upTo - bodies[a]!.pos[1])
    const have = this.dressings.get(anchor.id)?.get(op.id)
    if (top <= fit.min[1] && !have) return
    const next: FrameDressing = {
      anchor: anchor.id,
      id: op.id,
      min: [...fit.min],
      max: [fit.max[0], Math.max(top, have?.max[1] ?? -Infinity), fit.max[2]],
      color: packageMaterialColor(this.packageIdOf(b), op.material),
      opacity: op.opacity ?? DEFAULT_DRESS_OPACITY,
    }
    if (have) {
      for (const k of [0, 2] as const) {
        next.min[k] = Math.min(next.min[k], have.min[k])
        next.max[k] = Math.max(next.max[k], have.max[k])
      }
    }
    if (op.web) {
      const web = filmWeb(this.rigs, this.webRollPrev, b, op.web, bodies[a]!, next)
      if (web) next.web = web
    }
    this.cargo.setDressing(next)
  }

  // ctx.reform / reformHit: each loose body (in the zone, or the one a beam hit) is remade as the product, where it
  // stands. The new body sits on the same bottom face with the same heading and speed and carries the old one's marks,
  // age and dressings, and the old one goes without a completion, so the line counts one item throughout. A piece of a
  // unit load stays, and so does a body a person holds.
  private reformInZone(
    b: BehaviorRecord,
    z: ZoneBox,
    op: Extract<CargoOp, { op: 'reform' }>,
    bodies: WrapBody[],
  ): void {
    this.reformBoxes(b, rowsInZone(z, bodies).map((i) => ({ box: this.boxes[i]!, pose: bodies[i]! })), op)
  }

  private reformBoxes(
    b: BehaviorRecord,
    olds: { box: LiveBox; pose: WrapBody }[],
    op: ReformReq,
  ): void {
    for (const { box: old, pose } of olds) {
      if (old.unit) continue
      // a body a gripper holds is remade in the gripper's hand, so a robot can carry a case through its changes;
      // one the pilot or a pin holds is left alone
      const holder = this.holds.holders.get(old.id)
      if (holder && holder.kind !== 'grip') continue
      if (op.from !== undefined && old.product !== op.from) continue
      // the same product keeps the params, colour and mass it was made with, under the ones asked for
      const ref = old.shapeKey !== undefined ? this.cargo.shapeRefs.get(old.shapeKey) : undefined
      const same = old.product === op.part
      const request: SpawnRequest = { part: op.part, params: { ...((same ? ref?.params : undefined) as SpawnRequest['params']), ...op.params } }
      if (same) {
        request.color = old.color
        request.mass = old.mass
      }
      // a loose body keeps its bottom face on what it stands on; a held one keeps its centre, where the gripper has it
      const born = this.makeProduct(b, request, pose.pos[0], holder ? pose.pos[1] : 0, pose.pos[2], pose.quat, holder ? undefined : (view) => pose.pos[1] - old.hy + view.halfExtents[1])
      if (!born) return
      born.spawnTime = old.spawnTime
      if (old.marks) born.marks = { ...old.marks, ...(born.marks ?? {}) }
      if (old.attrTypes) born.attrTypes = { ...old.attrTypes, ...(born.attrTypes ?? {}) }
      if (op.marks) this.markPiece(born, op.marks, b)
      if (!holder) this.cargo.carryMotion(old, born)
      const dressed = this.dressings.get(old.id)
      if (dressed) for (const d of dressed.values()) this.cargo.setDressing({ ...d, anchor: born.id })
      const grips = holder?.kind === 'grip' ? holder.rig?.grips.get(holder.gripper) : undefined
      const entry = grips?.find((h) => h.bodyId === old.id)
      const at = this.boxes.indexOf(old)
      if (at >= 0) this.cargo.removeBox(at)
      if (holder) {
        // the new body takes the old one's place in the hand, at the same offset from the gripper
        this.holds.claim(born, holder)
        if (holder.kind === 'grip' && holder.rig && entry) holder.rig.grips.set(holder.gripper, [...(holder.rig.grips.get(holder.gripper) ?? []), { ...entry, bodyId: born.id }])
      }
    }
  }

  // C-spawn: create a dynamic cargo body per request at the part's world pose + its yaw-rotated local offset.
  // `part` makes that product (spawnProduct); without it, `kind:'pallet'` makes a pallet (its footprint from `size`,
  // snapped to a standard one; its own friction/kind), `kind:'tote'` a tote (its size snapped to a standard one); else
  // a box.
  fulfillSpawns(b: BehaviorRecord, spawns: SpawnRequest[]): void {
    const fx = b.fwd[0]
    const fz = b.fwd[2] // part yaw from forward = [cosθ, 0, -sinθ]
    const yaw = Math.atan2(-fz, fx)
    for (const s of spawns) {
      const off = s.offset ?? [0, 0, 0]
      const wx = b.pos[0] + off[0] * fx - off[2] * fz
      const wy = b.pos[1] + off[1]
      const wz = b.pos[2] + off[0] * fz + off[2] * fx
      const before = this.boxes.length
      if (s.part !== undefined) {
        this.spawnProduct(b, s, wx, wy, wz, yaw)
      } else if (s.kind === 'pallet') {
        const sz = palletFootprint(s.size)
        // no colour = untinted, like the box branch below and like an authored oip.pallet. The tint
        // multiplies the pallet wood model, so a brown default would make an uncoloured spawn darker
        // than every hand-placed pallet next to it.
        this.cargo.createDynamicBox(wx, wy, wz, sz[0] / 2, sz[1] / 2, sz[2] / 2, yaw, s.mass ?? 25, PALLET_FRICTION, CARGO_KIND_PALLET, null, s.color ?? [1, 1, 1], kindOwn(CARGO_KIND_PALLET, sz))
      } else if (s.kind === 'tote') {
        const sz = toteSizeOf(s.size)
        this.cargo.createDynamicBox(wx, wy, wz, sz[0] / 2, sz[1] / 2, sz[2] / 2, yaw, s.mass ?? TOTE_MASS, TOTE_FRICTION, CARGO_KIND_TOTE, null, s.color ?? [1, 1, 1], kindOwn(CARGO_KIND_TOTE, sz))
      } else {
        const size = s.size ?? [0.6, 0.4, 0.4]
        this.cargo.createDynamicBox(wx, wy, wz, size[0] / 2, size[1] / 2, size[2] / 2, yaw, s.mass ?? BOX_MASS, BOX_FRICTION, CARGO_KIND_BOX, null, s.color ?? [1, 1, 1], kindOwn(CARGO_KIND_BOX, size)) // (SimWorld.spawnBoxAt's defaults)
      }
      // the facts it starts with, over the attributes a product starts with (and checked against their types)
      const born = this.boxes.length > before ? this.boxes[this.boxes.length - 1] : undefined
      if (born && s.marks) this.markPiece(born, s.marks, b)
    }
  }

  /**
   * One spawn of a product (`ctx.spawn({ part })`): the body that part would be if placed here, from its definition
   * through core/frame cargoView (size, mass, colour, kind and its friction, product attributes as marks), with the
   * request's `params` over the part's own (only params it declares, of their declared type) and its `color` and
   * `mass` over those. Anything that is not a cargo part in this run spawns nothing and is reported on the spawner.
   */
  private spawnProduct(b: BehaviorRecord, s: SpawnRequest, x: number, y: number, z: number, yaw: number): void {
    this.makeProduct(b, s, x, y, z, yaw)
  }

  /**
   * The body of a product made at (x, y, z), for a spawn and for a reform. `rest`, when given, says the height from the
   * product's own size (a reform keeps the bottom face where it was). Null when it is refused.
   */
  private makeProduct(
    b: BehaviorRecord,
    s: SpawnRequest,
    x: number,
    y: number,
    z: number,
    rotation: number | [number, number, number, number],
    rest?: (view: NonNullable<ReturnType<typeof cargoView>>) => number,
  ): LiveBox | undefined {
    const pkg = getPackage(s.part!)
    const refuse = (why: string): undefined => {
      if (b.partId) reportPartDiagnostic({ source: 'step', partId: b.partId, message: `spawn of '${s.part}' skipped: ${why}`, simTime: this.clock.step / this.hz })
      return undefined
    }
    if (!pkg) return refuse('no such part in this project')
    if (pkg.unit) return refuse('a unit load cannot be spawned yet')
    if (!isCargoPackage(pkg)) return refuse('it is not cargo')
    const params: Record<string, number | boolean | string> = {}
    for (const [k, v] of Object.entries(s.params ?? {})) {
      const t = pkg.params[k]?.type
      const want = t === 'number' ? 'number' : t === 'boolean' ? 'boolean' : t === 'string' || t === 'enum' || t === 'color' ? 'string' : null
      if (want !== null && typeof v === want) params[k] = v
    }
    const yaw = typeof rotation === 'number' ? rotation : 0
    const view = cargoView({ id: '', type: 'part', packageId: pkg.id, position: [x, y, z], rotationY: yaw, params } as PartInstance)
    if (!view) return refuse('it is not cargo')
    const [hx, hy, hz] = view.halfExtents
    const color = s.color ?? hexToRgb(view.color)
    // a part with its own body spawns as its own shape (core/cargoBody.ts), with the friction it declares
    const own = view.body ? { key: view.body.key, pieces: view.body.pieces, product: pkg.id, params: view.body.params } : { key: cargoRefKey(pkg.id, params), product: pkg.id, params }
    const id = this.cargo.createDynamicBox(x, rest ? rest(view) : y, z, hx, hy, hz, rotation, s.mass ?? view.mass, view.body?.friction ?? cargoFriction(view.kind), view.kind, null, color, own, view.caps)
    const born = id >= 0 ? this.boxes[this.boxes.length - 1] : undefined
    if (!born) return undefined
    born.product = pkg.id
    // a product starts its life carrying its authored attributes, as its marks, as a placed one does
    if (Object.keys(view.attributeTypes).length) {
      born.attrTypes = view.attributeTypes
      if (Object.keys(view.attributes).length) born.marks = { ...view.attributes }
    }
    return born
  }
}

/** what a kind-only spawn is, as createDynamicBox's `own` (core/frame.ts kindSpawnRef) */
function kindOwn(kind: number, size: readonly [number, number, number]): { key: string; product: string; params: Record<string, number | string> } {
  const ref = kindSpawnRef(kind, size)
  return { key: cargoRefKey(ref.packageId, ref.params), product: ref.packageId, params: ref.params as Record<string, number | string> }
}
