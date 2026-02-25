// scripts/ci/check-package-exports.js
// Validates that every export path in @auxx/* package.json files points to an existing source file.
// Also checks for disallowed deep imports into package internals.

import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')
const PACKAGES_DIR = join(ROOT, 'packages')

// Packages that use auto-generated exports (checked separately)
const SKIP_PACKAGES = new Set(['lib', 'sdk', 'typescript-config', 'ui', 'seed'])

// Disallowed deep import patterns (checked across all consumer files)
const DISALLOWED_IMPORTS = [/@auxx\/database\/schema\//, /@auxx\/database\/db\//]

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
          for (const line of lines) {
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
  if (SKIP_PACKAGES.has(entry.name)) continue

  const pkgDir = join(PACKAGES_DIR, entry.name)
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (!existsSync(pkgJsonPath)) continue

  const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
  await checkPackageExports(pkgDir, pkgJson.name || entry.name)
}

await checkDisallowedImports()

if (errors > 0) {
  console.error(`\n${errors} export validation error(s) found.`)
  process.exit(1)
} else {
  console.log('All package exports validated successfully.')
}
