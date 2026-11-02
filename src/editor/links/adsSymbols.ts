// The PLC connections window's read of a TwinCAT runtime's variables: open a connection of its own (BROWSE_LINK),
// list the symbol table once and close it. A run's link to the same PLC stays as it is; the router holds both.

import { adsRouteText, adsSymbolGroups, type AdsSymbolGroup } from '../../core/io/ads'
import type { AdsHost } from './externalPlcStatus'
import { adsForLink, BROWSE_LINK } from './linkHosts'

export interface AdsSymbolList {
  state: 'ready' | 'failed'
  groups: AdsSymbolGroup[]
  error: string | null
}

/** A shell that can list a runtime's symbols (one older than `ads:symbols` cannot; the window says so itself). */
export type AdsListingHost = AdsHost & Required<Pick<AdsHost, 'symbols'>>

// One read at a time: every read opens and closes the same link number, so a second one started while the first is
// still listing (the window closed and opened again, Read again, another controller) would have its link replaced
// by the shell and then closed by the first read's close.
let queue: Promise<unknown> = Promise.resolve()

/** The variables of the runtime at `netId` / `port`, grouped by program or list, or why they could not be read. */
export function readAdsSymbols(shell: AdsListingHost, netId: string, port: number): Promise<AdsSymbolList> {
  const run = queue.then(() => readOnce(shell, netId, port))
  queue = run.catch(() => {})
  return run
}

async function readOnce(shell: AdsListingHost, netId: string, port: number): Promise<AdsSymbolList> {
  const failed = (error: string): AdsSymbolList => ({ state: 'failed', groups: [], error })
  const host = adsForLink(shell, BROWSE_LINK)
  try {
    const opened = await host.open({ netId, port })
    if (opened.error) return failed(opened.error)
    const r = await shell.symbols({ link: BROWSE_LINK })
    if (r.error) return failed(r.error)
    if (r.code) return failed(adsRouteText(r.code, opened.localNetId ?? ''))
    return { state: 'ready', groups: adsSymbolGroups(r.symbols ?? []), error: null }
  } finally {
    await host.close()
  }
}
