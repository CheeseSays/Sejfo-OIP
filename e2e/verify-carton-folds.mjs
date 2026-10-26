// The Carton's looks in the app (docs/cargo-bodies.md, "A part with more than one look"): a flat sleeve, a sleeve half
// open, an open tube, one end's flaps part-way folded, one end closed and taped, and both ends closed and taped are each
// their own shape batch.
//
// A look that follows a param the collider ignores has to be named in cargo.visualParams, or every case draws as the
// first one made. A wall or flap that turns is a link whose rotation follows a param (`rotationParams`), which only the
// rig's pose resolver reads. The sim half (a hand carries a blank through the cell, and the stages never go back) is
// pinned headless in src/sim/cartonCell.test.ts.
//
//   node e2e/verify-carton-folds.mjs [--headed] [--shot <dir>]
/* global window, localStorage, console, process */
import { chromium } from 'playwright'
import { startServer } from './_server.mjs'
import { cleanShot } from './_shot.mjs'

const shotDir = process.argv.includes('--shot') ? process.argv[process.argv.indexOf('--shot') + 1] : null
let failures = 0
const check = (n, ok, info = '') => {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${info ? `  (${info})` : ''}`)
}

const { port } = await startServer()
const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })

try {
  await page.goto(`http://localhost:${port}/app/`)
  await page.evaluate(() => {
    localStorage.clear()
    localStorage.setItem('oip-web/tutorial-done', '1')
  })
  await page.reload()
  await page.waitForFunction(() => window.__oip?.controller && window.__oip.getPackage, null, { timeout: 120000 })
  const states = [{ open: 0, flat: 1 }, { open: 0.5, flat: 0.5 }, {}, { foldA: 3 }, { foldA: 6, tapedA: 1 }, { foldA: 6, foldB: 6, tapedA: 1, tapedB: 1 }]
  await page.evaluate((list) => {
    const { store } = window.__oip
    const s = store.getState()
    const pkg = window.__oip.getPackage('oip.carton')
        const parts = list.map((p, i) => ({ id: `c${i}`, type: 'part', packageId: pkg.id, position: [(i - 2.5) * 0.6, 1.6, 0], rotationY: 0, params: p }))
    store.commit('Cartons', { ...s.scene, packages: [...(s.scene.packages ?? []), pkg], parts })
    window.__oip.view.setCameraPose({ px: 0, py: 3.2, pz: 2.6, tx: 0, ty: 1.5, tz: 0 }, { instant: true })
  }, states)
  await page.waitForFunction(() => window.__oip.view.boxes.partShapes.size >= 6, null, { timeout: 30000 }).catch(() => {})
  const shapes = await page.evaluate(() => window.__oip.view.boxes.partShapes.size)
  check('the six looks are six shape batches', shapes === 6, `shapes ${shapes}`)
  if (shotDir) await cleanShot(page, `${shotDir}/carton-folds.png`)
} catch (e) {
  failures++
  console.log(`FAIL  ${e instanceof Error ? e.message : e}`)
} finally {
  await browser.close()
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
