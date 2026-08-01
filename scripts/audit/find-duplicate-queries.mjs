// scripts/audit/find-duplicate-queries.mjs
/**
 * Finds Drizzle query chains and raw `sql` templates that are structurally the
 * same query written more than once.
 *
 * Two call sites collapse to the same signature when they differ only in
 * variable names, literals, and (at shape level) projection/ordering/paging.
 * That is the definition of "pretty much identical" that matters here: the same
 * question asked of the same tables with the same filters.
 *
 * Emits plans/cleanup/code/sweeps/duplicate-queries.md
 *
 * Usage: node scripts/audit/find-duplicate-queries.mjs [--min 2]
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = path.join(REPO, 'plans/cleanup/code/sweeps')
const MIN = Number(process.argv[process.argv.indexOf('--min') + 1]) || 2

const git = (args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 1024 * 1024 * 512 })

const files = git(['ls-files', '*.ts', '*.tsx'])
  .split('\n')
  .filter(Boolean)
  .filter((f) => /^(apps|packages)\/[^/]+\/(src|scripts)\//.test(f))
  .filter((f) => !f.includes('/node_modules/') && !f.includes('/dist/'))
  .filter((f) => !f.endsWith('.d.ts'))
  .filter((f) => !f.startsWith('packages/e2e/'))

// ---------------------------------------------------------------------------
// Chain extraction
// ---------------------------------------------------------------------------

/** Anchors that begin a query chain, however the chain is line-wrapped. */
const CHAIN_START =
  /\b(?:ctx\.db|this\.db|trx|tx|db)\s*\.\s*(?:select|selectDistinct|selectDistinctOn|insert|update|delete|execute|query)\b/g

/**
 * Walks forward from `start` to the end of the method chain, honouring string,
 * template, comment and bracket nesting. The chain ends at depth 0 when the
 * next meaningful character is not a `.` continuing it.
 */
function readChain(src, start) {
  let i = start
  let depth = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    // strings / templates
    if (c === "'" || c === '"' || c === '`') {
      const quote = c
      i++
      while (i < n) {
        if (src[i] === '\\') {
          i += 2
          continue
        }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let d = 1
          i += 2
          while (i < n && d > 0) {
            if (src[i] === '{') d++
            else if (src[i] === '}') d--
            i++
          }
          continue
        }
        if (src[i] === quote) break
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
      i = src.indexOf('*/', i)
      if (i < 0) return null
      i += 2
      continue
    }
    if (c === '(' || c === '[' || c === '{') {
      depth++
      i++
      continue
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break // closing bracket that belongs to our caller
      depth--
      i++
      continue
    }
    if (depth === 0) {
      // at chain level: whitespace is only allowed if a `.` follows
      if (/\s/.test(c)) {
        let j = i
        while (j < n && /\s/.test(src[j])) j++
        if (src[j] === '.') {
          i = j
          continue
        }
        break
      }
      if (/[;,)\]}]/.test(c)) break
    }
    i++
  }
  return src.slice(start, i)
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Drizzle + SQL vocabulary that carries meaning and must survive normalisation. */
const KEEP = new Set([
  'db',
  'ctx',
  'this',
  'tx',
  'trx',
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'from',
  'where',
  'orderBy',
  'groupBy',
  'having',
  'limit',
  'offset',
  'innerJoin',
  'leftJoin',
  'rightJoin',
  'fullJoin',
  'crossJoin',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'returning',
  'onConflictDoUpdate',
  'onConflictDoNothing',
  'execute',
  'query',
  'findFirst',
  'findMany',
  'with',
  'columns',
  'extras',
  'as',
  'for',
  'union',
  'unionAll',
  'intersect',
  'except',
  '$dynamic',
  'and',
  'or',
  'not',
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'isNull',
  'isNotNull',
  'inArray',
  'notInArray',
  'like',
  'ilike',
  'notLike',
  'notIlike',
  'between',
  'notBetween',
  'exists',
  'notExists',
  'arrayContains',
  'arrayContained',
  'arrayOverlaps',
  'asc',
  'desc',
  'sql',
  'count',
  'countDistinct',
  'sum',
  'avg',
  'min',
  'max',
  'coalesce',
  'lower',
  'upper',
  'getTableColumns',
  'alias',
  'aliasedTable',
  'raw',
  'join',
  'on',
  'true',
  'false',
  'null',
  'undefined',
  'await',
  'return',
])

const TOKEN_RE = /'S'|[A-Za-z_$][A-Za-z0-9_$]*|=>|\?\?|[.,(){}[\]:?!<>=+\-*/%&|`]/g

/**
 * Structural signature. Literals become `'S'`/`N`; local variable names become
 * `V`; table and column identifiers (PascalCase, and the `.prop` after them)
 * survive, because they are what makes two queries the same query.
 */
function normalize(chain) {
  const lit = chain
    .replace(/`(?:[^`\\]|\\.)*`/g, "'S'")
    .replace(/'(?:[^'\\]|\\.)*'/g, "'S'")
    .replace(/"(?:[^"\\]|\\.)*"/g, "'S'")
    .replace(/\b\d+(\.\d+)?\b/g, 'N')

  const out = []
  let prevWasTableDot = false
  let m
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(lit))) {
    const t = m[0]
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t)) {
      if (prevWasTableDot) {
        out.push(t) // column name on a known table
        prevWasTableDot = false
        continue
      }
      if (/^[A-Z]/.test(t)) {
        out.push(t) // table / enum / type
        prevWasTableDot = lit[TOKEN_RE.lastIndex] === '.'
        continue
      }
      out.push(KEEP.has(t) ? t : 'V')
      prevWasTableDot = false
      continue
    }
    prevWasTableDot = false
    if (/\s/.test(t)) continue
    out.push(t)
  }
  return out.join('')
}

/** Looser signature: same tables + same filters, ignoring projection and paging. */
function shapeOf(sig) {
  return sig
    .replace(/select\([^)]*\)/g, 'select(*)')
    .replace(/\.orderBy\([^()]*(\([^()]*\))?[^()]*\)/g, '')
    .replace(/\.limit\([^)]*\)/g, '')
    .replace(/\.offset\([^)]*\)/g, '')
    .replace(/\.columns\(\{[^}]*\}\)/g, '')
}

/** Tables referenced, for grouping the report by domain. */
function tablesOf(sig) {
  const set = new Set()
  for (const m of sig.matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) set.add(m[1])
  return [...set]
}

/**
 * Reads a template literal starting at the opening backtick, replacing each
 * `${...}` with `?`. Handles nested templates inside interpolations, which is
 * where a regex-based reader silently truncates.
 */
function readTemplate(src, openIdx) {
  let i = openIdx + 1
  const n = src.length
  let out = ''
  while (i < n) {
    const c = src[i]
    if (c === '\\') {
      out += src.slice(i, i + 2)
      i += 2
      continue
    }
    if (c === '`') return out
    if (c === '$' && src[i + 1] === '{') {
      let depth = 1
      i += 2
      while (i < n && depth > 0) {
        const d = src[i]
        if (d === '`') {
          const inner = readTemplate(src, i)
          if (inner === null) return null
          i += inner.length + 2 // crude but only used to skip
          continue
        }
        if (d === '{') depth++
        else if (d === '}') depth--
        i++
      }
      out += '?'
      continue
    }
    out += c
    i++
  }
  return null
}

/** Where a call site lives — migrations and tests are deliberately repetitive. */
function classify(file) {
  if (
    /(^|\/)(__tests__|__integration__|__mocks__|tests?)\//.test(file) ||
    /\.(test|spec)\.[cm]?tsx?$/.test(file)
  )
    return 'test'
  if (/\/(data-migrations|entity-migrations)\//.test(file)) return 'migration'
  if (/\/scripts\//.test(file)) return 'script'
  return 'prod'
}

/** The table a query is actually about. */
function primaryTable(sig) {
  // `schema.` normalises to `V.`, so both spellings have to be accepted here.
  const q = '(?:schema\\.|V\\.)?'
  const m =
    sig.match(new RegExp(`\\.from\\(${q}([A-Z][A-Za-z0-9_]*)`)) ||
    sig.match(new RegExp(`\\.(?:update|insert|delete)\\(${q}([A-Z][A-Za-z0-9_]*)`)) ||
    sig.match(/\.query\.([A-Za-z0-9_]+)/)
  return m ? m[1] : '—'
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const chains = []
const rawSql = []

for (const file of files) {
  let src
  try {
    src = readFileSync(path.join(REPO, file), 'utf8')
  } catch {
    continue
  }
  const lineAt = (idx) => src.slice(0, idx).split('\n').length

  CHAIN_START.lastIndex = 0
  let m
  while ((m = CHAIN_START.exec(src))) {
    const chain = readChain(src, m.index)
    if (!chain || chain.length < 40) continue
    const sig = normalize(chain)
    if (sig.length < 40) continue
    chains.push({ file, line: lineAt(m.index), text: chain, sig, shape: shapeOf(sig) })
    CHAIN_START.lastIndex = m.index + chain.length
  }

  // raw sql`` templates — scanned, not regexed: interpolations nest further
  // templates (`sql.join(conds, sql\` OR \`)`) and a regex mis-terminates there.
  for (const t of src.matchAll(/\bsql(?:<[^>]*>)?\s*`/g)) {
    const body = readTemplate(src, t.index + t[0].length - 1)
    if (body === null) continue
    const norm = body.replace(/\s+/g, ' ').trim()
    if (norm.length < 25) continue
    rawSql.push({ file, line: lineAt(t.index), text: norm, sig: norm.toLowerCase() })
  }
}

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------

function cluster(items, key) {
  const map = new Map()
  for (const it of items) {
    const k = key(it)
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(it)
  }
  return [...map.entries()]
    .filter(([, list]) => list.length >= MIN)
    .map(([k, list]) => {
      const classes = new Set(list.map((i) => classify(i.file)))
      const prodSites = list.filter((i) => classify(i.file) === 'prod')
      return {
        key: k,
        list,
        classes: [...classes],
        prodSites: prodSites.length,
        prodFiles: new Set(prodSites.map((i) => i.file)).size,
        table: primaryTable(k),
        files: new Set(list.map((i) => i.file)).size,
        weight: list.length * (list[0].text.length / 100),
      }
    })
    .sort((a, b) => b.weight - a.weight)
}

const exact = cluster(chains, (c) => c.sig)
const shape = cluster(chains, (c) => c.shape)
// Only report a shape cluster when it adds something the exact pass didn't.
const exactKeys = new Set(exact.map((c) => c.key))
const shapeOnly = shape.filter((c) => !c.list.every((i) => exactKeys.has(i.sig)))
const raws = cluster(rawSql, (c) => c.sig)
const areaRows = areas([exact, shapeOnly])

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const fmt = (n) => n.toLocaleString('en-US')
const trim = (s, n = 400) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? `${one.slice(0, n)}…` : one
}

const renderCluster = (c, i) => {
  const sites = c.list
    .map((s) => {
      const cls = classify(s.file)
      return `  - \`${s.file}:${s.line}\`${cls === 'prod' ? '' : ` _(${cls})_`}`
    })
    .slice(0, 12)
    .join('\n')
  const more = c.list.length > 12 ? `\n  - _…${c.list.length - 12} more_` : ''
  const tables = tablesOf(c.key).slice(0, 6).join(', ') || '—'
  return `#### ${i + 1}. ${c.list.length}× across ${c.files} file${c.files === 1 ? '' : 's'} — ${tables}

\`\`\`ts
${trim(c.list[0].text, 500)}
\`\`\`

${sites}${more}
`
}

const crossFile = (list) => list.filter((c) => c.files > 1)
/** Production duplication — what's actually worth a shared helper. */
const prodWorthy = (list) => list.filter((c) => c.prodFiles > 1)

/**
 * Roll clusters up to one row per table. This is the decision unit: "Integration
 * lookups are hand-rolled in 17 files" is a question you can answer once,
 * where 27 individual clusters is a list nobody reads.
 */
function areas(clusterLists) {
  const map = new Map()
  for (const c of clusterLists.flat()) {
    if (c.prodFiles < 2) continue
    if (!map.has(c.table))
      map.set(c.table, { table: c.table, clusters: 0, sites: 0, files: new Set(), top: c })
    const a = map.get(c.table)
    a.clusters++
    a.sites += c.prodSites
    for (const s of c.list) if (classify(s.file) === 'prod') a.files.add(s.file)
    if (c.prodSites > a.top.prodSites) a.top = c
  }
  return [...map.values()].sort((a, b) => b.sites - a.sites || b.files.size - a.files.size)
}

const md = `# Sweep — Duplicate queries

> Generated by \`scripts/audit/find-duplicate-queries.mjs\`. Re-run, don't hand-edit.
> Verdicts go in \`../decisions.md\`.

**Generated:** ${new Date().toISOString().slice(0, 10)}
**Scanned:** ${fmt(files.length)} files · **${fmt(chains.length)}** Drizzle chains · **${fmt(rawSql.length)}** raw \`sql\` templates

## Method

Each query chain is reduced to a structural signature: string/number literals are
erased, local variable names collapse to \`V\`, and table + column identifiers are
kept — those are what make two queries *the same query*. Sites that then hash
alike differ only in naming, not in what they ask the database.

- **Exact** — identical after that normalisation, projection included.
- **Shape** — identical tables and filters, ignoring projection, ordering and paging.
  Looser, so read these as candidates rather than as findings.
- Clusters confined to a single file are usually a legitimate local pattern; the
  cross-file ones are where a shared helper is missing.

### What is excluded from the ranking, and why

Sites are tagged \`prod\` / \`test\` / \`migration\` / \`script\`, and only clusters
spanning **2+ production files** are ranked. Repetition in the other three is
mostly correct:

- **Migrations are frozen snapshots.** \`data-migrations/\` and \`entity-migrations/\`
  write raw Drizzle deliberately — a shared helper would change what an already-run
  migration did. Do not dedupe these.
- **Tests** repeat setup on purpose; a shared fixture is a different, smaller call.
- **Scripts** are one-off operational tools.

## Areas (${areaRows.length})

One row per table. This is the decision unit — answer it once per table rather
than reading ${prodWorthy(exact).length + prodWorthy(shapeOnly).length} individual clusters.

| Table | Dup sites | Prod files | Clusters | Largest cluster |
|---|---:|---:|---:|---|
${areaRows
  .map(
    (a) =>
      `| \`${a.table}\` | ${a.sites} | ${a.files.size} | ${a.clusters} | ${a.top.prodSites}× — ${trim(
        a.top.list[0].text,
        90
      )} |`
  )
  .join('\n')}

## Exact duplicates — 2+ production files (${prodWorthy(exact).length} clusters)

${prodWorthy(exact).slice(0, 30).map(renderCluster).join('\n')}

## Shape duplicates — 2+ production files (${prodWorthy(shapeOnly).length} clusters)

Same tables and filters, different projection/paging.

${prodWorthy(shapeOnly).slice(0, 25).map(renderCluster).join('\n')}

## Raw \`sql\` template duplicates (${raws.length} clusters)

${raws
  .slice(0, 25)
  .map(
    (c, i) =>
      `#### ${i + 1}. ${c.list.length}× across ${c.files} file${c.files === 1 ? '' : 's'}\n\n\`\`\`sql\n${trim(
        c.list[0].text,
        300
      )}\n\`\`\`\n\n${c.list
        .map((s) => `  - \`${s.file}:${s.line}\``)
        .slice(0, 10)
        .join('\n')}${c.list.length > 10 ? `\n  - _…${c.list.length - 10} more_` : ''}\n`
  )
  .join('\n')}

## Single-file repeats

${exact.length - crossFile(exact).length} exact clusters live inside one file — local
patterns, lower priority, listed in full only on request.
`

mkdirSync(OUT, { recursive: true })
writeFileSync(path.join(OUT, 'duplicate-queries.md'), md)
// Full cluster data — the markdown only shows the top N per section.
writeFileSync(
  path.join(OUT, 'duplicate-queries.json'),
  JSON.stringify(
    {
      exact: exact.map((c) => ({ ...c, list: c.list, modules: undefined })),
      shapeOnly: shapeOnly.map((c) => ({ ...c, list: c.list })),
      raw: raws.map((c) => ({ ...c, list: c.list })),
    },
    (k, v) => (k === 'key' ? undefined : v),
    1,
  ),
)

console.log(`files scanned:        ${files.length}`)
console.log(`drizzle chains:       ${chains.length}`)
console.log(`raw sql templates:    ${rawSql.length}`)
console.log(`exact clusters:       ${exact.length} (${crossFile(exact).length} cross-file)`)
console.log(`shape-only clusters:  ${shapeOnly.length} (${crossFile(shapeOnly).length} cross-file)`)
console.log(`raw sql clusters:     ${raws.length}`)
console.log(`wrote plans/cleanup/code/sweeps/duplicate-queries.md`)
