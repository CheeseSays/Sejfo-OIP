import { describe, expect, it } from 'vitest'
import type { AdsHost } from './externalPlcStatus'
import { MAX_SCENE_PLCS } from '../../core/scene/scenePlcs'
import { BROWSE_LINK } from './linkHosts'
import { readAdsSymbols, type AdsListingHost } from './adsSymbols'

// a shell that records the calls and answers with `answer`
function shell(answer: Awaited<ReturnType<NonNullable<AdsHost['symbols']>>>, open: Awaited<ReturnType<AdsHost['open']>> = { error: '' }): { host: AdsListingHost; calls: string[] } {
  const calls: string[] = []
  const host: AdsListingHost = {
    open: async (o) => (calls.push(`open ${o.netId}:${o.port} link ${o.link}`), open),
    bind: async () => ({ error: '' }),
    exchange: async () => ({ error: '' }),
    symbols: async (o) => (calls.push(`symbols link ${o?.link}`), answer),
    close: async (o) => void calls.push(`close link ${o?.link}`),
  }
  return { host, calls }
}

describe('reading a runtime\'s variables for the connections window', () => {
  it('reads on a link number no controller uses', () => {
    // controllers take 0 to MAX_SCENE_PLCS - 1 (controller/plcLinks.ts openLink)
    expect(BROWSE_LINK).toBeGreaterThanOrEqual(MAX_SCENE_PLCS)
  })

  it('lists them on the picker\'s own link, and closes it', async () => {
    const { host, calls } = shell({ error: '', code: 0, symbols: [{ name: 'MAIN.Extend', adsType: 33, size: 1, typeName: 'BOOL' }] })
    const list = await readAdsSymbols(host, '5.170.233.29.1.1', 851)
    expect(list).toEqual({ state: 'ready', groups: [{ name: 'MAIN', variables: [{ name: 'MAIN.Extend', short: 'Extend', typeName: 'BOOL', kind: 'bool' }] }], error: null })
    expect(calls).toEqual([`open 5.170.233.29.1.1:851 link ${BROWSE_LINK}`, `symbols link ${BROWSE_LINK}`, `close link ${BROWSE_LINK}`])
  })

  it('says why when the runtime refuses, and still closes the link', async () => {
    const { host, calls } = shell({ error: '', code: 0x7 }, { error: '', localNetId: '10.0.0.5.1.1' })
    const list = await readAdsSymbols(host, '5.170.233.29.1.1', 851)
    expect(list.state).toBe('failed')
    expect(list.error).toMatch(/target machine not found/)
    expect(list.error).toMatch(/This PC's AMS Net ID is 10\.0\.0\.5\.1\.1$/)
    expect(calls.at(-1)).toBe(`close link ${BROWSE_LINK}`)
  })

  it('says why when the port cannot be opened', async () => {
    const { host } = shell({ error: '' }, { error: 'ADS needs TwinCAT\'s router on this PC' })
    expect((await readAdsSymbols(host, '', 851)).error).toBe('ADS needs TwinCAT\'s router on this PC')
  })

  it('runs one read at a time, so a second read never shares the first read link', async () => {
    const { host, calls } = shell({ error: '', code: 0, symbols: [] })
    await Promise.all([readAdsSymbols(host, 'a', 851), readAdsSymbols(host, 'b', 852)])
    expect(calls).toEqual([
      `open a:851 link ${BROWSE_LINK}`,
      `symbols link ${BROWSE_LINK}`,
      `close link ${BROWSE_LINK}`,
      `open b:852 link ${BROWSE_LINK}`,
      `symbols link ${BROWSE_LINK}`,
      `close link ${BROWSE_LINK}`,
    ])
  })
})
