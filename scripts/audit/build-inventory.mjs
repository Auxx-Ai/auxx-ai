// scripts/audit/build-inventory.mjs
/**
 * Builds the code-cleanup surface inventory.
 *
 * A "surface" is the unit of cleanup decision — a lib module, a tRPC router, a
 * route group, a UI component family. Findings are attributed to surfaces so we
 * review ~250 areas instead of ~50k symbols.
 *
 * Emits:
 *   plans/cleanup/code/inventory.jsonl  — one JSON object per surface (machine)
 *   plans/cleanup/code/inventory.md     — triage-ordered tables (human)
 *
 * Usage: node scripts/audit/build-inventory.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT_DIR = path.join(REPO, 'plans/cleanup/code')

const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs'])

/**
 * Surface rules, most-specific root first. `depth: 1` means each child of the
 * root (dir or file) is its own surface.
 *
 * `entrypoint: true` marks surfaces that are invoked by a framework/runtime
 * rather than imported (Next routes, express routes, workers, scripts). Their
 * importer count is structurally 0 and must NOT count as a dead-code signal.
 */
const RULES = [
  { root: 'packages/lib/src', depth: 1, kind: 'lib-module' },
  { root: 'packages/services/src', depth: 1, kind: 'services-module' },
  { root: 'packages/ui/src/components', depth: 1, kind: 'ui-component' },
  { root: 'packages/ui/src/lib', depth: 1, kind: 'ui-lib' },
  { root: 'packages/ui/src/hooks', depth: 1, kind: 'ui-lib' },
  { root: 'packages/database/src/db/schema', depth: 1, kind: 'db-schema' },
  { root: 'packages/database/src/db/models', depth: 1, kind: 'db-model' },
  { root: 'packages/chat/src/views', depth: 1, kind: 'chat-view' },
  { root: 'packages/chat/src', depth: 1, kind: 'chat-module' },
  { root: 'packages/workflow-nodes/src', depth: 1, kind: 'workflow-node' },
  { root: 'packages/email/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/billing/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/sdk/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/utils/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/types/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/credentials/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/redis/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/config/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/logger/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/deployment/src', depth: 1, kind: 'pkg-module' },
  { root: 'packages/seed/src', depth: 1, kind: 'seed-module', entrypoint: true },

  { root: 'apps/web/src/server/api/routers', depth: 1, kind: 'trpc-router' },
  { root: 'apps/web/src/components', depth: 1, kind: 'web-component' },
  { root: 'apps/web/src/app/(protected)/app', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/app/(protected)', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/app/(auth)', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/app/(public)', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/app/api', depth: 1, kind: 'web-route-api', entrypoint: true },
  { root: 'apps/web/src/app/admin', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/app', depth: 1, kind: 'web-route', entrypoint: true },
  { root: 'apps/web/src/hooks', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/lib', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/stores', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/utils', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/providers', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/realtime', depth: 1, kind: 'web-lib' },
  { root: 'apps/web/src/server', depth: 1, kind: 'web-server' },

  { root: 'apps/worker/scripts', depth: 1, kind: 'dev-script', entrypoint: true },
  { root: 'packages/lib/scripts', depth: 1, kind: 'dev-script', entrypoint: true },
  { root: 'packages/database/scripts', depth: 1, kind: 'dev-script', entrypoint: true },
  { root: 'scripts', depth: 1, kind: 'repo-script', entrypoint: true },

  { root: 'apps/api/src/routes', depth: 1, kind: 'api-route', entrypoint: true },
  { root: 'apps/api/src', depth: 1, kind: 'api-module' },
  { root: 'apps/worker/src/workers', depth: 1, kind: 'worker-job', entrypoint: true },
  { root: 'apps/worker/src', depth: 1, kind: 'worker-module', entrypoint: true },
  { root: 'apps/build/src/server/api/routers', depth: 1, kind: 'trpc-router' },
  { root: 'apps/build/src/components', depth: 1, kind: 'build-component' },
  { root: 'apps/build/src/app', depth: 1, kind: 'build-route', entrypoint: true },
  { root: 'apps/kb/src', depth: 1, kind: 'kb-module', entrypoint: true },
  { root: 'apps/homepage/src', depth: 1, kind: 'homepage-module', entrypoint: true },
  { root: 'apps/lambda/src', depth: 1, kind: 'lambda-module', entrypoint: true },
  { root: 'apps/extension/src', depth: 1, kind: 'extension-module', entrypoint: true },
  { root: 'apps/mail-ingress/src', depth: 1, kind: 'mail-ingress', entrypoint: true },
  { root: 'apps/echtzeit/src', depth: 1, kind: 'echtzeit-module', entrypoint: true },
]

const SKIP_PREFIX = [
  'node_modules/',
  'dist/',
  '.next/',
  '.turbo/',
  'packages/e2e/',
  'packages/test-utils/',
  'packages/typescript-config/',
  'infra/',
  'apps/docs/',
]

// ---------------------------------------------------------------------------
// 1. File list
// ---------------------------------------------------------------------------

const git = (args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 })

const allFiles = git(['ls-files'])
  .split('\n')
  .filter(Boolean)
  .filter((f) => CODE_EXT.has(path.extname(f)))
  .filter((f) => !SKIP_PREFIX.some((p) => f.startsWith(p)))
  .filter((f) => !f.includes('/node_modules/') && !f.includes('/dist/'))
  // Only real source trees — drops vitest/tsdown/next configs and *-env.d.ts,
  // which are tool-invoked and would otherwise pile into `*misc*` surfaces.
  .filter((f) => /^(apps|packages)\/[^/]+\/(src|scripts)\//.test(f) || /^scripts\//.test(f))
  // Ambient declarations are not code anyone imports.
  .filter((f) => !f.endsWith('.d.ts'))

// ---------------------------------------------------------------------------
// 2. Surfaces
// ---------------------------------------------------------------------------

/** @type {Map<string, {id:string,kind:string,root:string,dir:string,entrypoint:boolean,files:string[],lines:number}>} */
const surfaces = new Map()
/** @type {Map<string, string>} surfaceRootDir -> surfaceId, for prefix lookup */
const surfaceByDir = new Map()

function surfaceIdFor(file) {
  // Any package's own scripts/ dir — dev/ops scripts, invoked by hand or CI.
  const scriptMatch = file.match(/^((?:apps|packages)\/[^/]+\/scripts)\/(.+)$/)
  if (scriptMatch) {
    const seg = scriptMatch[2].split('/')[0]
    const isFile = scriptMatch[2] === seg
    return {
      id: `${scriptMatch[1]}/${isFile ? seg.replace(/\.[^.]+$/, '') : seg}`,
      kind: 'dev-script',
      root: scriptMatch[1],
      dir: `${scriptMatch[1]}/${seg}`,
      entrypoint: true,
      isFile,
    }
  }
  for (const rule of RULES) {
    if (!file.startsWith(`${rule.root}/`)) continue
    const rest = file.slice(rule.root.length + 1)
    const seg = rest.split('/')[0]
    if (!seg) continue
    // a bare file directly under the root is its own surface (strip extension)
    const isFile = rest === seg
    const name = isFile ? seg.replace(/\.[^.]+$/, '') : seg
    return {
      id: `${rule.root}/${name}`,
      kind: rule.kind,
      root: rule.root,
      dir: `${rule.root}/${seg}`,
      // A bare file directly under a package's src/ is a bootstrap or public
      // barrel (index.ts, server.ts, main.tsx, the CLI bin) — it is a build
      // input or an export-map target, not something internal code imports.
      // Known blind spot: a genuinely dead top-level file hides here.
      entrypoint:
        Boolean(rule.entrypoint) || (isFile && /^(apps|packages)\/[^/]+\/src$/.test(rule.root)),
      isFile,
    }
  }
  // fallback: package-level surface
  const m = file.match(/^((?:apps|packages)\/[^/]+)\//)
  if (m) {
    return {
      id: `${m[1]}/*misc*`,
      kind: 'misc',
      root: m[1],
      dir: m[1],
      entrypoint: false,
      isFile: false,
    }
  }
  return { id: 'root/*misc*', kind: 'misc', root: '.', dir: '.', entrypoint: false, isFile: false }
}

const fileToSurface = new Map()

const isTestFile = (f) =>
  /(^|\/)(__tests__|__integration__|__mocks__|test|tests)\//.test(f) ||
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(f)

/** Strip test scaffolding so a test maps to the surface it exercises. */
const toProdPath = (f) =>
  f
    .replace(/(^|\/)(__tests__|__integration__|__mocks__|tests?)\//g, '$1')
    .replace(/\.(test|spec)\.([cm]?[jt]sx?)$/, '.$2')

const lineCount = (file) => {
  try {
    return readFileSync(path.join(REPO, file), 'utf8').split('\n').length
  } catch {
    return 0
  }
}

function ensureSurface(s) {
  let entry = surfaces.get(s.id)
  if (!entry) {
    entry = {
      id: s.id,
      kind: s.kind,
      root: s.root,
      dir: s.dir,
      entrypoint: s.entrypoint,
      files: [],
      lines: 0,
      testFiles: [],
      testLines: 0,
    }
    surfaces.set(s.id, entry)
    surfaceByDir.set(s.dir, s.id)
  }
  return entry
}

const prodFiles = allFiles.filter((f) => !isTestFile(f))
const testFiles = allFiles.filter(isTestFile)

// Pass 1 — production files define the surfaces.
for (const file of prodFiles) {
  const entry = ensureSurface(surfaceIdFor(file))
  fileToSurface.set(file, entry.id)
  entry.files.push(file)
  entry.lines += lineCount(file)
}

// Pass 2 — tests attach to the surface they cover; they never form their own.
for (const file of testFiles) {
  const entry = ensureSurface(surfaceIdFor(toProdPath(file)))
  fileToSurface.set(file, entry.id)
  entry.testFiles.push(file)
  entry.testLines += lineCount(file)
}

// ---------------------------------------------------------------------------
// 3. Package export maps (@auxx/* subpath -> source file)
// ---------------------------------------------------------------------------

/** @type {Map<string, {dir:string, exports:Record<string,string>}>} */
const pkgExports = new Map()

for (const pkgJson of git(['ls-files', '*/package.json']).split('\n').filter(Boolean)) {
  if (pkgJson.includes('node_modules')) continue
  let json
  try {
    json = JSON.parse(readFileSync(path.join(REPO, pkgJson), 'utf8'))
  } catch {
    continue
  }
  if (!json.name?.startsWith('@auxx/')) continue
  const dir = path.dirname(pkgJson)
  const map = {}
  const pick = (v) => {
    if (typeof v === 'string') return v
    if (v && typeof v === 'object') return v.source ?? v.types ?? v.default ?? v.import
    return undefined
  }
  for (const [sub, val] of Object.entries(json.exports ?? {})) {
    const target = pick(val)
    if (typeof target === 'string') map[sub] = target
  }
  if (!Object.keys(map).length) {
    const main = json.source ?? json.main ?? 'src/index.ts'
    map['.'] = main
  }
  pkgExports.set(json.name, { dir, exports: map })
}

/**
 * Surfaces that a package's `exports` map points at — the package's public API.
 * These are reached across the package boundary by consumers, so "no importers"
 * says nothing about them.
 *
 * Note: `@auxx/lib`'s exports map is itself codegen'd by scanning consumer
 * imports (`packages/lib/scripts/generate-exports.ts`), so a lib subpath being
 * present is already evidence that something imports it.
 */
const publicApiSurfaces = new Set()
for (const [, pkg] of pkgExports) {
  for (const [key, target] of Object.entries(pkg.exports)) {
    if (target.includes('*')) continue
    const candidates = [path.posix.normalize(path.posix.join(pkg.dir, target))]
    // Packages that publish only `dist/` paths (no `source` condition) can't be
    // mapped back through the target — fall back to the subpath itself.
    if (key !== '.') candidates.push(path.posix.join(pkg.dir, 'src', key.slice(2)))
    for (const c of candidates) {
      const sid = tryResolve(c) && fileToSurface.get(tryResolve(c))
      if (sid) publicApiSurfaces.add(sid)
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Import extraction + resolution
// ---------------------------------------------------------------------------

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"]([^'"\n]+)['"]/g

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function tryResolve(abs) {
  // ESM-style specifiers point at `./foo.js` while the source is `foo.ts`.
  const jsless = abs.replace(/\.(js|jsx|mjs)$/, '')
  const cands = [
    abs,
    `${jsless}.ts`,
    `${jsless}.tsx`,
    `${jsless}.mts`,
    `${abs}.ts`,
    `${abs}.tsx`,
    `${abs}.mts`,
    `${abs}.js`,
    `${abs}.jsx`,
    `${abs}/index.ts`,
    `${abs}/index.tsx`,
    `${abs}/index.js`,
  ]
  for (const c of cands) {
    if (existsSync(path.join(REPO, c)) && statSync(path.join(REPO, c)).isFile()) return c
  }
  return null
}

/** package root of a repo-relative file, e.g. apps/web */
function pkgRootOf(file) {
  const m = file.match(/^((?:apps|packages)\/[^/]+)\//)
  return m ? m[1] : null
}

function resolveSpecifier(spec, fromFile) {
  if (spec.startsWith('.')) {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
    return tryResolve(abs)
  }
  if (spec.startsWith('~/') || spec.startsWith('@/')) {
    const root = pkgRootOf(fromFile)
    if (!root) return null
    return tryResolve(path.posix.join(root, 'src', spec.slice(2)))
  }
  if (spec.startsWith('@auxx/')) {
    const parts = spec.split('/')
    const name = `${parts[0]}/${parts[1]}`
    const pkg = pkgExports.get(name)
    if (!pkg) return null
    const sub = parts.length > 2 ? `./${parts.slice(2).join('/')}` : '.'
    let target = pkg.exports[sub]
    if (!target) {
      // wildcard exports, e.g. "./lib/*": "./src/lib/*.ts"
      for (const [k, v] of Object.entries(pkg.exports)) {
        if (!k.includes('*')) continue
        const [pre, post] = k.split('*')
        if (sub.startsWith(pre) && sub.endsWith(post ?? '')) {
          const star = sub.slice(pre.length, sub.length - (post ?? '').length)
          target = v.replace('*', star)
          break
        }
      }
    }
    if (!target) return tryResolve(path.posix.join(pkg.dir, 'src', parts.slice(2).join('/')))
    return tryResolve(path.posix.normalize(path.posix.join(pkg.dir, target)))
  }
  return null
}

/** surfaceId -> Set of importing production files outside the surface */
const importersBySurface = new Map()
/** surfaceId -> Set of importing test files outside the surface */
const testImportersBySurface = new Map()
/** surfaceId -> Set of importing surfaces (production only) */
const importerSurfaces = new Map()
/** surfaceId -> Set of surfaces it imports from */
const importsBySurface = new Map()
let unresolvedInternal = 0
let resolvedEdges = 0

for (const file of allFiles) {
  let src
  try {
    src = stripComments(readFileSync(path.join(REPO, file), 'utf8'))
  } catch {
    continue
  }
  const own = fileToSurface.get(file)
  IMPORT_RE.lastIndex = 0
  let m
  const seen = new Set()
  while ((m = IMPORT_RE.exec(src))) {
    const spec = m[1]
    if (seen.has(spec)) continue
    seen.add(spec)
    const isInternal =
      spec.startsWith('.') ||
      spec.startsWith('~/') ||
      spec.startsWith('@/') ||
      spec.startsWith('@auxx/')
    if (!isInternal) continue
    const target = resolveSpecifier(spec, file)
    if (!target) {
      unresolvedInternal++
      continue
    }
    resolvedEdges++
    const targetSurface = fileToSurface.get(target)
    if (!targetSurface || targetSurface === own) continue
    if (isTestFile(file)) {
      // A test-only consumer proves the code compiles, not that anything uses it.
      if (!testImportersBySurface.has(targetSurface))
        testImportersBySurface.set(targetSurface, new Set())
      testImportersBySurface.get(targetSurface).add(file)
      continue
    }
    if (!importersBySurface.has(targetSurface)) importersBySurface.set(targetSurface, new Set())
    importersBySurface.get(targetSurface).add(file)
    if (!importerSurfaces.has(targetSurface)) importerSurfaces.set(targetSurface, new Set())
    importerSurfaces.get(targetSurface).add(own)
    if (!importsBySurface.has(own)) importsBySurface.set(own, new Set())
    importsBySurface.get(own).add(targetSurface)
  }
}

// ---------------------------------------------------------------------------
// 5. Git recency (single pass over history)
// ---------------------------------------------------------------------------

const NOW = Math.floor(Date.now() / 1000)
const D90 = NOW - 90 * 86400
const D180 = NOW - 180 * 86400

const lastTouched = new Map()
const commits90 = new Map()
const commits180 = new Map()

{
  const log = git(['log', '--no-renames', '--format=@%at', '--name-only'])
  let ts = 0
  for (const line of log.split('\n')) {
    if (!line) continue
    if (line.startsWith('@')) {
      ts = Number(line.slice(1))
      continue
    }
    if (isTestFile(line)) continue // recency of the code itself, not of its tests
    const sid = fileToSurface.get(line)
    if (!sid) continue
    if ((lastTouched.get(sid) ?? 0) < ts) lastTouched.set(sid, ts)
    if (ts >= D90) commits90.set(sid, (commits90.get(sid) ?? 0) + 1)
    if (ts >= D180) commits180.set(sid, (commits180.get(sid) ?? 0) + 1)
  }
}

// ---------------------------------------------------------------------------
// 6. Score + emit
// ---------------------------------------------------------------------------

const iso = (ts) => (ts ? new Date(ts * 1000).toISOString().slice(0, 10) : 'unknown')

const rows = [...surfaces.values()]
  // Test-only shells: a test whose subject path no longer exists. Reported as a
  // count below rather than as surfaces, since there is no code to triage.
  .filter((s) => s.files.length > 0)
  .map((s) => {
    const importerFiles = importersBySurface.get(s.id)?.size ?? 0
    const testImporterFiles = testImportersBySurface.get(s.id)?.size ?? 0
    const importerSurf = importerSurfaces.get(s.id)?.size ?? 0
    const last = lastTouched.get(s.id) ?? 0
    const c90 = commits90.get(s.id) ?? 0
    const c180 = commits180.get(s.id) ?? 0

    const publicApi = publicApiSurfaces.has(s.id)

    // Triage ordering only — never a verdict. Importer signals are suppressed for
    // entrypoint and public-API surfaces, where 0 importers is structural.
    let score = 0
    const reasons = []
    if (publicApi) reasons.push('public-api')
    if (!s.entrypoint && !publicApi) {
      if (importerFiles === 0 && testImporterFiles > 0) {
        score += 3
        reasons.push('test-only-consumers')
      } else if (importerFiles === 0) {
        score += 3
        reasons.push('no-importers')
      } else if (importerSurf <= 1) {
        // One consumer is normal and healthy for most components — this is an
        // inline/merge hint, not a dead-code signal. Only reaches the suspect
        // threshold when the surface is also cold.
        score += 1
        reasons.push('single-consumer')
      }
    }
    if (c180 === 0) {
      score += 2
      reasons.push('untouched-180d')
    } else if (c90 === 0) {
      score += 1
      reasons.push('untouched-90d')
    }

    return {
      id: s.id,
      kind: s.kind,
      entrypoint: s.entrypoint,
      publicApi,
      files: s.files.length,
      lines: s.lines,
      testFiles: s.testFiles.length,
      testLines: s.testLines,
      importerFiles,
      testImporterFiles,
      importerSurfaces: importerSurf,
      importsSurfaces: importsBySurface.get(s.id)?.size ?? 0,
      lastTouched: iso(last),
      commits90: c90,
      commits180: c180,
      score,
      reasons,
      status: 'untriaged',
      verdict: null,
    }
  })

rows.sort((a, b) => b.score - a.score || b.lines - a.lines)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(
  path.join(OUT_DIR, 'inventory.jsonl'),
  `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`
)

// --- markdown report ---

const totalLines = rows.reduce((n, r) => n + r.lines, 0)
const byKind = new Map()
for (const r of rows) {
  if (!byKind.has(r.kind)) byKind.set(r.kind, [])
  byKind.get(r.kind).push(r)
}

const fmt = (n) => n.toLocaleString('en-US')
const table = (list) => {
  const head =
    '| Surface | Files | Lines | Importers (prod) | Importers (test) | Surfaces | Last touched | Signals |\n' +
    '|---|---:|---:|---:|---:|---:|---|---|'
  const body = list
    .map(
      (r) =>
        `| \`${r.id.replace(/^(apps|packages)\//, '')}\` | ${r.files} | ${fmt(r.lines)} | ${
          r.entrypoint ? '—' : r.importerFiles
        } | ${r.entrypoint ? '—' : r.testImporterFiles} | ${
          r.entrypoint ? '—' : r.importerSurfaces
        } | ${r.lastTouched} | ${r.reasons.join(', ') || '—'} |`
    )
    .join('\n')
  return `${head}\n${body}`
}

const suspects = rows.filter((r) => r.score >= 3)
const md = `# Code Cleanup — Surface Inventory

> Generated by \`scripts/audit/build-inventory.mjs\`. Do not hand-edit; re-run instead.
> Triage decisions live in \`decisions.md\`, not here.

**Generated:** ${new Date().toISOString().slice(0, 10)}
**Surfaces:** ${rows.length} · **Files:** ${fmt(allFiles.length)} · **Lines:** ${fmt(totalLines)}
**Resolved import edges:** ${fmt(resolvedEdges)} · **Unresolved internal specifiers:** ${fmt(unresolvedInternal)}

## How to read this

- **Importers (prod / test)** — how many files outside this surface import from it. Test files are
  counted separately and **never** attributed to the surface they live in: a surface whose only
  consumers are tests (\`test-only-consumers\`) is code kept alive by its own test suite.
- \`—\` means the surface is an **entrypoint** (Next route, express route, worker, seed, script): it is
  invoked by a framework, never imported, so 0 importers is structural and carries no signal.
- **Signals** are triage ordering, not verdicts. \`no-importers\` is a *starting point for a question*,
  and is wrong on its own for anything reached by dynamic import, string-keyed registry, or codegen.
- Git history starts 2025-12-28, so \`untouched-180d\` is close to "never touched since the repo began".
- Nothing here is deleted without a second independent signal. See \`00-approach.md\`.

## Top suspects (score ≥ 3)

${suspects.length} surfaces, ${fmt(suspects.reduce((n, r) => n + r.lines, 0))} lines.

${table(suspects.slice(0, 60))}

${suspects.length > 60 ? `\n_…${suspects.length - 60} more in \`inventory.jsonl\`._\n` : ''}
## Cold surfaces by kind

Surfaces carrying at least one signal. Everything else is warm and lives only in
\`inventory.jsonl\` — that file is the complete ledger, this is the reading copy.

${[...byKind.entries()]
  .sort((a, b) => b[1].length - a[1].length)
  .map(([kind, list]) => {
    const cold = list
      .filter((r) => r.score >= 1)
      .sort((a, b) => b.score - a.score || b.lines - a.lines)
    const head = `### ${kind} — ${list.length} surfaces, ${fmt(
      list.reduce((n, r) => n + r.lines, 0)
    )} lines`
    if (!cold.length) return `${head}\n\nNo signals.`
    return `${head}\n\n${cold.length} cold of ${list.length}.\n\n${table(cold)}`
  })
  .join('\n\n')}
`

writeFileSync(path.join(OUT_DIR, 'inventory.md'), md)

console.log(`surfaces:            ${rows.length}`)
console.log(`files:               ${allFiles.length}`)
console.log(`lines:               ${totalLines}`)
console.log(`resolved edges:      ${resolvedEdges}`)
console.log(`unresolved internal: ${unresolvedInternal}`)
console.log(`suspects (score>=3): ${suspects.length}`)
console.log(`wrote ${path.relative(REPO, OUT_DIR)}/inventory.{jsonl,md}`)
