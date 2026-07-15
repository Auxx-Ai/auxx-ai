// packages/lib/src/placeholders/format-codec.test.ts

import { describe, expect, it } from 'vitest'
import {
  decodePlaceholderFormat,
  encodePlaceholderFormat,
  getPlaceholderFormatOptions,
  normalizePlaceholderFormat,
} from './format-codec'

describe('placeholder format codec', () => {
  it('round-trips standard field options for a matching field type', () => {
    const encoded = encodePlaceholderFormat({
      v: 1,
      t: 'TIME',
      o: { timeFormat: '24h' },
    })
    const payload = decodePlaceholderFormat(encoded)

    expect(payload).toEqual({ v: 1, t: 'TIME', o: { timeFormat: '24h' } })
    expect(getPlaceholderFormatOptions(payload, 'TIME')).toEqual({ timeFormat: '24h' })
    expect(getPlaceholderFormatOptions(payload, 'DATE')).toBeUndefined()
  })

  it('does not allow a placeholder to override resolver-owned timezone metadata', () => {
    const payload = decodePlaceholderFormat(
      JSON.stringify({
        v: 1,
        t: 'TIME',
        o: { timeFormat: '24h', timeZone: 'Pacific/Honolulu' },
      })
    )

    expect(payload).toEqual({ v: 1, t: 'TIME', o: { timeFormat: '24h' } })
    expect(
      normalizePlaceholderFormat({
        v: 1,
        t: 'TIME',
        o: { timeFormat: '24h', timeZone: 'Pacific/Honolulu' },
      })
    ).toEqual({ v: 1, t: 'TIME', o: { timeFormat: '24h' } })
  })

  it('rejects malformed and unsupported formatting payloads', () => {
    expect(decodePlaceholderFormat('{')).toBeNull()
    expect(decodePlaceholderFormat(JSON.stringify({ v: 1, t: 'ACTOR', o: {} }))).toBeNull()
  })
})
