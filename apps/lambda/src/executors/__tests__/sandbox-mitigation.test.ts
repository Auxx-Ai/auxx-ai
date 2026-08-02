// apps/lambda/src/executors/__tests__/sandbox-mitigation.test.ts

/**
 * Phase A mitigation tests — `plans/lambda/security/01-sandbox-hardening-plan.md` §9.
 *
 * These pin the interim mitigations, NOT isolation. User code still shares this
 * realm; the boundary arrives with Phase B (child process). What is asserted here:
 *
 *  - A1  secrets are removed from the environment after boot, so a code node that
 *        reaches the environment finds nothing (the non-bypassable part)
 *  - A2  a bare `Deno` reference in user code resolves to the shadowed parameter
 *        (defense in depth — `globalThis.Deno` deliberately still works, and the
 *        test pins that it does, so nobody mistakes this for the boundary)
 *
 * A3 (response cap) is asserted against the handler in index.ts, not here.
 */

import { assertEquals, assertNotEquals } from 'jsr:@std/assert'
import { executeCode } from '../code-executor.ts'

function codeEvent(body: string) {
  return {
    type: 'code' as const,
    code: `function main() {\n${body}\n}`,
    codeLanguage: 'javascript' as const,
    codeInput: {},
    inputsConfig: [],
    variables: {},
    timeout: 5000,
    memoryLimit: 512,
  }
}

Deno.test('A2: a bare `Deno` reference in user code is shadowed, not the namespace', async () => {
  const result = await executeCode(codeEvent('return typeof Deno'))

  assertEquals(result.result, 'undefined')
})

Deno.test('A2: `Deno.env.get` in user code throws rather than returning a secret', async () => {
  const result = await executeCode(
    codeEvent(`
      try { return { value: Deno.env.get('LAMBDA_INVOKE_SECRET') } }
      catch (e) { return { threw: e.constructor.name } }
    `)
  )

  assertEquals((result.result as { threw?: string }).threw, 'TypeError')
})

Deno.test('A2 is NOT the boundary: globalThis.Deno still reaches the namespace', async () => {
  // Pinned deliberately. Parameter shadowing raises the bar for casual access; it
  // does not contain hostile code. If this ever starts failing because someone
  // deleted the global instead, read the comment in code-executor.ts first —
  // global deletion is process-wide and breaks concurrent invocations.
  const result = await executeCode(codeEvent('return typeof globalThis.Deno'))

  assertEquals(result.result, 'object')
})

Deno.test('A1: sealed secrets are absent from the environment', async () => {
  // Mirrors what sealEnvironment() guarantees at boot. Set a value, seal, and
  // confirm the variable is gone from the process — not merely hidden behind a
  // global that another route could reach.
  Deno.env.set('LAMBDA_INVOKE_SECRET', 'probe-value')
  assertEquals(Deno.env.get('LAMBDA_INVOKE_SECRET'), 'probe-value')

  const { sealEnvironment } = await import('../../secrets.ts')
  sealEnvironment()

  assertEquals(Deno.env.get('LAMBDA_INVOKE_SECRET'), undefined)
  assertEquals(Deno.env.get('S3_ACCESS_KEY_ID'), undefined)
  assertEquals(Deno.env.get('S3_SECRET_ACCESS_KEY'), undefined)
})

Deno.test('A1: sealing does not disturb variables the service still needs', async () => {
  Deno.env.set('NODE_ENV', 'production')

  const { sealEnvironment } = await import('../../secrets.ts')
  sealEnvironment()

  assertNotEquals(Deno.env.get('NODE_ENV'), undefined)
})

Deno.test('A3: an oversized execution result is rejected, not returned', async () => {
  // No secret configured + NODE_ENV=development skips the inbound auth gate, so
  // the handler can be exercised directly. See index.ts:154-162.
  Deno.env.set('NODE_ENV', 'development')
  Deno.env.delete('LAMBDA_INVOKE_SECRET')

  const { handler } = await import('../../index.ts')

  const oversized = await handler({
    ...codeEvent("return 'x'.repeat(6 * 1024 * 1024)"),
  } as never)

  assertEquals(oversized.statusCode, 413)
  assertEquals(JSON.parse(oversized.body).error.code, 'RESPONSE_TOO_LARGE')

  // A normal-sized result still comes back 200 — the cap must not reject everything.
  const ok = await handler({ ...codeEvent("return 'small'") } as never)

  assertEquals(ok.statusCode, 200)
  assertEquals(JSON.parse(ok.body).execution_result, 'small')
})
