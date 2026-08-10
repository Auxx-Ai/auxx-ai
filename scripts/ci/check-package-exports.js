// scripts/ci/check-package-exports.js
// Validates that every export path in @auxx/* package.json files points to an existing source file.
// Also checks for disallowed deep imports into package internals.
// Also validates that published packages don't reference workspace-only @auxx/* deps in their dist/.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const PACKAGES_DIR = join(ROOT, 'packages')

// Packages that use auto-generated exports (checked separately)
const SKIP_PACKAGES = new Set(['lib', 'sdk', 'typescript-config', 'ui', 'seed', 'chat'])

// Disallowed deep import patterns (checked across all consumer files)
const DISALLOWED_IMPORTS = [/@auxx\/database\/schema\//, /@auxx\/database\/db\//]

// The one legitimate reason to reach past the exports map: a test that needs the REAL
// Drizzle tables. `src/test/setup.ts` mocks `@auxx/database` with a Proxy handing back
// `{}` per table, so column-level introspection is impossible through it — and
// `vi.importActual('@auxx/database')` is not an option either, because the package index
// evaluates `db/client`, whose top-level `createDatabase()` opens a `pg.Pool` at import.
// The schema barrel is pure table declarations. Narrow on purpose: test files only, and
// only through `importActual` — production code bypassing the exports map still errors.
const DEEP_IMPORT_EXEMPT_FILE = /\.(test|spec)\.tsx?$/
const DEEP_IMPORT_EXEMPT_LINE = /\bvi\.importActual\b/

// @auxx/* packages that are NOT published to npm. If any of these appear inside
// a published package's dist/, the customer install will 404. Add a new entry
// here when a new private @auxx/* package gets created.
const WORKSPACE_ONLY_PACKAGES = [
  '@auxx/ui',
  '@auxx/lib',
  '@auxx/database',
  '@auxx/services',
  '@auxx/types',
  '@auxx/config',
  '@auxx/credentials',
  '@auxx/redis',
  '@auxx/email',
  '@auxx/billing',
  '@auxx/seed',
  '@auxx/logger',
  '@auxx/deployment',
  '@auxx/utils',
  '@auxx/workflow-nodes',
  '@auxx/typescript-config',
]

let errors = 0

async function checkPackageExports(pkgDir, pkgName) {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return

  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
  const exports = pkgJson.exports
  if (!exports) return

  for (const [exportPath, value] of Object.entries(exports)) {
    // Skip wildcard exports
    if (exportPath.includes('*')) continue

    // Resolve the source path from the "types" or "default" condition
    let sourcePath
    if (typeof value === 'string') {
      sourcePath = value
    } else if (typeof value === 'object') {
      sourcePath = value.types || value.default
    }

    if (!sourcePath) continue

    const fullPath = join(pkgDir, sourcePath)
    if (!existsSync(fullPath)) {
      console.error(`ERROR: ${pkgName} export "${exportPath}" -> "${sourcePath}" does not exist`)
      errors++
    }
  }
}

async function checkPublishedDistLeakage(pkgDir, pkgName) {
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) return

  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
  if (!pkgJson.publishConfig) return

  const distDir = join(pkgDir, 'dist')
  // Silently skip when dist isn't built — the publish workflow always builds
  // before running this check, and we don't want noisy warnings on every
  // local/CI run where the publishable packages weren't built.
  if (!existsSync(distDir)) return

  async function walk(dir) {
    const out = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) out.push(...(await walk(full)))
      else if (/\.(js|mjs|cjs|d\.ts)$/.test(entry.name)) out.push(full)
    }
    return out
  }

  const files = await walk(distDir)
  for (const file of files) {
    const content = await readFile(file, 'utf-8')
    for (const forbidden of WORKSPACE_ONLY_PACKAGES) {
      if (forbidden === pkgName) continue
      // Match real imports/requires, not doc-comment mentions in shim files.
      const importRe = new RegExp(
        `(?:from\\s+['"\`]|require\\(['"\`]|import\\(['"\`])${forbidden.replace('/', '\\/')}(?:['"\`]|\\/)`,
        'g'
      )
      if (importRe.test(content)) {
        const rel = file.replace(ROOT + '/', '')
        console.error(
          `ERROR: published package ${pkgName} dist references workspace-only ${forbidden}: ${rel}`
        )
        errors++
      }
    }
  }
}

async function checkDisallowedImports() {
  // Check source files for disallowed deep imports
  const dirsToCheck = ['apps', 'packages']

  for (const dir of dirsToCheck) {
    const fullDir = join(ROOT, dir)
    if (!existsSync(fullDir)) continue

    const { execSync } = await import('node:child_process')
    for (const pattern of DISALLOWED_IMPORTS) {
      try {
        const result = execSync(
          `grep -r "${pattern.source}" "${fullDir}" --include="*.ts" --include="*.tsx" -l` +
            ` | grep -v node_modules | grep -v /dist/ | grep -v ".d.ts"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
        )
        const files = result.trim().split('\n').filter(Boolean)
        // Filter out commented imports
        for (const file of files) {
          const content = await readFile(file, 'utf-8')
          const lines = content.split('\n')
          const isTestFile = DEEP_IMPORT_EXEMPT_FILE.test(file)
          for (const line of lines) {
            if (isTestFile && DEEP_IMPORT_EXEMPT_LINE.test(line)) continue
            if (line.match(pattern) && !line.trimStart().startsWith('//')) {
              const relFile = file.replace(ROOT + '/', '')
              console.error(`ERROR: Disallowed deep import in ${relFile}: ${line.trim()}`)
              errors++
            }
          }
        }
      } catch {
        // grep returns exit code 1 when no matches found — that's expected
      }
    }
  }
}

// Main
const packageDirs = await readdir(PACKAGES_DIR, { withFileTypes: true })
for (const entry of packageDirs) {
  if (!entry.isDirectory()) continue

  const pkgDir = join(PACKAGES_DIR, entry.name)
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) continue

  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
  const pkgName = pkgJson.name || entry.name

  if (!SKIP_PACKAGES.has(entry.name)) {
    await checkPackageExports(pkgDir, pkgName)
  }
  // Dist leakage check runs for every publishable package, including skipped ones.
  await checkPublishedDistLeakage(pkgDir, pkgName)
}

await checkDisallowedImports()

if (errors > 0) {
  console.error(`\n${errors} export validation error(s) found.`)
  process.exit(1)
} else {
  console.log('All package exports validated successfully.')
}
