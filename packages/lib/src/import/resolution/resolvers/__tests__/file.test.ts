// packages/lib/src/import/resolution/resolvers/__tests__/file.test.ts

import { describe, expect, it } from 'vitest'
import { resolveFileUrl } from '../file'

describe('resolveFileUrl', () => {
  it('marks a plain image URL for download', () => {
    const url = 'https://cdn.example.com/p/1.jpg'
    expect(resolveFileUrl(url, {})).toEqual({ type: 'create', value: url, fileFetch: { url } })
  })

  it('treats a blank cell as no value', () => {
    expect(resolveFileUrl('   ', {})).toEqual({ type: 'value', value: null })
  })

  it('rewrites Dropbox and Drive share links to their direct form', () => {
    const dropbox = resolveFileUrl('https://www.dropbox.com/s/abc/pic.png?dl=0', {})
    expect(dropbox.fileFetch?.url).toBe('https://www.dropbox.com/s/abc/pic.png?raw=1')

    const drive = resolveFileUrl('https://drive.google.com/file/d/FILEID123/view?usp=sharing', {})
    expect(drive.fileFetch?.url).toBe('https://drive.google.com/uc?export=download&id=FILEID123')
  })

  // An unusable URL never blocks the record: a warning, no value, nothing to download.
  const expectSkipped = (cell: string) => {
    const resolved = resolveFileUrl(cell, {})
    expect(resolved.type).toBe('warning')
    expect(resolved.value).toBeNull()
    expect(resolved.fileFetch).toBeUndefined()
    expect(resolved.warning).toContain('image skipped')
  }

  it('skips non-http schemes and garbage with a warning', () => {
    expectSkipped('ftp://example.com/a.jpg')
    expectSkipped('file:///etc/passwd')
    expectSkipped('not a url')
  })

  it('skips IP-literal hosts in blocked ranges with a warning', () => {
    expectSkipped('http://169.254.169.254/latest/meta-data')
    expectSkipped('http://10.0.0.5/a.png')
    expectSkipped('http://[fd00::1]/a.png')
  })

  it('keeps the first of several URLs and warns', () => {
    for (const cell of [
      'https://a.com/1.jpg, https://a.com/2.jpg',
      'https://a.com/1.jpg | https://a.com/2.jpg',
      'https://a.com/1.jpg;https://a.com/2.jpg',
    ]) {
      const resolved = resolveFileUrl(cell, {})
      expect(resolved.type).toBe('warning')
      expect(resolved.warning).toBe('Only the first image is used')
      expect(resolved.fileFetch).toEqual({ url: 'https://a.com/1.jpg' })
    }
  })

  it('does not split a CDN transform path on its commas', () => {
    const url = 'https://res.cloudinary.com/demo/image/upload/w_100,h_100/sample.jpg'
    expect(resolveFileUrl(url, {})).toEqual({ type: 'create', value: url, fileFetch: { url } })
  })
})
