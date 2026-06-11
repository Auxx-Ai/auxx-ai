// packages/lib/src/ai/mcp/snippet/parse-mcp-snippet.ts
//
// Pure (no network) parser: any pasted MCP install snippet → `McpSnippetCandidate[]`. Detection
// order is first-match-wins. Every stdio candidate gets an mcp-remote unwrap pass; `${VAR}`
// placeholders are collected from all string fields. See phase-7-smart-paste.md for the dialect
// reference this implements.

import type { McpSnippetCandidate } from './types'

const URL_KEYS = ['url', 'serverUrl', 'httpUrl'] as const

/** Parse a pasted snippet into zero or more server candidates. */
export function parseMcpSnippet(snippet: string): McpSnippetCandidate[] {
  const trimmed = stripFences(snippet).trim()
  if (!trimmed) return []

  const candidates =
    parseDeeplink(trimmed) ??
    parseBareUrl(trimmed) ??
    parseJson(trimmed) ??
    parseToml(trimmed) ??
    parseCli(trimmed) ??
    []

  return candidates.map(finalizeCandidate).filter(Boolean) as McpSnippetCandidate[]
}

// ── 1. Deeplinks ──────────────────────────────────────────────────────────────

function parseDeeplink(snippet: string): McpSnippetCandidate[] | null {
  // cursor://anysphere.cursor-mcp/install?name=<n>&config=<base64 JSON entry>
  const cursor = snippet.match(/^cursor:\/\/[^?]*\/install\?(.+)$/i)
  if (cursor?.[1]) {
    const params = new URLSearchParams(cursor[1])
    const name = params.get('name') ?? undefined
    const config = params.get('config')
    if (config) {
      const decoded = safeBase64(config)
      const entry = decoded ? safeJson(decoded) : null
      if (entry && typeof entry === 'object')
        return [entryToCandidate(name, entry as Record<string, unknown>)]
    }
    return []
  }

  // vscode:mcp/install?<urlencoded JSON {name,...entry}>  (also vscode-insiders:)
  const vscode = snippet.match(/^vscode(?:-insiders)?:mcp\/install\?(.+)$/i)
  if (vscode?.[1]) {
    const json = safeJson(decodeURIComponent(vscode[1]))
    if (json && typeof json === 'object') {
      const { name, ...entry } = json as Record<string, unknown>
      return [entryToCandidate(typeof name === 'string' ? name : undefined, entry)]
    }
    return []
  }
  return null
}

// ── 2. Bare URL ─────────────────────────────────────────────────────────────

function parseBareUrl(snippet: string): McpSnippetCandidate[] | null {
  if (/^https?:\/\/\S+$/i.test(snippet) && !/\s/.test(snippet)) {
    return [{ url: snippet }]
  }
  return null
}

// ── 3. JSON ─────────────────────────────────────────────────────────────────

function parseJson(snippet: string): McpSnippetCandidate[] | null {
  if (!/^[[{]/.test(snippet)) return null
  const parsed = safeJson(snippet)
  if (!parsed || typeof parsed !== 'object') return null
  const obj = parsed as Record<string, unknown>

  const wrapper = (obj.mcpServers ?? obj.servers) as Record<string, unknown> | undefined
  if (wrapper && typeof wrapper === 'object') {
    return Object.entries(wrapper).map(([name, entry]) =>
      entryToCandidate(name, entry as Record<string, unknown>)
    )
  }
  // Bare inner entry fragment (users paste just the inner object constantly).
  if (obj.command || URL_KEYS.some((k) => k in obj)) {
    return [entryToCandidate(undefined, obj)]
  }
  return null
}

/** One JSON entry (`{command,args,env}` or `{url-ish, headers, type}`) → a candidate. */
function entryToCandidate(
  name: string | undefined,
  entry: Record<string, unknown>
): McpSnippetCandidate {
  const headers = asStringRecord(entry.headers)
  const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : undefined

  // Prefer a remote URL if any URL key is present.
  for (const key of URL_KEYS) {
    const url = entry[key]
    if (typeof url === 'string' && url) {
      const transportHint: McpSnippetCandidate['transportHint'] =
        key === 'httpUrl'
          ? 'http'
          : type === 'sse' || /\/sse\/?$/.test(url)
            ? 'sse'
            : type === 'http' || type === 'streamable-http'
              ? 'http'
              : undefined
      return clean({ name, url, headers, transportHint })
    }
  }

  // Otherwise stdio.
  if (typeof entry.command === 'string') {
    return clean({
      name,
      command: entry.command,
      args: asStringArray(entry.args),
      env: asStringRecord(entry.env),
    })
  }
  return clean({ name })
}

// ── 4. TOML (Codex `[mcp_servers.<name>]`) ──────────────────────────────────

function parseToml(snippet: string): McpSnippetCandidate[] | null {
  if (!/\[mcp_servers\.[^\]]+\]/.test(snippet)) return null
  const sections = snippet.split(/^\s*\[mcp_servers\.([^\]]+)\]\s*$/m)
  const candidates: McpSnippetCandidate[] = []
  // split() interleaves [pre, name1, body1, name2, body2, ...].
  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i]?.trim().replace(/^["']|["']$/g, '')
    const body = sections[i + 1] ?? ''
    candidates.push(tomlBodyToCandidate(name, body))
  }
  return candidates.length ? candidates : null
}

function tomlBodyToCandidate(name: string | undefined, body: string): McpSnippetCandidate {
  const kv = new Map<string, string>()
  const arrays = new Map<string, string[]>()
  const tables = new Map<string, Record<string, string>>()

  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/(^|\s)#.*$/, '').trim()
    if (!line || line.startsWith('[')) continue
    const m = line.match(/^([\w-]+)\s*=\s*(.+)$/)
    if (!m) continue
    const [, key, value] = m
    if (!key) continue
    const v = value!.trim()
    if (v.startsWith('[')) {
      arrays.set(
        key,
        [...v.matchAll(/"([^"]*)"/g)].map((x) => x[1]!)
      )
    } else if (v.startsWith('{')) {
      tables.set(key, parseInlineTable(v))
    } else {
      kv.set(key, v.replace(/^["']|["']$/g, ''))
    }
  }

  const url = kv.get('url')
  if (url) {
    const headers = tables.get('http_headers')
    const placeholders: string[] = []
    const bearerEnv = kv.get('bearer_token_env_var')
    if (bearerEnv) placeholders.push(bearerEnv)
    return clean({
      name,
      url,
      headers,
      placeholders: placeholders.length ? placeholders : undefined,
    })
  }
  return clean({
    name,
    command: kv.get('command'),
    args: arrays.get('args'),
    env: tables.get('env'),
  })
}

/** `{ K = "v", J = "w" }` → record. */
function parseInlineTable(v: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of v.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = m[2]!
  return out
}

// ── 5. CLI commands ─────────────────────────────────────────────────────────

function parseCli(snippet: string): McpSnippetCandidate[] | null {
  // Collapse trailing backslash-newline line continuations, then tokenize.
  const oneLine = snippet
    .replace(/\\\s*\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim()
  const tokens = tokenizeShell(oneLine)
  if (!tokens.length) return null

  const [a, b, c] = tokens

  if (a === 'claude' && b === 'mcp' && c === 'add-json') {
    const json = tokens[4] ? safeJson(tokens[4]) : null
    if (json && typeof json === 'object')
      return [entryToCandidate(tokens[3], json as Record<string, unknown>)]
    return []
  }
  if (a === 'claude' && b === 'mcp' && c === 'add') return [parseClaudeAdd(tokens.slice(3))]
  if (a === 'codex' && b === 'mcp' && c === 'add') return [parseStdioAdd(tokens.slice(3))]
  if (a === 'gemini' && b === 'mcp' && c === 'add') return [parseGeminiAdd(tokens.slice(3))]
  if (a === 'code' && b === '--add-mcp') {
    const json = tokens[2] ? safeJson(tokens[2]) : null
    if (json && typeof json === 'object') {
      const { name, ...entry } = json as Record<string, unknown>
      return [entryToCandidate(typeof name === 'string' ? name : undefined, entry)]
    }
    return []
  }
  // Bare `npx -y pkg…` / `uvx pkg…` line → stdio candidate.
  if (a === 'npx' || a === 'uvx' || a === 'bunx' || a === 'pnpm') {
    return [clean({ command: a, args: tokens.slice(1) })]
  }
  return null
}

/** `claude mcp add [--transport http] [--header "K: V"]… [--env K=V]… <name> [url | -- <cmd> args…]`. */
function parseClaudeAdd(rest: string[]): McpSnippetCandidate {
  let transport: 'http' | 'sse' | 'stdio' | undefined
  const headers: Record<string, string> = {}
  const env: Record<string, string> = {}
  const positionals: string[] = []
  let commandTail: string[] | null = null

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!
    if (t === '--') {
      commandTail = rest.slice(i + 1)
      break
    }
    if (t === '--transport' || t === '-t') {
      transport = rest[++i] as typeof transport
    } else if (t === '--header' || t === '-H') {
      addHeader(headers, rest[++i])
    } else if (t === '--env' || t === '-e') {
      addEnv(env, rest[++i])
    } else if (t === '--scope' || t === '-s') {
      i++ // ignore scope value
    } else if (t.startsWith('-')) {
      // unknown flag; skip a following value only if it isn't itself a flag
      if (rest[i + 1] && !rest[i + 1]!.startsWith('-')) i++
    } else {
      positionals.push(t)
    }
  }

  const name = positionals[0]
  if (commandTail?.length) {
    return clean({ name, command: commandTail[0], args: commandTail.slice(1), env })
  }
  const url = positionals[1]
  return clean({
    name,
    url,
    headers,
    transportHint: transport === 'sse' ? 'sse' : transport === 'http' ? 'http' : undefined,
  })
}

/** `codex mcp add <name> [--env K=V]… -- <command> [args…]` (stdio only). */
function parseStdioAdd(rest: string[]): McpSnippetCandidate {
  const env: Record<string, string> = {}
  const positionals: string[] = []
  let commandTail: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!
    if (t === '--') {
      commandTail = rest.slice(i + 1)
      break
    }
    if (t === '--env' || t === '-e') addEnv(env, rest[++i])
    else if (t.startsWith('-')) {
      if (rest[i + 1] && !rest[i + 1]!.startsWith('-')) i++
    } else positionals.push(t)
  }
  return clean({ name: positionals[0], command: commandTail[0], args: commandTail.slice(1), env })
}

/** `gemini mcp add [-t stdio|sse|http] [-e K=V]… [-H "K: V"]… <name> <cmdOrUrl> [args…]`. */
function parseGeminiAdd(rest: string[]): McpSnippetCandidate {
  let transport: 'stdio' | 'sse' | 'http' | undefined
  const headers: Record<string, string> = {}
  const env: Record<string, string> = {}
  const positionals: string[] = []
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!
    if (t === '-t' || t === '--transport') transport = rest[++i] as typeof transport
    else if (t === '-H' || t === '--header') addHeader(headers, rest[++i])
    else if (t === '-e' || t === '--env') addEnv(env, rest[++i])
    else if (t.startsWith('-')) {
      if (rest[i + 1] && !rest[i + 1]!.startsWith('-')) i++
    } else positionals.push(t)
  }
  const name = positionals[0]
  const cmdOrUrl = positionals[1]
  if (transport === 'http' || transport === 'sse' || /^https?:\/\//.test(cmdOrUrl ?? '')) {
    return clean({
      name,
      url: cmdOrUrl,
      headers,
      transportHint: transport === 'sse' ? 'sse' : 'http',
    })
  }
  return clean({ name, command: cmdOrUrl, args: positionals.slice(2), env })
}

// ── Post-pass: mcp-remote unwrap + placeholder collection ────────────────────

function finalizeCandidate(c: McpSnippetCandidate): McpSnippetCandidate | null {
  const unwrapped = unwrapMcpRemote(c)
  const placeholders = collectPlaceholders(unwrapped)
  const out = clean({ ...unwrapped, placeholders: placeholders.length ? placeholders : undefined })
  return out.url || out.command ? out : null
}

/**
 * Claude Desktop bridges remote servers as a stdio `mcp-remote <url>`. Detect and unwrap to a
 * remote candidate: first non-flag arg after `mcp-remote` is the URL; `--header "K: V"` (and the
 * no-space `"Authorization:${VAR}"` variant) → headers; `--transport sse-only|http-only` hints.
 */
function unwrapMcpRemote(c: McpSnippetCandidate): McpSnippetCandidate {
  if (c.url || !c.args) return c
  const idx = c.args.findIndex((a) => a === 'mcp-remote' || a.endsWith('/mcp-remote'))
  if (idx === -1) return c

  const rest = c.args.slice(idx + 1)
  const headers: Record<string, string> = { ...c.headers }
  let url: string | undefined
  let sawPositional = false
  let transportHint: McpSnippetCandidate['transportHint']

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i]!
    if (t === '--header' || t === '-H') {
      addHeader(headers, rest[++i])
    } else if (t === '--transport') {
      const v = rest[++i]
      if (v?.startsWith('sse')) transportHint = 'sse'
      else if (v?.startsWith('http')) transportHint = 'http'
    } else if (t.startsWith('--header=')) {
      addHeader(headers, t.slice('--header='.length))
    } else if (t.startsWith('-')) {
    } else if (!sawPositional) {
      url = t // first positional = URL
      sawPositional = true
    } // second positional = callback port → ignore
  }
  if (!url) return c
  return clean({ name: c.name, url, headers, transportHint })
}

function collectPlaceholders(c: McpSnippetCandidate): string[] {
  const found = new Set<string>()
  const scan = (s: string | undefined) => {
    if (!s) return
    for (const m of s.matchAll(/\$\{(?:env:|input:)?([\w.-]+)\}/g)) found.add(m[1]!)
  }
  scan(c.url)
  for (const v of Object.values(c.headers ?? {})) scan(v)
  for (const v of Object.values(c.env ?? {})) scan(v)
  for (const a of c.args ?? []) scan(a)
  for (const p of c.placeholders ?? []) found.add(p)
  return [...found]
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/** Tokenize a shell-ish command respecting single/double quotes. */
function tokenizeShell(input: string): string[] {
  const tokens: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m = re.exec(input)
  while (m !== null) {
    tokens.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : (m[2] ?? m[3] ?? ''))
    m = re.exec(input)
  }
  return tokens
}

/** Add a `"K: V"` or no-space `"K:V"` header string to the record. */
function addHeader(headers: Record<string, string>, raw: string | undefined): void {
  if (!raw) return
  const i = raw.indexOf(':')
  if (i === -1) return
  const key = raw.slice(0, i).trim()
  const val = raw.slice(i + 1).trim()
  if (key) headers[key] = val
}

/** Add a `K=V` env string to the record. */
function addEnv(env: Record<string, string>, raw: string | undefined): void {
  if (!raw) return
  const i = raw.indexOf('=')
  if (i === -1) return
  const key = raw.slice(0, i).trim()
  if (key) env[key] = raw.slice(i + 1)
}

/** Strip markdown code fences (``` … ```), keeping the inner body. */
function stripFences(s: string): string {
  const fence = s.match(/```(?:[\w-]*)\n([\s\S]*?)```/)
  return fence?.[1] ?? s
}

/** JSON.parse with a tolerant cleanup pass (line/block comments + trailing commas). */
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    try {
      const cleaned = s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'])\/\/.*$/gm, '$1')
        .replace(/,(\s*[}\]])/g, '$1')
        // Drop stray backslashes that aren't valid JSON escapes (e.g. a pasted `\_` in a token).
        .replace(/\\(?![\\"/bfnrtu])/g, '')
      return JSON.parse(cleaned)
    } catch {
      return null
    }
  }
}

function safeBase64(s: string): string | null {
  try {
    return Buffer.from(decodeURIComponent(s), 'base64').toString('utf8')
  } catch {
    try {
      return Buffer.from(s, 'base64').toString('utf8')
    } catch {
      return null
    }
  }
}

function asStringRecord(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val
  }
  return Object.keys(out).length ? out : undefined
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === 'string')
  return out.length ? out : undefined
}

/** Drop undefined/empty fields so candidates compare cleanly in tests. */
function clean(c: McpSnippetCandidate): McpSnippetCandidate {
  const out: McpSnippetCandidate = {}
  if (c.name) out.name = c.name
  if (c.url) out.url = c.url
  if (c.headers && Object.keys(c.headers).length) out.headers = c.headers
  if (c.transportHint) out.transportHint = c.transportHint
  if (c.command) out.command = c.command
  if (c.args?.length) out.args = c.args
  if (c.env && Object.keys(c.env).length) out.env = c.env
  if (c.placeholders?.length) out.placeholders = c.placeholders
  return out
}
