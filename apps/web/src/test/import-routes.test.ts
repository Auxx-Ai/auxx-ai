// apps/web/src/test/import-routes.test.ts

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP_DIR = join(process.cwd(), 'src/app/(protected)/app')

/**
 * Every records page must ship an import route.
 *
 * 🛑 `RecordsView` renders the Import menu unconditionally at
 * `${basePath}/import`. A resource that owns `[recordId]/page.tsx` but no
 * `import/` folder does not 404 — the detail route swallows the segment and the
 * page reads "Record not found", because `import` is taken for a record id.
 * That is exactly what happened to orders, products, purchase orders, vendor
 * bills and builds: each was added without the two route files, and the bug
 * only surfaced when someone clicked Import.
 */
describe('import routes', () => {
  const recordsPages = readdirSync(APP_DIR).filter((entry) => {
    const dir = join(APP_DIR, entry)
    if (!statSync(dir).isDirectory()) return false
    try {
      return readFileSync(join(dir, 'page.tsx'), 'utf8').includes('<RecordsView')
    } catch {
      return false
    }
  })

  it('finds the records pages', () => {
    expect(recordsPages.length).toBeGreaterThan(5)
  })

  it.each(recordsPages)('%s has an import route', (slug) => {
    const importDir = join(APP_DIR, slug, 'import')
    expect(statSync(join(importDir, 'page.tsx')).isFile()).toBe(true)
    expect(statSync(join(importDir, '[jobId]', 'page.tsx')).isFile()).toBe(true)
  })
})
