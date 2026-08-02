// apps/lambda/src/sandbox/runner.ts

/**
 * Untrusted-code child process — the security boundary.
 * See `plans/lambda/security/01-sandbox-hardening-plan.md` §5, D1, D3.
 *
 * Reads one `SandboxRequest` frame from stdin, evaluates the user's code, writes
 * one `SandboxResponse` frame to stdout, exits. Holds no secrets, no credentials
 * and no callback tokens, and is compiled with permissions baked in so they
 * cannot be widened at spawn time:
 *
 *   deno compile --deny-env --deny-read --deny-write --deny-ffi --deny-run --deny-sys \
 *     --v8-flags=--max-old-space-size=256 --output dist/runner src/sandbox/runner.ts
 *
 * `--allow-net` is deliberately present rather than `--deny-net` (D13): user code
 * legitimately calls out, and the egress broker that would make denial workable is
 * deferred. Unrestricted egress is far less dangerous here than the same grant on
 * the parent, because this process has nothing worth exfiltrating — see §6.1.
 *
 * NOTE ON `Deno` SHADOWING. Phase A passed `Deno` as an undefined `new Function`
 * parameter (A2), because in the parent's realm the namespace was genuinely
 * reachable. That is deliberately NOT done here. The permission set denies the
 * namespace for real, and shadowing would convert a truthful `NotCapable` into a
 * misleading `TypeError` — hiding the boundary from the very tests written to
 * prove it (§10 rows 1, 2, 9, 15, 16).
 */

import {
  decodeFrame,
  encodeFrame,
  PROTOCOL_VERSION,
  type SandboxConsoleLog,
  type SandboxRequest,
  type SandboxResponse,
} from './protocol.ts'

// ---------------------------------------------------------------------------
// Console capture (inlined rather than imported from ../runtime-helpers/console.ts,
// which is reachable from the server SDK and would widen the child's module graph)
// ---------------------------------------------------------------------------

const MAX_MESSAGE_LENGTH = 10000
const MAX_LOGS = 1000

const capturedLogs: SandboxConsoleLog[] = []

function serializeArgs(args: unknown[]): string {
  try {
    const message = args
      .map((arg) => {
        if (typeof arg === 'string') return arg
        if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg)
        if (arg === null) return 'null'
        if (arg === undefined) return 'undefined'
        try {
          return JSON.stringify(arg)
        } catch {
          return String(arg)
        }
      })
      .join(' ')

    return message.length > MAX_MESSAGE_LENGTH
      ? `${message.substring(0, MAX_MESSAGE_LENGTH)}... [truncated]`
      : message
  } catch {
    return '[Error serializing arguments]'
  }
}

/**
 * Redirect console to the capture buffer.
 *
 * Every level must be redirected, not just captured: stdout is the response
 * channel, so a stray `console.log` in user code would corrupt the frame the
 * parent is trying to parse.
 */
function interceptConsole(): void {
  const capture =
    (level: SandboxConsoleLog['level']) =>
    (...args: unknown[]) => {
      if (capturedLogs.length >= MAX_LOGS) return
      capturedLogs.push({
        level,
        message: serializeArgs(args),
        args: [],
        timestamp: Date.now(),
      })
    }

  console.log = capture('log')
  console.info = capture('log')
  console.debug = capture('log')
  console.warn = capture('warn')
  console.error = capture('error')
}

// ---------------------------------------------------------------------------
// Variable access — ported verbatim from code-executor.ts so `$('sys').var(...)`
// behaves identically across the new boundary
// ---------------------------------------------------------------------------

function resolveVariablePath(path: string, variables: Record<string, any>): any {
  if (variables[path] !== undefined) {
    return variables[path]
  }

  const underscorePath = path.replace(/\./g, '_')
  if (variables[underscorePath] !== undefined) {
    return variables[underscorePath]
  }

  const parts = path.split('.')
  if (parts.length > 1) {
    const rootValue = variables[parts[0]]
    if (rootValue && typeof rootValue === 'object') {
      return getNestedProperty(rootValue, parts.slice(1).join('.'))
    }
  }

  return undefined
}

function getNestedProperty(obj: any, path: string): any {
  return path.split('.').reduce((current, prop) => {
    if (current === null || current === undefined) return undefined

    const arrayMatch = prop.match(/^(.+)\[(\d+)\]$/)
    if (arrayMatch) {
      const [, arrayProp, index] = arrayMatch
      const array = current[arrayProp]
      return Array.isArray(array) ? array[parseInt(index, 10)] : undefined
    }

    return current[prop]
  }, obj)
}

function isSchemaContext(contextId: string): boolean {
  return ['message', 'order', 'customer', 'product', 'ticket', 'user'].includes(contextId)
}

function generateWrappedCode(
  userCode: string,
  inputsConfig: Array<{ name: string; variableId: string }>
): string {
  const argList = inputsConfig.map((input) => `codeInput.${input.name}`).join(', ')

  return `
    return (async function() {
      'use strict';

      const __variables = variables;

      ${resolveVariablePath.toString()}
      ${getNestedProperty.toString()}
      ${isSchemaContext.toString()}

      const $ = function(contextId) {
        return {
          var: function(varPath) {
            const fullPath = contextId + '.' + varPath;
            return resolveVariablePath(fullPath, __variables);
          }
        };
      };

      // User's code
      ${userCode}

      if (typeof main === 'function') {
        const argValues = [${argList}];
        return await main(...argValues);
      } else {
        throw new Error('Code must define a main() function');
      }
    })()
  `
}

/**
 * Convert `undefined` to `null` so object structure survives `JSON.stringify`.
 * Moved here from `code-executor.ts` per §5.1 so the contract holds on the side
 * of the boundary that produces the value.
 */
function sanitizeForJson(obj: any): any {
  if (obj === undefined) return null
  if (obj === null) return null
  if (typeof obj !== 'object') return obj

  if (Array.isArray(obj)) {
    return obj.map(sanitizeForJson)
  }

  const sanitized: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    sanitized[key] = value === undefined ? null : sanitizeForJson(value)
  }
  return sanitized
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = []
  const reader = Deno.stdin.readable.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  return new TextDecoder().decode(merged)
}

async function writeResponse(response: SandboxResponse): Promise<void> {
  await Deno.stdout.write(encodeFrame(response))
}

async function main(): Promise<void> {
  // Capture BEFORE any user code runs, so nothing user-authored reaches stdout.
  interceptConsole()

  const raw = await readStdin()
  const request = decodeFrame<SandboxRequest>(raw.trim())

  if (!request || request.v !== PROTOCOL_VERSION) {
    await writeResponse({
      ok: false,
      error: { name: 'ProtocolError', message: 'malformed or unsupported request frame' },
      logs: [],
    })
    Deno.exit(2)
  }

  try {
    const wrapped = generateWrappedCode(request.code, request.inputsConfig ?? [])
    const fn = new Function('variables', 'codeInput', wrapped)
    const value = await fn(request.variables ?? {}, request.codeInput ?? {})

    await writeResponse({ ok: true, value: sanitizeForJson(value), logs: capturedLogs })
  } catch (error) {
    const err = error as Error
    await writeResponse({
      ok: false,
      error: {
        name: err?.name ?? 'Error',
        message: err?.message ?? String(error),
        stack: err?.stack,
      },
      logs: capturedLogs,
    })
  }
}

await main()
