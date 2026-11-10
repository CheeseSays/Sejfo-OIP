// Delta Robot: a three-arm parallel pick-and-place robot, driven the way a real robot cell's PLC drives one, with the
// same job logic as the Six-Axis Robot. The robot owns its JOBS: short programs of steps (move to a waypoint, vacuum
// on or off, wait, wait for an input, set an output) that the author teaches in the Inspector. The PLC picks a job by
// number on the command tag, raises Execute, and waits for Done; the robot runs the whole job itself, and signals back
// on its outputs. A robot with NO jobs falls back to single moves: the command is a waypoint row, Execute moves there,
// the vacuum tag drives the gripper. With no tags named the robot holds its authored idle pose and does nothing.
//
// A waypoint is a PLACE, not a set of joint angles: x and y across the work area and z the lowering, in metres from
// the home point (the platform's centre with the robot at rest). A move is a straight line between two places, run
// as one trapezoidal profile (speed in m/s, acceleration in m/s^2), and a via point blends the corner by overlapping
// two moves, as the Six-Axis Robot does in joint space.
//
// The rig carries the kinematics. The platform rides three prismatic joints (x, y, z) and never tilts; the three arm
// joints are solved from the platform's place by the rig itself (`geometry.delta`, core/rig/rigPose.ts), so the arms
// follow the platform in a run, in the editor's pose gizmo and in the idle pose, with nothing here to keep in step.
// The behavior commands only x, y and z. The proxy model is built from primitives; a real model replaces its
// meshes and keeps the links, joints and `delta` numbers (README.md).
//
// The tool is not part of the robot: a Vacuum Tool (or any tool part) seats on the 'eoat' frame under the platform
// and rides it, and gives the 'gripper' link its pickup volume. The robot draws only a status lamp on the platform.
//
// This is the part's source. `npm run build-parts` writes behavior.ts (this script as the app ships it, with the
// _shared/ modules it imports joined in and `manifest` / `rig()` left out) and rig.json (the manifest, with the
// rig compiled from rig()).

// The work area: a box the arms reach with room to spare (the solver tests sweep it). Travel in metres.
const TRAVEL_X = 0.55
const TRAVEL_Y = 0.55
const TRAVEL_Z = 0.45 // lowering from home

// Overridden from the Inspector by the 'waypoints' param (its numberList grid, or captured by the editor's rig
// gizmo), which arrives already parsed + validated as number[][].
const DEFAULT_POSES = [
  [0, 0, 0], // 0 home
  [-0.2, 0, 0.3], // 1 pick
  [0.2, 0, 0.3], // 2 place
]
const POSE_COLUMNS = ['X m', 'Y m', 'Z m (down)']
const LIMIT_LO = [-TRAVEL_X, -TRAVEL_Y, 0]
const LIMIT_HI = [TRAVEL_X, TRAVEL_Y, TRAVEL_Z]

const link = (name, parent, shape, offset, extra) => ({ name, ...(parent ? { parent } : {}), shape, offset, ...extra })
const box = (name, parent, size, offset, color, extra) => link(name, parent, { kind: 'box', size }, offset, { color, collision: 'none', ...extra })

// The job step vocabulary. A step is the row [job, op, a, b]; the Inspector writes them from this declaration.
const MOVE = 1
const VACUUM = 2
const WAIT = 3
const WAIT_FOR = 4
const SET_OUT = 5
const IO_COUNT = 4
const ON_OFF = [{ value: 1, label: 'On' }, { value: 0, label: 'Off' }]
const ioOptions = (word, prefix) => Array.from({ length: IO_COUNT }, (_, i) => ({ value: i, label: word + ' ' + (i + 1), param: prefix + (i + 1) + 'Tag' }))
const JOB_OPS = [
  { code: MOVE, label: 'Move', desc: 'Move the platform to a waypoint in a straight line. Stop arrives exactly and stands still; Blend rounds the corner and carries on into the next move, for places that are only on the way somewhere.', args: [{ kind: 'row', of: 'waypoints', label: 'To' }, { kind: 'choice', label: 'Corner', options: [{ value: 0, label: 'Stop' }, { value: 1, label: 'Blend' }] }] },
  { code: VACUUM, label: 'Vacuum', desc: 'Switch the tool vacuum. The load is held from the step it goes on to the step it goes off.', args: [{ kind: 'choice', options: ON_OFF }] },
  { code: WAIT, label: 'Wait', desc: 'Stand still for a time, to let a grip seal or a load settle. The clock stops while the robot is not enabled.', args: [{ kind: 'number', unit: 's', min: 0, step: 0.1, default: 0.5 }] },
  { code: WAIT_FOR, label: 'Wait for', desc: 'Hold here until one of the robot inputs reads on (or off). This is how a job waits on the cell: a pallet in place, a zone clear.', args: [{ kind: 'choice', options: ioOptions('Input', 'in') }, { kind: 'choice', options: ON_OFF }] },
  { code: SET_OUT, label: 'Set', desc: 'Switch one of the robot outputs, to tell the PLC something the job has reached: clear of the table, load released.', args: [{ kind: 'choice', options: ioOptions('Output', 'out') }, { kind: 'choice', options: ON_OFF }] },
]
const splitNames = (s) => (typeof s === 'string' && s !== '' ? s.split('\n') : [])
// how many jobs there are: every one a step belongs to, and every one that has a name
const jobCount = (rows, names) => rows.reduce((n, r) => Math.max(n, r[0] + 1), splitNames(names).length)

let cur = DEFAULT_POSES[0].slice() // where the platform is (m)
let moving = false
let gripClosed = false
const outputs = [false, false, false, false]
// One move: its start place, the signed distance on each axis, the length of the line (m), progress along it and the
// path speed (m/s). One scalar drives all three axes (a straight line, never a per-axis jitter), so they start and
// arrive together.
const segment = (start) => ({ from: start.slice(), span: [0, 0, 0], len: 0, prog: 0, vel: 0 })
let seg = segment(DEFAULT_POSES[0])
// Moves still finishing UNDER the active one: a via-point move that handed off early runs on to its own stop while the
// next move ramps up from that place, and the platform is put at the sum of the two (see step).
let tails = []
// Trapezoidal profile of one move: accel-limited, capped at vMax, and always able to brake to a stop at its end.
// vStop is that braking limit counted in whole ticks: the continuous sqrt(2*a*remain) ignores the distance the tick
// itself covers, so the platform reached the place still moving and stopped dead on the last tick.
const advance = (s, vMax, accel, dt, approach) => {
  const h = (accel * dt) / 2
  const vStop = Math.sqrt(h * h + 2 * accel * Math.max(s.len - s.prog, 0)) - h
  s.vel = approach(s.vel, Math.min(vMax, vStop), accel * dt)
  s.prog += s.vel * dt
  if (s.prog >= s.len) { s.prog = s.len; s.vel = 0 }
}
const fraction = (s) => (s.len > 1e-9 ? s.prog / s.len : 1)
// Start a move to `tgt`, planned from where the previous move ENDS, not from where the platform is: if that move is
// still running it becomes a tail, and covers the difference. A place outside the work area parks at its edge on that
// axis (the host clamps the drawn slide anyway, so planning past it would time out a travel that cannot be made).
const startMove = (tgt) => {
  if (seg.prog < seg.len) tails.push(seg)
  const start = seg.from.map((f, i) => f + seg.span[i])
  seg = segment(start)
  let sq = 0
  for (let i = 0; i < 3; i++) {
    const goal = Math.min(Math.max(tgt[i], LIMIT_LO[i]), LIMIT_HI[i])
    seg.span[i] = goal - start[i]
    sq += seg.span[i] * seg.span[i]
  }
  seg.len = Math.sqrt(sq)
}
// A move is over at a via point once it is within the blend window of it, and at a stop once everything is still.
// The window is capped at a THIRD of the move: on a via-point move shorter than the window, 'remain <= blend' is
// true on its first tick, and the part would report done the moment MIN_MOVE_SEC is up.
const moveOver = (via, blend) => {
  const remain = seg.len - seg.prog
  return via ? remain <= Math.min(blend, seg.len / 3) : remain <= 0 && tails.length === 0
}

// Single-move mode (no jobs): the waypoint being moved to.
let target = 0
// Job mode: the job running (-1 = none), its steps (rows of the jobs table, with their row index), which step is
// next, whether that step has started, and the seconds a Wait has left.
let job = -1
let steps = []
let pc = 0
let started = false
let waitLeft = 0
// A commanded move or job reports busy for at least this long, so even a degenerate one shows the PLC a real busy
// window and the Execute/Done handshake can't miss it at any scan rate.
const MIN_MOVE_SEC = 0.1
let busySec = 0 // seconds since the active command was accepted

// Run the active job's steps, as far as this tick allows. Instant steps (vacuum, set) chain on in the same tick; a
// move, a wait or a wait-for holds the job until it is done. An enabled check is the caller's.
function runJob(ctx, POSES) {
  for (let guard = 0; guard < 64 && pc < steps.length; guard++) {
    const [, op, a, b] = steps[pc].values
    if (op === MOVE) {
      if (!started) {
        const pose = POSES[a]
        // a step whose waypoint is gone ends the job there: the platform stays put rather than guessing a place
        if (!Number.isInteger(a) || !pose) { pc = steps.length; return }
        startMove(pose)
        started = true
      }
      if (!moveOver(b === 1, ctx.params.blendDist)) return
    } else if (op === VACUUM) {
      gripClosed = a === 1
    } else if (op === WAIT) {
      if (!started) { waitLeft = a; started = true }
      if (waitLeft > 1e-9) return
    } else if (op === WAIT_FOR) {
      const tag = ctx.params['in' + (a + 1) + 'Tag']
      if ((tag ? ctx.readTag(tag) : false) !== (b === 1)) return
    } else if (op === SET_OUT) {
      if (a >= 0 && a < IO_COUNT) outputs[a] = b === 1
    }
    pc++
    started = false
  }
}

definePart({
  joints: ['x', 'y', 'z'],
  grippers: ['gripper'],
  lamps: ['vacuumLamp'],
  params: {
    speed: { type: 'number', default: 2, min: 0.05, max: 10, step: 0.05, label: 'Speed (m/s)', group: 'Motion', desc: 'Top speed of the platform along its straight path. All three axes are driven from one path parameter, so they start and arrive together.' },
    accel: { type: 'number', default: 20, min: 0.5, max: 100, step: 0.5, label: 'Acceleration (m/s²)', group: 'Motion', desc: 'How hard the platform ramps to and from its speed. Lower it for a heavier or more delicate payload; a short move may never reach top speed at all.' },
    commandTag: { type: 'tag', dir: 'in', stType: 'INT', default: '', label: 'Command tag (job number)', group: 'Comms', desc: 'Which job to run: 1 is the first job, 2 the second and so on. Set it BEFORE pulsing execute. A robot with no jobs takes a waypoint row here instead (0 is home). A number with no job or row behind it is ignored, and the platform stays put rather than guessing.' },
    executeTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Execute tag (rising edge runs it)', group: 'Comms', desc: 'Pulse this false-to-true to start the job. It is edge-triggered, so holding it true does NOT repeat - drop it and raise it again for each job.' },
    doneTag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Done tag (true while idle)', group: 'Comms', desc: 'Handshake back to the program: true whenever the robot is ready for the next command. A job that ends on a Blend move reports done as it rounds that corner, so the next job can carry straight on. Wait for it before pulsing execute again, or the edge lands mid-job and is dropped.' },
    enableTag: { type: 'tag', dir: 'in', stType: 'BOOL', onlyWhenDriven: true, default: '', label: 'Enable tag', group: 'Comms', desc: 'The robot moves only while this is true. Drop it and the platform brakes to a stop where it is and the job holds, timers and all; raise it and the job carries on. Wire it to the cell being safe to work in. Until a program drives it, or with it empty, the robot is always enabled, so a merely-typed tag does not hold it.' },
    gripperTag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Vacuum tag', group: 'Comms', desc: 'For a robot with no jobs: grip or release the load, read continuously, so hold it true for the whole carry. A robot with jobs switches its own vacuum with Vacuum steps and ignores this.' },
    in1Tag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Input 1 tag', group: 'Comms/Robot signals', desc: 'A signal a job can wait on (a Wait for step). Robots have banks of these; wire the ones your jobs use.' },
    in2Tag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Input 2 tag', group: 'Comms/Robot signals', desc: 'A signal a job can wait on (a Wait for step).' },
    in3Tag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Input 3 tag', group: 'Comms/Robot signals', desc: 'A signal a job can wait on (a Wait for step).' },
    in4Tag: { type: 'tag', dir: 'in', stType: 'BOOL', default: '', label: 'Input 4 tag', group: 'Comms/Robot signals', desc: 'A signal a job can wait on (a Wait for step).' },
    out1Tag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Output 1 tag', group: 'Comms/Robot signals', desc: 'A signal a job switches (a Set step), to tell the program where it has got to. It holds its last value between jobs.' },
    out2Tag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Output 2 tag', group: 'Comms/Robot signals', desc: 'A signal a job switches (a Set step).' },
    out3Tag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Output 3 tag', group: 'Comms/Robot signals', desc: 'A signal a job switches (a Set step).' },
    out4Tag: { type: 'tag', dir: 'out', stType: 'BOOL', default: '', label: 'Output 4 tag', group: 'Comms/Robot signals', desc: 'A signal a job switches (a Set step).' },
    waypoints: { type: 'numberList', columns: POSE_COLUMNS, arity: 3, default: DEFAULT_POSES, rowNames: 'waypointNames', label: 'Waypoints', group: 'Motion', desc: 'The places this robot knows, one row of x, y and z in metres from home: x and y across the work area, z the lowering below home (larger is lower). A place outside the work area parks at its edge. Name them, and jobs move to them by name. Pose the platform with the viewport gizmo and use Capture Pose to add one rather than typing.' },
    waypointNames: { type: 'string', default: 'Home\nPick\nPlace', hidden: true, label: 'Waypoint names' },
    blendWaypoints: { type: 'numberList', rowsOf: 'waypoints', arity: 1, default: [], label: 'Pass-through waypoints (robots without jobs)', group: 'Motion', desc: 'For a robot with no jobs: which waypoints are VIA points. The platform reports done before it reaches one, so the next move can start while it is still running and the corner is rounded instead of braked to a stop. Jobs say this on each Move step instead.' },
    blendDist: { type: 'number', unit: 'm', default: 0.05, min: 0, max: 0.3, step: 0.005, label: 'Corner blend', group: 'Motion', desc: 'How far before a via point the platform starts cutting the corner. Larger rounds the path more and strays further from the taught place; the robot caps it at a third of the move.' },
    jobs: { type: 'numberList', arity: 4, default: [], program: { names: 'jobNames', ops: JOB_OPS }, label: 'Jobs', desc: 'The robot\'s own programs. The PLC runs one by number (the command tag) and the robot does the whole thing: moves, vacuum, waits, and the signals it sends back. While the scene runs, the step being run is highlighted.' },
    jobNames: { type: 'string', default: '', hidden: true, label: 'Job names' },
    pose: { type: 'numberList', rows: 1, columns: POSE_COLUMNS, arity: 3, default: [DEFAULT_POSES[0]], label: 'Idle pose', group: 'Start state', desc: 'The place a freshly placed robot rests at, and where one waiting for its first Execute sits. It is the robot you see in a stopped scene, so set it to something that reads as parked rather than mid-cycle.' },
  },
  // The vacuum status lamp on the platform's -X side face, in the gap between two arms: a round black bezel round a lens,
  // dark green until the robot switches its vacuum on (vacuumLamp). The same lamp reaches a seated tool, whose cups close
  // on it. The platform disc is 0.085 m in radius.
  geometry(g) {
    return [
      { desc: g.bevelBox([0.008, 0.02, 0.034], [-0.0865, 0, 0], 0.001), material: 'lampBezel', link: 'platform' },
      {
        desc: g.box([0.003, 0.012, 0.024], [-0.09, 0, 0]),
        material: 'lampLens',
        link: 'platform',
        lamps: [{ name: 'vacuumLamp', emissive: [0.15, 0.85, 0.2], offColor: [0.03, 0.06, 0.03] }],
      },
    ]
  },
  init(ctx) {
    // Seed the platform at its authored idle pose (the 'pose' param) so a freshly placed robot, and one waiting for its
    // first Execute, rests where the author trained it. Falls back to home if it is ill-shaped.
    const p = ctx.params.pose
    const idle = Array.isArray(p) && p.length > 0 && p[0].length === 3 ? p[0] : DEFAULT_POSES[0]
    cur = idle.slice()
    seg = segment(idle)
  },
  step(ctx) {
    const P = ctx.params
    const POSES = P.waypoints.length ? P.waypoints : DEFAULT_POSES
    const jobs = jobCount(P.jobs, P.jobNames)
    const enabled = !ctx.tagDriven(P.enableTag) || ctx.readTag(P.enableTag)
    const dt = ctx.dt

    // ctx.rising diffs the begin-of-tick snapshot, so an edge held over the async tag bus can't be lost.
    if (ctx.rising(P.executeTag) && !moving) {
      const cmd = Math.round(ctx.readNumber(P.commandTag))
      // a command with nothing behind it ignores the edge: stay put, done stays true
      if (jobs > 0 && cmd >= 1 && cmd <= jobs) {
        job = cmd - 1
        steps = []
        P.jobs.forEach((values, row) => { if (values[0] === job) steps.push({ row, values }) })
        pc = 0
        started = false
        moving = true
        busySec = 0
      } else if (jobs === 0 && cmd >= 0 && cmd < POSES.length) {
        target = cmd
        startMove(POSES[target])
        moving = true
        busySec = 0
      }
    }
    if (jobs === 0) gripClosed = ctx.readTag(P.gripperTag)
    if (job >= 0 && enabled) runJob(ctx, POSES)

    // Coordinated trapezoidal motion, and corners blended by OVERLAP, as on the Six-Axis Robot: every move brakes to a
    // stop at its own place. At a via point the part reports done early (or a job moves on early), so the next move
    // starts while this one is still running; the old move carries on into its stop as a tail, the new one ramps up
    // from the via place, and the platform sits at the sum of the two. The tails' speeds come off the new move's cap,
    // so the platform never exceeds 'speed' through a blend. Not enabled, every move brakes to a stop where it is.
    const vMax = enabled ? P.speed : 0
    let tailVel = 0
    for (const t of tails) { advance(t, vMax, P.accel, dt, ctx.approach); tailVel += t.vel }
    advance(seg, Math.max(vMax - tailVel, 0), P.accel, dt, ctx.approach)
    const u = fraction(seg)
    for (let i = 0; i < 3; i++) cur[i] = seg.from[i] + seg.span[i] * u
    for (const t of tails) {
      const tu = fraction(t)
      for (let i = 0; i < 3; i++) cur[i] += t.span[i] * (tu - 1)
    }
    tails = tails.filter((t) => t.prog < t.len)

    if (moving) busySec += dt
    if (enabled && job >= 0) waitLeft -= dt

    // Done once the job has run its last step (a job ending on a pass-through move hands off as it rounds it), or the
    // single move is over. The MIN_MOVE_SEC floor keeps one that would finish inside a PLC scan visible.
    const over = job >= 0 ? pc >= steps.length : moveOver(P.blendWaypoints.some((r) => r[0] === target), P.blendDist)
    if (moving && over && busySec >= MIN_MOVE_SEC) {
      moving = false
      job = -1
    }

    // the platform's slides; the arm joints are not commanded: the rig solves them from these
    ctx.joints.x = cur[0]
    ctx.joints.y = cur[1]
    ctx.joints.z = cur[2]
    ctx.grips.gripper = gripClosed
    ctx.lamps.vacuumLamp = gripClosed // the cups compress off this same signal
    if (P.doneTag) ctx.writeTag(P.doneTag, !moving)
    for (let i = 0; i < IO_COUNT; i++) {
      const tag = P['out' + (i + 1) + 'Tag']
      if (tag) ctx.writeTag(tag, outputs[i])
    }
    // the job row being run, for the Inspector to highlight (-1 = none)
    ctx.report('jobs', job >= 0 && pc < steps.length ? steps[pc].row : -1)
  },
})
