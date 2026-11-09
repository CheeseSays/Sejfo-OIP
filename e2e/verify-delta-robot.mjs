// Focused check: the Delta Robot's rig in the real viewport. A Vacuum Tool dropped under the platform seats on its
// `eoat` link (the same tool snapping as the Six-Axis Robot's flange) and rides it; posing the platform's three slides draws
// the arms where the rig solves them, so every rod stays its length and the platform stays level; and the pose gizmo's
// end-effector drag moves the platform through the slides with the arms following.
// Run: node e2e/verify-delta-robot.mjs [--headed]
/* global process, console, window */
import { startServer } from './_server.mjs'
import { cleanShot } from './_shot.mjs'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const { port: PORT } = await startServer()
const URL = `http://localhost:${PORT}/app/?gfx=low`
const HEADED = process.argv.includes('--headed')
const SHOTS = join(import.meta.dirname, 'shots')
mkdirSync(SHOTS, { recursive: true })

let failed = 0
const check = (name, ok, detail = '') => {
  if (!ok) failed++
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` - ${detail}` : ''}`)
}

const ROD = 0.95

// where everything is, read off the live scene graph
const probe = (page) =>
  page.evaluate(() => {
    const st = window.__oip.store.getState()
    const arm = st.scene.parts.find((p) => p.packageId === 'oip.delta-robot')
    const tool = st.scene.parts.find((p) => p.packageId === 'oip.vacuum-tool')
    const entries = window.__oip.view.entries
    const armObj = arm && entries.get(arm.id)?.visual.object
    const toolObj = tool && entries.get(tool.id)?.visual.object
    const g = (name) => armObj?.userData.linkGroup?.(name)
    const at = (o) => {
      if (!o) return null
      o.updateWorldMatrix(true, false)
      return o.matrixWorld.elements.slice(12, 15)
    }
    const up = (o) => {
      if (!o) return null
      o.updateWorldMatrix(true, false)
      return o.matrixWorld.elements.slice(4, 7) // the link's local +Y in world
    }
    const rods = []
    for (const n of [1, 2, 3]) for (const k of ['a', 'b']) {
      const r = at(g(`rod${n}${k}`))
      const e = at(g(`end${n}${k}`))
      rods.push(r && e ? Math.hypot(r[0] - e[0], r[1] - e[1], r[2] - e[2]) : null)
    }
    return {
      arm: arm?.id ?? null,
      tool: tool?.id ?? null,
      parent: tool?.parent ?? null,
      underLink: !!toolObj && !!g('eoat') && toolObj.parent === g('eoat'),
      toolAt: at(toolObj),
      eoatAt: at(g('eoat')),
      platformAt: at(g('platform')),
      platformUp: up(g('platform')),
      rods,
    }
  })

const place = (page, id, cx, cy) =>
  page.evaluate(({ id, cx, cy }) => {
    const c = window.__oip.controller
    c.beginCatalogPlace('part', cx - 40, cy - 20, id)
    c.catalogPlaceMove(cx, cy, false)
    c.endCatalogPlace(cx, cy, false)
  }, { id, cx, cy })

const pose = (page, joints) =>
  page.evaluate((j) => {
    const arm = window.__oip.store.getState().scene.parts.find((p) => p.packageId === 'oip.delta-robot')
    window.__oip.view.entries.get(arm.id).visual.object.userData.applyJoints(j)
  }, joints)

const near = (a, b, tol = 1e-3) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) < tol)

async function main() {
  const browser = await chromium.launch({ headless: !HEADED, args: ['--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader'] })
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
  page.on('console', (m) => { if (m.type() === 'error') { failed++; console.log('  [page error]', m.text()) } })
  try {
    await page.goto(URL)
    await page.waitForFunction(() => !!(window.__oip && window.__oip.store && window.__oip.controller && window.__oip.view), { timeout: 30000 })
    const vp = await page.locator('.viewport').boundingBox()
    const cx = vp.x + vp.width / 2
    const cy = vp.y + vp.height / 2

    await place(page, 'oip.delta-robot', cx, cy)
    await page.waitForFunction(() => window.__oip.store.getState().scene.parts.some((p) => p.packageId === 'oip.delta-robot'), { timeout: 15000 })
    await page.waitForTimeout(800)
    let s = await probe(page)
    check('a robot placed alone has no tool part', s.arm !== null && s.tool === null)
    check('every rod is its length at rest', s.rods.every((r) => r !== null && Math.abs(r - ROD) < 1e-3), s.rods.join(' '))

    // the tool, dropped under the platform: it seats on the eoat link and becomes the robot's child
    const under = await page.evaluate(() => {
      const arm = window.__oip.store.getState().scene.parts.find((p) => p.packageId === 'oip.delta-robot')
      const link = window.__oip.view.entries.get(arm.id).visual.object.userData.linkGroup('eoat')
      link.updateWorldMatrix(true, false)
      const e = link.matrixWorld.elements
      return window.__oip.view.worldToScreen(e[12], 0, e[14])
    })
    await place(page, 'oip.vacuum-tool', under.x, under.y)
    await page.waitForFunction(() => window.__oip.store.getState().scene.parts.some((p) => p.packageId === 'oip.vacuum-tool'), { timeout: 15000 })
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250)
      s = await probe(page)
      if (s.underLink) break
    }
    check('the dropped tool is soft-parented under the robot', s.tool !== null && s.parent === s.arm, `parent=${s.parent}`)
    check('the tool hangs under the robot eoat link group', s.underLink)
    check('the tool sits on the eoat link', near(s.toolAt, s.eoatAt), `${s.toolAt} vs ${s.eoatAt}`)
    await cleanShot(page, join(SHOTS, 'delta-robot-seated.png'))

    // every platform pose: the tool rides, the platform stays level, every rod stays its length
    const home = s.eoatAt
    for (const j of [{ x: 0.3, y: 0, z: 0 }, { x: -0.3, y: 0.3, z: 0.45 }, { x: 0.1, y: -0.3, z: 0.2 }]) {
      await pose(page, j)
      await page.waitForTimeout(150)
      s = await probe(page)
      check(`the tool follows the platform to ${JSON.stringify(j)}`, near(s.toolAt, s.eoatAt) && !near(s.eoatAt, home, 0.05), `${s.toolAt} vs ${s.eoatAt}`)
      check('  the platform is level', Math.abs(s.platformUp[0]) < 1e-4 && Math.abs(s.platformUp[2]) < 1e-4)
      check('  every rod is its length', s.rods.every((r) => r !== null && Math.abs(r - ROD) < 1e-3), s.rods.map((r) => r?.toFixed(4)).join(' '))
    }
    await cleanShot(page, join(SHOTS, 'delta-robot-posed.png'))
    await pose(page, {})

    // the pose gizmo: selecting the robot shows the three slides and the end-effector, and an end-effector drag moves the
    // platform through the slides, the arms following
    await page.evaluate(() => window.__oip.store.select(window.__oip.store.getState().scene.parts.find((p) => p.packageId === 'oip.delta-robot').id))
    await page.waitForTimeout(500)
    const drag = await page.evaluate(() => {
      const st = window.__oip.store.getState()
      const arm = st.scene.parts.find((p) => p.packageId === 'oip.delta-robot')
      const obj = window.__oip.view.entries.get(arm.id).visual.object
      const gizmo = obj.userData.robotGizmo
      const link = obj.userData.linkGroup('platform')
      const before = (link.updateWorldMatrix(true, false), link.matrixWorld.elements.slice(12, 15))
      const target = link.position.clone().set(before[0] + 0.2, before[1] - 0.15, before[2] - 0.25)
      gizmo.beginIK()
      const deg = gizmo.solveIK(target)
      link.updateWorldMatrix(true, false)
      const after = link.matrixWorld.elements.slice(12, 15)
      const rods = []
      for (const n of [1, 2, 3]) for (const k of ['a', 'b']) {
        const r = obj.userData.linkGroup(`rod${n}${k}`)
        const e = obj.userData.linkGroup(`end${n}${k}`)
        r.updateWorldMatrix(true, false)
        e.updateWorldMatrix(true, false)
        const a = r.matrixWorld.elements
        const b = e.matrixWorld.elements
        rods.push(Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]))
      }
      return { target: target.toArray(), after, deg, joints: gizmo.layout().joints.map((j) => j.label), rods }
    })
    check('the gizmo offers the three slides only', drag.joints.join() === 'J1,J2,J3', drag.joints.join())
    check('an end-effector drag brings the platform to the target', near(drag.after, drag.target, 0.015), `${drag.after.map((v) => v.toFixed(3))} vs ${drag.target.map((v) => v.toFixed(3))}`)
    check('  and the arms followed: every rod is its length', drag.rods.every((r) => Math.abs(r - ROD) < 1e-3), drag.rods.map((r) => r.toFixed(4)).join(' '))
    await cleanShot(page, join(SHOTS, 'delta-robot-gizmo.png'), { deselect: false })
  } finally {
    await browser.close()
  }
  console.log(failed === 0 ? '\nPASS: the Delta Robot seats a tool, solves its arms and drags by its platform' : `\nFAIL: ${failed} check(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
