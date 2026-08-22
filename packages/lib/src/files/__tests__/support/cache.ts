// packages/lib/src/files/__tests__/support/cache.ts

/**
 * A recording {@link CachePort} double.
 *
 * The assertion this exists for is a timing one: caches must be busted *after*
 * the transaction commits, never inside it, because a mid-transaction
 * invalidation repopulates from a snapshot the commit has not reached yet.
 * Sharing a {@link Journal} with `makeDb` turns that into a one-line check.
 */

import type { CachePort } from '../../storage/ports'
import type { Journal } from './db'
import { makeJournal } from './db'

/** One recorded bust, in journal order. */
export interface CacheBust {
  event: string
  payload: Record<string, unknown>
}

export interface MakeCachePortOptions {
  /** Share ordering with `makeDb` and the other doubles. */
  journal?: Journal
  /** Full override, for tests that need a bust to throw. */
  impl?: Partial<CachePort>
}

export interface FakeCachePort {
  /** Pass this as `FilesDeps.cache`. */
  port: CachePort
  busts: CacheBust[]
  journal: Journal
  /** The event names that were busted, in order. */
  events(): string[]
}

/** Build a cache double that records every bust and does nothing else. */
export function makeCachePort(options: MakeCachePortOptions = {}): FakeCachePort {
  const journal = options.journal ?? makeJournal()
  const busts: CacheBust[] = []

  const port: CachePort = {
    bust: async (event, payload) => {
      journal.record('cache', 'bust', { event, payload })
      busts.push({ event, payload })
      await options.impl?.bust?.(event, payload)
    },
  }

  return {
    port,
    busts,
    journal,
    events: () => busts.map((b) => b.event),
  }
}
