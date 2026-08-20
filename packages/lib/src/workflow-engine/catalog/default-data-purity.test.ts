// packages/lib/src/workflow-engine/catalog/default-data-purity.test.ts

import { isDeepStrictEqual } from 'node:util'
import { expect, it, vi } from 'vitest'
import { listManifests } from './registry'

/**
 * `defaultData()` must be a function of the node type and NOTHING else.
 *
 * Two distinct impurities break that, and only one of them is visible to a
 * naive `defaultData() === defaultData()` comparison:
 *
 *  1. **Per-call minting** — `generateId()` returns a different string on every
 *     call, so two calls in the same process already disagree.
 *  2. **Ambient-environment reads** — `Intl.DateTimeFormat().resolvedOptions()
 *     .timeZone` returns the SAME string on every call inside one process, so
 *     two back-to-back calls agree and the site looks pure. It is the worst of
 *     the two: the value silently differs between the browser (the user's zone)
 *     and the worker (UTC), which is precisely a cross-process bug.
 *
 * Plan `26` §6 B1 specified the naive comparison and predicted it would fail on
 * `scheduled`. It does not — `scheduled` sails through it, and `find` (which
 * B1 never listed) fails. Hence the zone swap below: the second call runs under
 * a different ambient IANA zone, which is the only way this test has teeth
 * against failure mode 2.
 */
const REAL_DATE_TIME_FORMAT = Intl.DateTimeFormat

const ZONE_A = 'America/Los_Angeles'
const ZONE_B = 'Asia/Tokyo'

/** Run `fn` with the ambient resolved IANA zone forced to `zone`. */
function withAmbientZone<T>(zone: string, fn: () => T): T {
  const spy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(((...args: unknown[]) => {
    const formatter = new (
      REAL_DATE_TIME_FORMAT as unknown as new (
        ...a: unknown[]
      ) => Intl.DateTimeFormat
    )(...args)
    const resolved = formatter.resolvedOptions.bind(formatter)
    formatter.resolvedOptions = () => ({ ...resolved(), timeZone: zone })
    return formatter
  }) as unknown as typeof Intl.DateTimeFormat)

  try {
    return fn()
  } finally {
    spy.mockRestore()
  }
}

it('every manifest defaultData() is pure — no minted ids, no ambient reads', () => {
  const first = withAmbientZone(ZONE_A, () =>
    listManifests().map((manifest) => ({ id: manifest.id, data: manifest.defaultData() }))
  )
  const second = withAmbientZone(ZONE_B, () =>
    listManifests().map((manifest) => ({ id: manifest.id, data: manifest.defaultData() }))
  )

  const offenders = first
    .filter((entry, index) => !isDeepStrictEqual(entry.data, second[index]?.data))
    .map((entry) => entry.id)

  expect(offenders).toEqual([])
})
