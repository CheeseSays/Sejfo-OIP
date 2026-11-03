// The six-axis robot's pose gizmo, driven with the real pointer: what it draws (six joint rings, the end-effector
// handle, the tool-size dots, J1's ring lifted off the transform gizmo), the readout naming the joint under the
// pointer, a joint drag that jogs the arm without editing the document and the Inspector saying so (with Reset),
// an end-effector drag that keeps the tool's orientation, and the gizmo hidden while the sim runs.
// Run: node e2e/verify-robot-pose-gizmo.mjs [--headed]
/* global process, console, window */
import { startServer } from './_server.mjs'
import { chromium } from 'playwright'

const { port: PORT, vite } = await startServer()
const HEADED = process.argv.includes('--headed')
const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
}

const browser = await chromium.launch({ headless: !HEADED })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

/** the robot's gizmo as drawn: every handle on screen, and joint i's drawn ring */
const handles = () => page.evaluate(() => {
  const v = window.__oip.view
  const ov = v.rigGizmoOverlay
  ov.update(v.camera, v.container.clientHeight || 1)
  return {
    shown: ov.root.visible,
    list: ov.handles().map((h) => ({ handle: h.handle, ...v.worldToScreen(h.pos.x, h.pos.y, h.pos.z) })),
  }
})
const at = async (handle) => (await handles()).list.find((h) => h.handle === handle)
/** the tool link's world position + orientation */
const tool = (id) => page.evaluate((partId) => {
  const root = window.__oip.view.entries.get(partId).visual.object
  let t = null
  root.traverse((o) => { if (o.userData.linkName === 'tool') t = o })
  t.parent.updateWorldMatrix(true, false)
  t.updateMatrix()
  t.updateMatrixWorld(true)
  const p = t.getWorldPosition(t.position.clone())
  const q = t.getWorldQuaternion(t.quaternion.clone())
  return { p: p.toArray(), q: q.toArray() }
}, id)
const quatAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])))

try {
  await page.addInitScript(() => { try { localStorage.setItem('oip-web/tutorial-done', '1') } catch { /* ignore */ } })
  await page.goto(`http://localhost:${PORT}/app/`)
  await page.waitForFunction(() => !!(window.__oip?.store && window.__oip.controller && window.__oip.view), null, { timeout: 60000 })
  await page.locator('[data-package-id="oip.six-axis-robot"]').waitFor({ timeout: 30000 })
  const vp = await page.locator('.viewport').boundingBox()
  await page.evaluate(({ cx, cy }) => {
    const c = window.__oip.controller
    c.beginCatalogPlace('part', cx - 40, cy - 20, 'oip.six-axis-robot')
    c.catalogPlaceMove(cx, cy, false)
    c.endCatalogPlace(cx, cy, false)
  }, { cx: vp.x + vp.width / 2, cy: vp.y + vp.height / 2 })
  await page.waitForFunction(() => window.__oip.store.getState().scene.parts.some((p) => p.packageId === 'oip.six-axis-robot'))
  await page.waitForFunction(() => window.__oip.assetsBusy?.() === false, null, { timeout: 60000 })
  const robot = await page.evaluate(() => {
    const s = window.__oip.store
    s.cancelPlacing?.()
    const p = s.getState().scene.parts.find((q) => q.packageId === 'oip.six-axis-robot')
    s.select(p.id)
    const v = window.__oip.view
    const [x, y, z] = p.position
    v.camera.position.set(x + 3, y + 2.6, z + 3)
    v.controls.target.set(x, y + 1.1, z)
    v.camera.lookAt(v.controls.target)
    v.controls.update()
    return { id: p.id, pos: p.position }
  })
  await page.waitForTimeout(600)

  // ---- what it draws
  const h0 = await handles()
  const names = h0.list.map((h) => h.handle).sort()
  check('selecting the robot draws its gizmo', h0.shown)
  const rings = await page.evaluate(() => [0, 1, 2, 3, 4, 5, 6].filter((i) => window.__oip.view.rigGizmoOverlay.ringPoints(i, 4).length > 0).length)
  check('six joint rings (J6, the tool roll, included)', rings === 6, `${rings}`)
  check('the end-effector, and no tool-size dots (the tool is a part of its own)', names.includes('ee') && !names.some((n) => n.startsWith('size:')), names.join(' '))
  // no two drawn dots sit on each other: one that would is hidden, and its ring is grabbed instead
  const crowd = h0.list.filter((h) => h.handle === 'ee' || /^j\d$/.test(h.handle))
  let closest = Infinity
  for (let i = 0; i < crowd.length; i++) for (let k = i + 1; k < crowd.length; k++) closest = Math.min(closest, Math.hypot(crowd[i].x - crowd[k].x, crowd[i].y - crowd[k].y))
  check('no two joint / end-effector dots overlap on screen', closest >= 18, `closest ${closest.toFixed(0)} px`)
  const ringPick = await page.evaluate(() => {
    const v = window.__oip.view
    const out = []
    for (let i = 0; i < 6; i++) {
      // a point a third of the way round each ring, clear of its dot
      const pts = v.rigGizmoOverlay.ringPoints(i, 48)
      const p = pts[Math.round(pts.length / 3)]
      const s = v.worldToScreen(p.x, p.y, p.z)
      out.push(v.pickRobotHandle(s.x, s.y))
    }
    return out
  })
  check("each joint's ring grabs its joint anywhere along it (J6 included)", ringPick.filter((h, i) => h === `j${i}`).length >= 5 && ringPick[5] === 'j5', JSON.stringify(ringPick))
  const j1 = await page.evaluate(() => window.__oip.view.rigGizmoOverlay.joint(0)?.center.y ?? null)
  check('J1\'s ring sits up its axis, off the transform gizmo at the base', j1 !== null && j1 - robot.pos[1] > 0.3, `${(j1 - robot.pos[1]).toFixed(2)} m above the origin`)

  // ---- hover: the readout names the joint
  const j2 = await at('j1')
  await page.mouse.move(j2.x, j2.y)
  await page.waitForTimeout(250)
  const hover = await page.evaluate(() => {
    const el = window.__oip.view.overlays.degreeLabel
    return { text: el.textContent, shown: el.style.display !== 'none' }
  })
  check('hovering J2\'s handle shows "J2 <angle> deg"', hover.shown && /^J2 -?\d+\.\d deg$/.test(hover.text ?? ''), JSON.stringify(hover))

  // ---- a joint drag jogs the arm; the document is untouched and the Inspector says so
  const saved = () => page.evaluate((id) => JSON.stringify(window.__oip.store.getState().scene.parts.find((p) => p.id === id)), robot.id)
  const savedBefore = await saved()
  const a0 = await page.evaluate((id) => window.__oip.view.rigGizmoJointAngle(id, 1), robot.id)
  const pivot = await page.evaluate(() => {
    const v = window.__oip.view
    const c = v.rigGizmoOverlay.joint(1).center
    return v.worldToScreen(c.x, c.y, c.z)
  })
  const r = Math.hypot(j2.x - pivot.x, j2.y - pivot.y)
  const s0 = Math.atan2(j2.y - pivot.y, j2.x - pivot.x)
  await page.mouse.down()
  for (let k = 1; k <= 12; k++) {
    const s = s0 + (k / 12) * (Math.PI / 4)
    await page.mouse.move(pivot.x + r * Math.cos(s), pivot.y + r * Math.sin(s))
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  const a1 = await page.evaluate((id) => window.__oip.view.rigGizmoJointAngle(id, 1), robot.id)
  check('dragging J2\'s handle round its ring turns J2', Math.abs(a1 - a0) > 20, `${a0.toFixed(1)} -> ${a1.toFixed(1)} deg`)
  check('...without editing the document (the saved robot is unchanged)', (await saved()) === savedBefore)
  const jogged = page.locator('[data-testid="inspector-jogged"]')
  check('the Inspector says the arm is jogged and not saved', await jogged.isVisible(), await jogged.textContent().catch(() => ''))
  await page.locator('[data-testid="inspector-jogged-reset"]').click()
  await page.waitForTimeout(300)
  const a2 = await page.evaluate((id) => window.__oip.view.rigGizmoJointAngle(id, 1), robot.id)
  check('Reset puts J2 back at its saved pose', Math.abs(a2 - a0) < 0.01, `${a2.toFixed(2)} deg`)
  check('...and the notice goes', !(await jogged.isVisible()))

  // ---- an end-effector drag keeps the tool's orientation
  const t0 = await tool(robot.id)
  const ee = await at('ee')
  await page.mouse.move(ee.x, ee.y)
  await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(ee.x - k * 6, ee.y + k * 4)
  await page.mouse.up()
  await page.waitForTimeout(300)
  const t1 = await tool(robot.id)
  const moved = Math.hypot(t1.p[0] - t0.p[0], t1.p[1] - t0.p[1], t1.p[2] - t0.p[2])
  const turned = (quatAngle(t0.q, t1.q) * 180) / Math.PI
  check('dragging the end-effector moves the tool', moved > 0.05, `${moved.toFixed(3)} m`)
  check('...and keeps it at the orientation it had', turned < 1, `${turned.toFixed(2)} deg`)
  await page.locator('[data-testid="inspector-jogged-reset"]').click()
  await page.waitForTimeout(300)

  // ---- the X/Y/Z arrows hold the tool to one world axis, and keep its orientation
  const screenOf = (p) => page.evaluate((q) => window.__oip.view.worldToScreen(q.x, q.y, q.z), p)
  for (const [axis, idx] of [['x', 0], ['y', 1], ['z', 2]]) {
    const seg = await page.evaluate((h) => {
      const s = window.__oip.view.rigGizmoOverlay.axisSegments().find((x) => x.handle === h)
      return { a: s.a.toArray(), b: s.b.toArray() }
    }, `ee:${axis}`)
    const a = await screenOf({ x: seg.a[0], y: seg.a[1], z: seg.a[2] })
    const b = await screenOf({ x: seg.b[0], y: seg.b[1], z: seg.b[2] })
    // a point along the shaft that picks this arrow (another handle's dot can sit on part of it)
    let grab = { x: a.x + (b.x - a.x) * 0.6, y: a.y + (b.y - a.y) * 0.6 }
    let picked = null
    for (const f of [0.6, 0.45, 0.75, 0.3, 0.9]) {
      const g = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
      picked = await page.evaluate((q) => window.__oip.view.pickRobotHandle(q.x, q.y), g)
      grab = g
      if (picked === `ee:${axis}`) break
    }
    const before = await tool(robot.id)
    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    for (let k = 1; k <= 8; k++) await page.mouse.move(grab.x + (b.x - a.x) * 0.25 * (k / 8), grab.y + (b.y - a.y) * 0.25 * (k / 8))
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await tool(robot.id)
    const d = after.p.map((v, i) => v - before.p[i])
    const along = Math.abs(d[idx])
    const off = Math.max(...d.filter((_, i) => i !== idx).map(Math.abs))
    const held = (quatAngle(before.q, after.q) * 180) / Math.PI
    check(`the ${axis.toUpperCase()} arrow is grabbed along its shaft`, picked === `ee:${axis}`, String(picked))
    check(`dragging it moves the tool along ${axis.toUpperCase()} only`, along > 0.03 && off < 0.02, `along ${along.toFixed(3)} m, off-axis ${off.toFixed(3)} m`)
    check('...keeping its orientation', held < 1, `${held.toFixed(2)} deg`)
    await page.locator('[data-testid="inspector-jogged-reset"]').click()
    await page.waitForTimeout(300)
  }

  // ---- the rotation rings turn the tool about a world axis, its point held
  for (const axis of ['x', 'y', 'z']) {
    const ring = await page.evaluate((h) => {
      const r = window.__oip.view.rigGizmoOverlay.rotRingPoints(48).find((x) => x.handle === h)
      const c = window.__oip.view.rigGizmoOverlay.rotRing(h).center
      return { pts: r.pts.map((p) => p.toArray()), c: c.toArray() }
    }, `rot:${axis}`)
    const c = await screenOf({ x: ring.c[0], y: ring.c[1], z: ring.c[2] })
    // a point round the ring that picks it (the end-effector dot or an arrow can sit on part of it)
    let g = c
    let picked = null
    for (const f of [0.4, 0.15, 0.65, 0.9, 0.25, 0.55, 0.8]) {
      const p = ring.pts[Math.round(ring.pts.length * f)]
      g = await screenOf({ x: p[0], y: p[1], z: p[2] })
      picked = await page.evaluate((q) => window.__oip.view.pickRobotHandle(q.x, q.y), g)
      if (picked === `rot:${axis}`) break
    }
    const before = await tool(robot.id)
    const r0 = Math.hypot(g.x - c.x, g.y - c.y)
    const s0 = Math.atan2(g.y - c.y, g.x - c.x)
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    for (let k = 1; k <= 10; k++) {
      const s = s0 + (k / 10) * (Math.PI / 6)
      await page.mouse.move(c.x + r0 * Math.cos(s), c.y + r0 * Math.sin(s))
    }
    await page.mouse.up()
    await page.waitForTimeout(300)
    const after = await tool(robot.id)
    const moved = Math.hypot(...after.p.map((v, i) => v - before.p[i]))
    const turned = (quatAngle(before.q, after.q) * 180) / Math.PI
    check(`the ${axis.toUpperCase()} rotation ring is grabbed`, picked === `rot:${axis}`, String(picked))
    check(`dragging it turns the tool about ${axis.toUpperCase()}`, turned > 10, `${turned.toFixed(1)} deg`)
    check('...with the tool point held', moved < 0.03, `${moved.toFixed(3)} m`)
    await page.locator('[data-testid="inspector-jogged-reset"]').click()
    await page.waitForTimeout(300)
  }

  // ---- the toolbar toggle hides the joint rings; the tool's handles stay
  const jointCount = async () => (await handles()).list.filter((h) => /^j\d$/.test(h.handle)).length
  const ringPts = () => page.evaluate(() => window.__oip.view.rigGizmoOverlay.ringPoints(0, 8).length)
  const jointBtn = page.locator('.viewport-tool[title="Toggle robot joint gizmos"]')
  check('the toolbar has a joint-gizmo toggle, on by default', (await jointBtn.count()) === 1 && (await jointBtn.getAttribute('class')).includes('active'))
  await jointBtn.click()
  await page.waitForTimeout(300)
  const hidden = await handles()
  const hiddenNames = hidden.list.map((h) => h.handle)
  check('toggled off: no joint handle or ring is grabbable', (await jointCount()) === 0 && (await ringPts()) === 0, hiddenNames.join(' '))
  check('...while the tool arrows and end-effector stay', ['ee', 'ee:x', 'ee:y', 'ee:z'].every((n) => hiddenNames.includes(n)))
  await jointBtn.click()
  await page.waitForTimeout(300)
  check('toggled on again: the six joints are back', (await jointCount()) === 6, String(await jointCount()))

  // ---- running: the sim poses the arm, so the gizmo is hidden
  await page.evaluate(() => window.__oip.controller.run())
  await page.waitForFunction(() => window.__oip.store.getState().running === true, null, { timeout: 30000 })
  await page.waitForTimeout(400)
  const running = await handles()
  check('while the sim runs the gizmo is down', !running.shown)
  await page.evaluate(() => window.__oip.controller.stop())
  await page.waitForFunction(() => window.__oip.store.getState().running === false, null, { timeout: 30000 })
  await page.waitForTimeout(400)
  check('...and back up at Stop', (await handles()).shown)

  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('run', false, String(e).split('\n')[0])
} finally {
  await browser.close()
  vite.kill()
}
const ok = results.length > 0 && results.every(Boolean)
console.log(ok ? '\nAll checks passed.' : `\n${results.filter((x) => !x).length} check(s) FAILED`)
process.exitCode = ok ? 0 : 1
