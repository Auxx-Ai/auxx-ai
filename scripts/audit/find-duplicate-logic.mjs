// scripts/audit/find-duplicate-logic.mjs
/**
 * Finds the same logic implemented more than once.
 *
 * Three lenses, weakest precision last:
 *   1. Name collisions   — the same exported name defined in several modules.
 *   2. Copy-paste        — identical bodies after erasing literals; catches
 *                          renamed copies, which a name histogram misses.
 *   3. Structural        — identical bodies after erasing every local name too;
 *                          catches the same algorithm written from scratch.
 *
 * Results roll up into module pairs, so the question is "these two modules
 * overlap" rather than a list of individual functions.
 *
 * Emits plans/cleanup/code/sweeps/duplicate-logic.md
 *
 * Usage: node scripts/audit/find-duplicate-logic.mjs [--min-tokens 30]
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(REPO, 'plans/cleanup/code/sweeps')
const MIN_TOKENS = Number(process.argv[process.argv.indexOf('--min-tokens') + 1]) || 30

const git = (args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 })

const files = git(['ls-files', '*.ts', '*.tsx'])
  .split('\n')
  .filter(Boolean)
  .filter((f) => /^(apps|packages)\/[^/]+\/(src|scripts)\//.test(f))
  .filter((f) => !f.includes('/node_modules/') && !f.includes('/dist/'))
  .filter((f) => !f.endsWith('.d.ts'))
  .filter((f) => !f.startsWith('packages/e2e/'))

const classify = (file) => {
  if (
    /(^|\/)(__tests__|__integration__|__mocks__|tests?)\//.test(file) ||
    /\.(test|spec)\.[cm]?tsx?$/.test(file)
  )
    return 'test'
  if (/\/(data-migrations|entity-migrations)\//.test(file)) return 'migration'
  if (/\/scripts\//.test(file)) return 'script'
  return 'prod'
}

/** The module a file belongs to — the unit findings roll up to. */
function moduleOf(file) {
  const m =
    file.match(/^((?:apps|packages)\/[^/]+\/src\/[^/]+\/[^/]+)\//) ||
    file.match(/^((?:apps|packages)\/[^/]+\/src\/[^/]+)\//) ||
    file.match(/^((?:apps|packages)\/[^/]+\/(?:src|scripts))\//)
  return m ? m[1] : path.dirname(file)
}

// ---------------------------------------------------------------------------
// Declaration extraction
// ---------------------------------------------------------------------------

/** Names that carry no information about what the code does. */
const IGNORED_NAMES = new Set([
  'default',
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'generateMetadata',
  'generateStaticParams',
  'metadata',
  'viewport',
  'config',
  'handler',
  'Page',
  'Layout',
  'Loading',
  'Error',
  'NotFound',
  'middleware',
  'runtime',
  'dynamic',
  'revalidate',
  'index',
  'main',
  'run',
  'up',
  'down',
])

const DECL_RE =
  /(?:^|\n)[ \t]*(export\s+)?(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=>\n]+)?=>)/g

/** Reads a balanced `{...}` or a single-expression arrow body from `start`. */
function readBody(src, start) {
  let i = start
  const n = src.length
  while (i < n && /\s/.test(src[i])) i++
  if (i >= n) return null
  const braced = src[i] === '{'
  let depth = 0
  const from = i
  while (i < n) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (src[i] === q) break
        if (q === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1
          i += 2
          while (i < n && d > 0) {
            if (src[i] === '{') d++
            else if (src[i] === '}') d--
            i++
          }
          continue
        }
        i++
      }
      i++
      continue
    }
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i)
      if (e < 0) return null
      i = e + 2
      continue
    }
    if (c === '{' || c === '(' || c === '[') depth++
    else if (c === '}' || c === ')' || c === ']') {
      depth--
      if (braced && depth === 0) return src.slice(from, i + 1)
      if (depth < 0) return src.slice(from, i)
    } else if (!braced && depth === 0 && (c === '\n' || c === ';')) {
      return src.slice(from, i)
    }
    i++
  }
  return null
}

/** Language keywords and globals that must survive structural normalisation. */
const KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'throw',
  'try',
  'catch',
  'finally',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'await',
  'async',
  'function',
  'const',
  'let',
  'var',
  'class',
  'extends',
  'super',
  'this',
  'null',
  'undefined',
  'true',
  'false',
  'void',
  'yield',
  'as',
  'satisfies',
  'is',
  'keyof',
  'readonly',
])

const TOKEN_RE =
  /"S"|[A-Za-z_$][\w$]*|=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\.\.\.|[.,;:(){}[\]?!<>=+\-*/%&|^~]/g

function tokenize(body) {
  const lit = body
    .replace(/`(?:[^`\\]|\\.)*`/g, '"S"')
    .replace(/'(?:[^'\\]|\\.)*'/g, '"S"')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"S"')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\b\d+(\.\d+)?\b/g, '0')
  return lit.match(TOKEN_RE) ?? []
}

/** Literals erased, names kept — a renamed copy-paste still matches. */
const sigCopy = (tokens) => tokens.join(' ')
/** Local names erased too — the same algorithm rewritten still matches. */
const sigStruct = (tokens) =>
  tokens.map((t) => (/^[A-Za-z_$][\w$]*$/.test(t) && !KEYWORDS.has(t) ? '_' : t)).join(' ')

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const decls = []

for (const file of files) {
  let src
  try {
    src = readFileSync(path.join(REPO, file), 'utf8')
  } catch {
    continue
  }
  const lineAt = (idx) => src.slice(0, idx).split('\n').length

  DECL_RE.lastIndex = 0
  let m
  while ((m = DECL_RE.exec(src))) {
    const name = m[2] ?? m[3]
    if (!name) continue
    const bodyStart = m[3]
      ? src.indexOf('=>', m.index + m[0].length - 2) + 2
      : src.indexOf('{', m.index + m[0].length)
    if (bodyStart <= 0) continue
    const body = readBody(src, bodyStart)
    if (!body) continue
    const tokens = tokenize(body)
    if (tokens.length < MIN_TOKENS) continue
    decls.push({
      file,
      line: lineAt(m.index),
      name,
      exported: Boolean(m[1]),
      module: moduleOf(file),
      class: classify(file),
      tokens: tokens.length,
      body,
      copy: sigCopy(tokens),
      struct: sigStruct(tokens),
    })
  }
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

function cluster(items, key, { crossModule = true } = {}) {
  const map = new Map()
  for (const it of items) {
    const k = key(it)
    if (!k) continue
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(it)
  }
  return [...map.entries()]
    .filter(([, l]) => l.length >= 2)
    .map(([k, l]) => ({
      key: k,
      list: l,
      modules: new Set(l.map((i) => i.module)),
      prod: l.filter((i) => i.class === 'prod'),
      tokens: l[0].tokens,
    }))
    .filter((c) => (crossModule ? c.modules.size > 1 : true))
    .filter((c) => new Set(c.prod.map((i) => i.module)).size > 1)
    .sort((a, b) => b.list.length * b.tokens - a.list.length * a.tokens)
}

const byName = cluster(
  decls.filter((d) => d.exported && !IGNORED_NAMES.has(d.name)),
  (d) => d.name
)
const byCopy = cluster(decls, (d) => d.copy)
const copyKeys = new Set(byCopy.map((c) => c.key))
const byStruct = cluster(decls, (d) => d.struct).filter(
  (c) => !c.list.every((i) => copyKeys.has(i.copy))
)

/** Module pairs that keep showing up together across all three lenses. */
const pairs = new Map()
for (const c of [...byCopy, ...byStruct, ...byName]) {
  const mods = [...new Set(c.prod.map((i) => i.module))].sort()
  for (let a = 0; a < mods.length; a++) {
    for (let b = a + 1; b < mods.length; b++) {
      const k = `${mods[a]} ⇄ ${mods[b]}`
      if (!pairs.has(k)) pairs.set(k, { key: k, hits: 0, tokens: 0, samples: [] })
      const p = pairs.get(k)
      p.hits++
      p.tokens += c.tokens
      if (p.samples.length < 4) p.samples.push(c.list[0].name)
    }
  }
}
const pairRows = [...pairs.values()].filter((p) => p.hits >= 2).sort((a, b) => b.hits - a.hits)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const fmt = (n) => n.toLocaleString('en-US')
const short = (m) => m.replace(/^(apps|packages)\//, '')
const trim = (s, n = 260) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

const render = (c, i) => {
  const sites = c.list
    .slice(0, 10)
    .map(
      (s) =>
        `  - \`${s.name}\` — \`${s.file}:${s.line}\`${s.class === 'prod' ? '' : ` _(${s.class})_`}`
    )
    .join('\n')
  const more = c.list.length > 10 ? `\n  - _…${c.list.length - 10} more_` : ''
  return `#### ${i + 1}. ${c.list.length}× · ${c.tokens} tokens · ${c.modules.size} modules

\`\`\`ts
${trim(c.list[0].body, 320)}
\`\`\`

${sites}${more}
`
}

const md = `# Sweep — Duplicate logic

> Generated by \`scripts/audit/find-duplicate-logic.mjs\`. Re-run, don't hand-edit.
> Verdicts go in \`../decisions.md\`.

**Generated:** ${new Date().toISOString().slice(0, 10)}
**Scanned:** ${fmt(files.length)} files · **${fmt(decls.length)}** declarations of ≥${MIN_TOKENS} tokens

## Method

Every top-level function and arrow const is tokenised and hashed twice:

- **Copy-paste** — literals erased, names kept. Matches survive a rename, so this
  finds copies that a name search never would.
- **Structural** — every local identifier erased as well. Matches are the same
  algorithm written independently. Lower precision: read before believing.
- **Name collisions** — the same exported name defined in several modules. Cheap,
  and often the fastest route to "we built this twice".

Only clusters spanning **2+ production modules** are reported. Repetition inside
one module is usually deliberate; migrations, tests and scripts are tagged and
excluded from the module count for the reasons in \`duplicate-queries.md\`.

## Areas — module pairs (${pairRows.length})

Modules that collide repeatedly. This is the decision unit: one question per pair,
not per function.

| Module A ⇄ Module B | Shared | Examples |
|---|---:|---|
${pairRows
  .slice(0, 30)
  .map((p) => `| \`${short(p.key)}\` | ${p.hits} | ${p.samples.join(', ')} |`)
  .join('\n')}

## Copy-paste duplicates (${byCopy.length} clusters)

Identical after erasing literals — the same code, possibly renamed.

${byCopy.slice(0, 25).map(render).join('\n')}

## Structural duplicates (${byStruct.length} clusters)

Same shape, different names throughout. Candidates, not findings.

${byStruct.slice(0, 20).map(render).join('\n')}

## Exported name collisions (${byName.length})

The same exported name in more than one production module. A collision is not
automatically a duplicate — check whether the bodies agree.

| Name | Defined in | Locations |
|---|---:|---|
${byName
  .slice(0, 60)
  .map(
    (c) =>
      `| \`${c.list[0].name}\` | ${c.modules.size} | ${[
        ...new Set(c.list.map((i) => short(i.module))),
      ]
        .slice(0, 5)
        .map((m) => `\`${m}\``)
        .join(', ')} |`
  )
  .join('\n')}
`

mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, 'duplicate-logic.md'), md)

console.log(`files scanned:      ${files.length}`)
console.log(`declarations:       ${decls.length}`)
console.log(`copy-paste:         ${byCopy.length}`)
console.log(`structural:         ${byStruct.length}`)
console.log(`name collisions:    ${byName.length}`)
console.log(`module pairs:       ${pairRows.length}`)
console.log(`wrote plans/cleanup/code/sweeps/duplicate-logic.md`)
