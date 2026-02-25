// packages/lib/scripts/generate-exports.ts

import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(process.cwd(), '../..')
const SRC = path.resolve(process.cwd(), 'src')
const PKG_PATH = path.resolve(process.cwd(), 'package.json')
const CHECK_MODE = process.argv.includes('--check')

// Known dead imports that can't be fixed immediately.
// Each must have a comment explaining why it's allowed.
const UNRESOLVED_ALLOWLIST = new Set<string>([
  // (empty — all previously dead imports have been fixed)
])

const SCAN_DIRS = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'build', 'coverage'])

function extractLibImports(sourceText: string, fileName: string): string[] {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false)
  const imports: string[] = []

  function visit(node: ts.Node) {
    // Static: import { X } from '@auxx/lib/foo'
    // Static: export { X } from '@auxx/lib/foo'
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const spec = node.moduleSpecifier.text
      if (spec.startsWith('@auxx/lib/')) {
        imports.push(spec.slice('@auxx/lib/'.length))
      }
    }

    // Dynamic: import('@auxx/lib/foo')
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const spec = node.arguments[0].text
      if (spec.startsWith('@auxx/lib/')) {
        imports.push(spec.slice('@auxx/lib/'.length))
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sf)
  return imports
}

function scanConsumerImports(): Set<string> {
  const imports = new Set<string>()

  function walk(dir: string) {
    const base = path.basename(dir)
    if (SKIP_DIRS.has(base)) return
    // Don't scan packages/lib itself
    if (path.resolve(dir) === path.resolve(ROOT, 'packages/lib')) return

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
        const content = fs.readFileSync(full, 'utf8')
        for (const imp of extractLibImports(content, entry.name)) {
          imports.add(imp)
        }
      }
    }
  }

  for (const dir of SCAN_DIRS) {
    if (fs.existsSync(dir)) walk(dir)
  }

  return imports
}

function resolveSubpath(subpath: string): string | null {
  const clean = subpath.replace(/\.tsx?$/, '')

  const asFile = path.join(SRC, `${clean}.ts`)
  if (fs.existsSync(asFile)) return `./src/${clean}.ts`

  const asTsx = path.join(SRC, `${clean}.tsx`)
  if (fs.existsSync(asTsx)) return `./src/${clean}.tsx`

  const asIndex = path.join(SRC, clean, 'index.ts')
  if (fs.existsSync(asIndex)) return `./src/${clean}/index.ts`

  return null
}

function toDistPath(srcPath: string): string {
  return srcPath.replace(/^\.\/src\//, './dist/').replace(/\.tsx?$/, '.js')
}

function main() {
  const rawImports = scanConsumerImports()

  const exportsObj: Record<string, unknown> = {
    '.': {
      types: './src/index.ts',
      import: './dist/index.js',
      default: './src/index.ts',
    },
  }

  const resolved: [string, string][] = []
  const unresolved: string[] = []

  for (const subpath of rawImports) {
    const srcPath = resolveSubpath(subpath)
    if (srcPath) {
      resolved.push([`./${subpath.replace(/\.tsx?$/, '')}`, srcPath])
    } else if (!UNRESOLVED_ALLOWLIST.has(subpath)) {
      unresolved.push(subpath)
    }
  }

  // Fail hard on unexpected unresolved imports
  if (unresolved.length > 0) {
    console.error(`[generate-exports] ERROR: ${unresolved.length} unresolvable import(s):`)
    for (const u of unresolved.sort()) {
      console.error(`  @auxx/lib/${u}`)
    }
    console.error(
      '\nEither fix the import, create the source file, or add to UNRESOLVED_ALLOWLIST with a comment.'
    )
    process.exit(1)
  }

  resolved.sort(([a], [b]) => a.localeCompare(b))

  for (const [subpath, srcPath] of resolved) {
    exportsObj[subpath] = {
      types: srcPath,
      import: toDistPath(srcPath),
      default: srcPath,
    }
  }

  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'))

  if (CHECK_MODE) {
    const current = JSON.stringify(pkg.exports, null, 2)
    const generated = JSON.stringify(exportsObj, null, 2)
    if (current !== generated) {
      console.error(
        '[generate-exports] exports are out of date. Run: pnpm -F @auxx/lib generate:exports'
      )
      process.exit(1)
    }
    console.log(`[generate-exports] exports up to date (${Object.keys(exportsObj).length} entries)`)
    return
  }

  pkg.exports = exportsObj
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
  console.log(`[generate-exports] wrote ${Object.keys(exportsObj).length} exports`)
}

main()
