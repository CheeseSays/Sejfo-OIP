// Focused check: a Vacuum Tool is a part of its own that seats on the Six-Axis robot's flange and rides it.
// Drops the robot and then the tool through the real catalog placement, so the snap engine seats the tool on the flange
// and soft-parents it; then checks the tool hangs under the robot's `eoat` link group, follows every joint pose and the
// robot's scale, keeps riding through a robot rebuild, resizes in place, is deleted and restored by undo, and that a
// robot with no tool draws no plate.
// Run: node e2e/verify-tool-mount.mjs [--headed]
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

// the robot, the tool, and where the tool hangs, read off the live scene graph
const probe = (page) =>
  page.evaluate(() => {
    const st = window.__oip.store.getState()
    const arm = st.scene.parts.find((p) => p.packageId === 'oip.six-axis-robot')
    const tool = st.scene.parts.find((p) => p.packageId === 'oip.vacuum-tool')
    const entries = window.__oip.view.entries
    const armObj = arm && entries.get(arm.id)?.visual.object
    const toolObj = tool && entries.get(tool.id)?.visual.object
    const link = armObj?.userData.linkGroup?.('eoat')
    if (toolObj) toolObj.updateWorldMatrix(true, false)
    if (link) link.updateWorldMatrix(true, false)
    const at = (o) => (o ? o.matrixWorld.elements.slice(12, 15).map((v) => +v.toFixed(4)) : null)
    const sc = (o) => (o ? +Math.hypot(...o.matrixWorld.elements.slice(0, 3)).toFixed(4) : null)
    return {
      arm: arm?.id ?? null,
      tool: tool?.id ?? null,
      parent: tool?.parent ?? null,
      underLink: !!toolObj && !!link && toolObj.parent === link,
      toolAt: at(toolObj),
      linkAt: at(link),
      toolScale: sc(toolObj),
      toolParts: toolObj ? (() => { let n = 0; toolObj.traverse((o) => { if (o.isMesh && o.castShadow) n++ }); return n })() : 0,
    }
  })

const place = (page, id, cx, cy) =>
  page.evaluate(({ id, cx, cy }) => {
    const c = window.__oip.controller
    c.beginCatalogPlace('part', cx - 40, cy - 20, id)
    c.catalogPlaceMove(cx, cy, false)
    c.endCatalogPlace(cx, cy, false)
  }, { id, cx, cy })

// drop a tool where the cursor ray meets the floor under the robot's flange: the snap seats within 0.5 m of it in plan
const placeOnFlange = async (page, id) => {
  const at = await page.evaluate(() => {
    const st = window.__oip.store.getState()
    const arm = st.scene.parts.find((p) => p.packageId === 'oip.six-axis-robot')
    const link = window.__oip.view.entries.get(arm.id).visual.object.userData.linkGroup('eoat')
    link.updateWorldMatrix(true, false)
    const e = link.matrixWorld.elements
    return window.__oip.view.worldToScreen(e[12], 0, e[14])
  })
  await place(page, id, at.x, at.y)
}

const poseArm = (page, joints) =>
  page.evaluate((j) => {
    const arm = window.__oip.store.getState().scene.parts.find((p) => p.packageId === 'oip.six-axis-robot')
    window.__oip.view.entries.get(arm.id).visual.object.userData.applyJoints(j)
  }, joints)

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

    // the robot first: with no tool it draws only its own flange lamp, and no plate
    await place(page, 'oip.six-axis-robot', cx, cy)
    await page.waitForFunction(() => window.__oip.store.getState().scene.parts.some((p) => p.packageId === 'oip.six-axis-robot'), { timeout: 15000 })
    await page.waitForTimeout(800)
    let s = await probe(page)
    check('a robot placed alone has no tool part', s.arm !== null && s.tool === null)

    // then the tool, dropped under the flange: it seats on the flange and becomes the robot's child
    await placeOnFlange(page, 'oip.vacuum-tool')
    await page.waitForFunction(() => window.__oip.store.getState().scene.parts.some((p) => p.packageId === 'oip.vacuum-tool'), { timeout: 15000 })
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250)
      s = await probe(page)
      if (s.underLink) break
    }
    check('the dropped tool is soft-parented under the robot', s.tool !== null && s.parent === s.arm, `parent=${s.parent}`)
    check('the tool hangs under the robot eoat link group', s.underLink)
    check('the tool sits at the flange', !!s.toolAt && !!s.linkAt && s.toolAt.every((v, i) => Math.abs(v - s.linkAt[i]) < 1e-3), `${s.toolAt} vs ${s.linkAt}`)
    check('the tool draws its plate, rails, adapter, LED and cups', s.toolParts >= 7, `${s.toolParts} meshes`)
    await cleanShot(page, join(SHOTS, 'tool-mount-seated.png'))

    // a second tool dropped on the same flange is refused: it stays where it landed, unparented, and the first keeps the seat
    await placeOnFlange(page, 'oip.vacuum-tool')
    await page.waitForFunction(() => window.__oip.store.getState().scene.parts.filter((p) => p.packageId === 'oip.vacuum-tool').length === 2, { timeout: 15000 })
    const tools = await page.evaluate(() => window.__oip.store.getState().scene.parts.filter((p) => p.packageId === 'oip.vacuum-tool').map((p) => ({ id: p.id, parent: p.parent ?? null })))
    check('a second tool is not seated on a flange that has one', tools.filter((t) => t.parent !== null).length === 1, JSON.stringify(tools))
    await page.evaluate(() => {
      const st = window.__oip.store
      const sc = st.getState().scene
      const extra = sc.parts.filter((p) => p.packageId === 'oip.vacuum-tool' && !p.parent)
      st.commit('Remove extra tool', { ...sc, parts: sc.parts.filter((p) => !extra.includes(p)) })
    })
    await page.waitForTimeout(300)

    // every joint pose carries the tool: it stays exactly on the flange while the arm swings
    const before = s.linkAt
    for (const j of [{ j1: 1.2, j2: -0.6, j3: 0.9, j4: 0.4, j5: -0.5, j6: 2.2 }, { j1: -2, j2: 0.5, j3: -1.1, j4: -1.2, j5: 0.8, j6: -1 }]) {
      await poseArm(page, j)
      await page.waitForTimeout(150)
      s = await probe(page)
      const onFlange = !!s.toolAt && !!s.linkAt && s.toolAt.every((v, i) => Math.abs(v - s.linkAt[i]) < 1e-3)
      const moved = s.linkAt.some((v, i) => Math.abs(v - before[i]) > 0.05)
      check(`the tool follows the arm to ${JSON.stringify(j)}`, onFlange && moved, `${s.toolAt} vs ${s.linkAt}`)
    }
    await cleanShot(page, join(SHOTS, 'tool-mount-posed.png'))
    await poseArm(page, {})

    // the robot's scale carries the tool: twice the arm, twice the plate
    await page.evaluate(() => {
      const store = window.__oip.store
      const sc = store.getState().scene
      store.commit('Scale arm', { ...sc, parts: sc.parts.map((p) => (p.packageId === 'oip.six-axis-robot' ? { ...p, params: { ...p.params, scale: 2 } } : p)) })
    })
    await page.waitForTimeout(500)
    s = await probe(page)
    check('twice the robot scale draws twice the plate', s.toolScale === 2, `scale=${s.toolScale}`)
    check('and the tool is still on the flange', !!s.toolAt && s.toolAt.every((v, i) => Math.abs(v - s.linkAt[i]) < 1e-3))
    await page.evaluate(() => {
      const store = window.__oip.store
      const sc = store.getState().scene
      store.commit('Unscale arm', { ...sc, parts: sc.parts.map((p) => (p.packageId === 'oip.six-axis-robot' ? { ...p, params: { ...p.params, scale: 1 } } : p)) })
    })
    await page.waitForTimeout(300)

    // a robot rebuild (a package edit swaps its link groups) re-seats the tool under the new flange group
    await page.evaluate(() => window.__oip.view.refreshPackage('oip.six-axis-robot'))
    await page.waitForTimeout(400)
    s = await probe(page)
    check('the tool is re-seated under the rebuilt robot', s.underLink)

    // the robot's vacuum lamp reaches the tool: the sim's frame lamps name the robot, and the tool's LED and cups answer
    const lit = await page.evaluate(() => {
      const st = window.__oip.store.getState()
      const arm = st.scene.parts.find((p) => p.packageId === 'oip.six-axis-robot')
      const toolObj = window.__oip.view.entries.get(st.scene.parts.find((p) => p.packageId === 'oip.vacuum-tool').id).visual.object
      const frame = (on) => ({
        count: 0, ids: new Uint32Array(0), positions: new Float32Array(0), quats: new Float32Array(0), halfExtents: new Float32Array(0),
        colors: new Float32Array(0), kinds: new Uint8Array(0), partIds: [], simTime: on ? 1 : 2, lamps: { [arm.id]: { vacuumLamp: on } },
      })
      const green = () => {
        let n = 0
        toolObj.traverse((m) => { if (m.isMesh && m.material?.emissive && m.material.emissive.g > 0.5 && m.material.emissive.g > m.material.emissive.r) n++ })
        return n
      }
      const off = green()
      window.__oip.view.applyBoxFrame(frame(true))
      toolObj.userData.tick(1, true)
      const on = green()
      let squash = null
      toolObj.traverse((o) => { if (o.isInstancedMesh && o.userData.poolMobile) squash = +o.scale.y.toFixed(3) })
      window.__oip.view.applyBoxFrame(frame(false))
      toolObj.userData.tick(1, true)
      return { off, on, squash, after: green() }
    })
    check('the robot vacuum lamp lights the tool LED and squashes its cups', lit.off === 0 && lit.on === 1 && lit.squash === 0.85 && lit.after === 0, JSON.stringify(lit))

    // selecting the tool draws its own size dots, which ride the arm with it: a pose of the arm moves them, and they stay the
    // same distance from the flange (half the plate plus the dot's frame height)
    const dotState = () =>
      page.evaluate(() => {
        const v = window.__oip.view
        const ov = v.rigGizmoOverlay
        ov.update(v.camera, v.container.clientHeight || 1)
        const st = window.__oip.store.getState()
        const tool = st.scene.parts.find((p) => p.packageId === 'oip.vacuum-tool')
        const arm = st.scene.parts.find((p) => p.packageId === 'oip.six-axis-robot')
        const link = v.entries.get(arm.id).visual.object.userData.linkGroup('eoat')
        link.updateWorldMatrix(true, false)
        const o = link.matrixWorld.elements.slice(12, 15)
        const dots = Object.fromEntries(ov.handles().map((h) => [h.handle, h.pos.toArray()]))
        const dist = (p) => Math.hypot(p[0] - o[0], p[1] - o[1], p[2] - o[2])
        return { shown: ov.root.visible, names: Object.keys(dots), x: dots['size:toolSizeX'] ? +dist(dots['size:toolSizeX']).toFixed(4) : null, z: dots['size:toolSizeZ'] ? +dist(dots['size:toolSizeZ']).toFixed(4) : null, size: tool.params.toolSizeX, at: dots['size:toolSizeX'] ?? null }
      })
    await page.evaluate(() => window.__oip.store.select(window.__oip.store.getState().scene.parts.find((p) => p.packageId === 'oip.vacuum-tool').id))
    await page.waitForTimeout(500)
    let dots = await dotState()
    const reach = (half) => +Math.hypot(half, 0.075).toFixed(4)
    check('selecting the tool draws its two size dots, and no joint rings or end-effector', dots.shown && dots.names.sort().join() === 'size:toolSizeX,size:toolSizeZ', dots.names.join(' '))
    check('the dots sit at half the plate from the flange', dots.x === reach(dots.size / 2) && dots.z === reach(dots.size / 2), `${dots.x}, ${dots.z}`)
    const dotsBefore = dots.at
    await poseArm(page, { j1: 1.2, j2: -0.6, j3: 0.9, j4: 0.4, j5: -0.5, j6: 2.2 })
    await page.waitForTimeout(300)
    dots = await dotState()
    check('the dots ride the arm', dots.at.some((v, i) => Math.abs(v - dotsBefore[i]) > 0.05) && dots.x === reach(dots.size / 2), `${dots.x}`)
    await cleanShot(page, join(SHOTS, 'tool-mount-dots.png'), { deselect: false })
    await poseArm(page, {})
    await page.evaluate(() => window.__oip.store.select(null))

    // the tool resizes in place and stays put
    await page.evaluate(() => {
      const store = window.__oip.store
      const sc = store.getState().scene
      store.commit('Size tool', { ...sc, parts: sc.parts.map((p) => (p.packageId === 'oip.vacuum-tool' ? { ...p, params: { ...p.params, toolSizeX: 1.2, toolSizeZ: 1 } } : p)) })
    })
    await page.waitForTimeout(500)
    s = await probe(page)
    check('a resized tool is still on the flange', s.underLink && !!s.toolAt && s.toolAt.every((v, i) => Math.abs(v - s.linkAt[i]) < 1e-3))
    await cleanShot(page, join(SHOTS, 'tool-mount-resized.png'))

    // delete the tool: the robot stays and draws no plate; undo brings the tool back on the flange
    await page.evaluate(() => {
      const store = window.__oip.store
      const sc = store.getState().scene
      store.commit('Delete tool', { ...sc, parts: sc.parts.filter((p) => p.packageId !== 'oip.vacuum-tool') })
    })
    await page.waitForTimeout(400)
    s = await probe(page)
    check('deleting the tool leaves the robot alone', s.arm !== null && s.tool === null && s.toolParts === 0)
    await cleanShot(page, join(SHOTS, 'tool-mount-bare.png'))
    await page.evaluate(() => window.__oip.store.undo())
    await page.waitForTimeout(600)
    s = await probe(page)
    check('undo brings the tool back, on the flange', s.underLink && s.parent === s.arm)
  } finally {
    await browser.close()
  }
  console.log(failed === 0 ? '\nPASS: a tool seats on the flange and rides the arm' : `\nFAIL: ${failed} check(s) failed`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
