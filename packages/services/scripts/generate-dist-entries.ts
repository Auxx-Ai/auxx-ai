import fs from 'node:fs'
import path from 'node:path'

const DIST = path.resolve(process.cwd(), 'dist')

// If you want to skip some dirs (e.g., "internal"), add them here:
const SKIP = new Set<string>([])

// accept index.js / index.mjs / index.cjs
const INDEX_BASENAMES = new Set(['index.js', 'index.mjs', 'index.cjs'])

function* walk(dir: string): Generator<string> {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      yield* walk(full)
    } else if (e.isFile() && INDEX_BASENAMES.has(e.name)) {
      yield path.dirname(full)
    }
  }
}

function writeIfChanged(file: string, content: string) {
  if (fs.existsSync(file)) {
    const current = fs.readFileSync(file, 'utf8')
    if (current === content) return false
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true })
  }
  fs.writeFileSync(file, content, 'utf8')
  return true
}

function main() {
  if (!fs.existsSync(DIST)) {
    console.error(`[gen] dist/ does not exist. Did tsc run?`)
    process.exitCode = 1
    return
  }

  let count = 0
  for (const dirAbs of walk(DIST)) {
    const rel = path.relative(DIST, dirAbs) // can be nested: "apps/admin"
    const top = rel.split(path.sep)[0]
    if (SKIP.has(top)) {
      console.log(`[gen] skip ${rel}`)
      continue
    }

    // Create a shim next to dist root: dist/apps.js, dist/apps/admin.js, etc.
    const jsShim = path.join(DIST, `${rel}.js`)
    const dtsShim = path.join(DIST, `${rel}.d.ts`)

    // pick the actual file we found (index.js|mjs|cjs)
    const found = fs.readdirSync(dirAbs).find((n) => INDEX_BASENAMES.has(n))
    if (!found) continue

    const importJs = `./${rel}/${found}`.replace(/\\/g, '/')
    const importTypes = `./${rel}/index`.replace(/\\/g, '/') // .d.ts will be resolved by TS

    const jsContent = `export * from '${importJs}';\n`
    const dtsContent = `export * from '${importTypes}';\n`

    const wroteJs = writeIfChanged(jsShim, jsContent)
    const wroteDts = writeIfChanged(dtsShim, dtsContent)
    if (wroteJs || wroteDts) {
      console.log(`[gen] shim for ${rel} -> ${path.relative(DIST, jsShim)}`)
      count++
    }
  }

  if (count === 0) {
    console.warn(
      `[gen] no shims created. Did you expect folder imports? Make sure those folders have an index.(js|mjs|cjs)`
    )
  }
}

main()
