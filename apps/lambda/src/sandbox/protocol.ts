// apps/lambda/src/sandbox/protocol.ts

/**
 * Wire protocol between the parent service and the untrusted-code child process.
 * See `plans/lambda/security/01-sandbox-hardening-plan.md` §5.
 *
 * One request in, one response out, newline-delimited JSON on stdin/stdout.
 *
 * DELIBERATELY DEPENDENCY-FREE. This module is imported by `runner.ts`, which is
 * a separate `deno compile` target, and the child's module graph is part of its
 * security posture: nothing here may pull in `../types.ts` (→ `validator.ts` → zod)
 * or anything that reaches the AWS SDK. `SandboxConsoleLog` is therefore a
 * structural copy of `ConsoleLog` from `../types.ts` rather than an import.
 *
 * Nothing carrying authority may be added to `SandboxRequest`. In particular
 * callback tokens must never cross this boundary (§8 item 1) — a child that holds
 * a bearer credential has given back most of what the process boundary bought.
 */

export const PROTOCOL_VERSION = 1

/** Structural copy of `ConsoleLog` (`../types.ts`) — see the no-imports note above. */
export interface SandboxConsoleLog {
  level: 'log' | 'warn' | 'error'
  message: string
  args: unknown[]
  timestamp: number
}

/** Parent → child. Everything the child needs, and nothing more. */
export interface SandboxRequest {
  v: typeof PROTOCOL_VERSION
  code: string
  codeInput: Record<string, unknown>
  inputsConfig: Array<{ name: string; variableId: string }>
  variables: Record<string, unknown>
}

export interface SandboxOk {
  ok: true
  value: unknown
  logs: SandboxConsoleLog[]
}

export interface SandboxErr {
  ok: false
  /**
   * Structured rather than a formatted string so the parent decides what to
   * surface. `stack` is included for the parent's logs but must not be echoed
   * to callers — V8 traces leak host paths and layout (§7).
   */
  error: { name: string; message: string; stack?: string }
  logs: SandboxConsoleLog[]
}

export type SandboxResponse = SandboxOk | SandboxErr

/** Serialize a frame, newline-terminated. Throws if the value is not serializable. */
export function encodeFrame(value: SandboxRequest | SandboxResponse): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`)
}

/**
 * Parse a frame. Returns `null` rather than throwing on malformed input — the
 * child is untrusted and a crash-on-parse would be a denial-of-service lever on
 * the parent.
 */
export function decodeFrame<T extends SandboxRequest | SandboxResponse>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as T) : null
  } catch {
    return null
  }
}
