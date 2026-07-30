// apps/web/src/components/icons/__tests__/brands.test.ts

import fs from 'node:fs'
import path from 'node:path'
// Deep source import on purpose: the catalog is pure data; the @auxx/lib/ai/mcp barrel
// would drag server-only modules (db, queues) into jsdom.
import { mcpTemplates } from '@auxx/lib/ai/mcp/templates/catalog'
import { describe, expect, it } from 'vitest'
import { APP_ROOT } from '../../../test/app-root'
import { BRAND_ICONS } from '../brands'

const BRANDS_DIR = path.resolve(APP_ROOT, 'public/icons/brands')

const files = fs.readdirSync(BRANDS_DIR).filter((f) => f.endsWith('.svg'))
const baseFiles = files.filter((f) => !f.endsWith('-dark.svg'))
const darkFiles = files.filter((f) => f.endsWith('-dark.svg'))

describe('brand icon manifest ↔ files ↔ catalog', () => {
  it('every manifest slug has a base svg on disk', () => {
    for (const slug of Object.keys(BRAND_ICONS)) {
      expect(baseFiles, `missing public/icons/brands/${slug}.svg`).toContain(`${slug}.svg`)
    }
  })

  it('every base svg on disk is listed in the manifest', () => {
    for (const file of baseFiles) {
      const slug = file.replace(/\.svg$/, '')
      expect(BRAND_ICONS, `unlisted brand file ${file} — add it to brands.ts`).toHaveProperty(slug)
    }
  })

  it('dark variants on disk match hasDark flags (both directions)', () => {
    const darkSlugsOnDisk = new Set(darkFiles.map((f) => f.replace(/-dark\.svg$/, '')))
    for (const [slug, { hasDark }] of Object.entries(BRAND_ICONS)) {
      expect(
        darkSlugsOnDisk.has(slug),
        `${slug}: hasDark=${hasDark} but ${slug}-dark.svg ${hasDark ? 'missing' : 'exists'}`
      ).toBe(hasDark)
    }
    for (const slug of darkSlugsOnDisk) {
      expect(
        BRAND_ICONS,
        `stray dark variant ${slug}-dark.svg without manifest entry`
      ).toHaveProperty(slug)
    }
  })

  it('every brand: ref in the MCP template catalog exists in the manifest', () => {
    for (const template of mcpTemplates) {
      const iconId = template.icon?.iconId
      if (!iconId?.startsWith('brand:')) continue
      const slug = iconId.slice('brand:'.length)
      expect(BRAND_ICONS, `template "${template.id}" references unknown ${iconId}`).toHaveProperty(
        slug
      )
    }
  })

  it('brand svgs have a viewBox and no fixed root width/height', () => {
    for (const file of files) {
      const svg = fs.readFileSync(path.join(BRANDS_DIR, file), 'utf8')
      const root = svg.match(/<svg[^>]*>/)?.[0] ?? ''
      expect(root, `${file} root must declare a viewBox`).toMatch(/viewBox="/)
      expect(
        root,
        `${file} root must not fix width/height (sized by entityIconVariants)`
      ).not.toMatch(/\s(width|height)="/)
    }
  })
})
