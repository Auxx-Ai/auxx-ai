// apps/lambda/src/executors/__tests__/sandbox-mitigation.test.ts

/**
 * Sandbox tests — `plans/lambda/security/01-sandbox-hardening-plan.md` §9, §10.
 *
 * Two layers, and it matters which is which:
 *
 *  - **Phase A (parent-side mitigations).** A1 env sealing and A3 the response cap.
 *    These are properties of THIS process and still hold.
 *  - **Phase B (the boundary).** Untrusted code now runs in a child process with no
 *    ambient authority (`../../sandbox/spawn.ts`). Each escape attempt asserts a
 *    SPECIFIC denial — a `NotCapable`, a kill, a structured failure — never merely
 *    that a secret is absent from the output. A test that passes because a value
 *    happened to be empty is a test that keeps passing after the sandbox breaks.
 *
 * A2's `Deno` parameter shadowing is deliberately GONE and its tests with it. It was
 * an interim trick for a world where the namespace was genuinely reachable; the child
 * denies it for real, and shadowing would turn a truthful `NotCapable` into a
 * misleading `TypeError` — hiding the boundary from the tests written to prove it.
 *
 * CAVEAT ON WHAT THESE PROVE. Under `deno test` the runner is started through the dev
 * fallback, so its permissions come from command-line flags rather than being baked
 * into a compiled binary (D3). These assert the permission SET is right. That the
 * flags are genuinely baked in was verified separately against a compiled runner —
 * see the plan's §9 "Validate early" measurements.
 */

import { assertEquals, assertNotEquals, assertStringIncludes } from 'jsr:@std/assert'
import { runInSandbox } from '../../sandbox/spawn.ts'
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

/**
 * Run a body in the sandbox directly.
 *
 * Forces `NODE_ENV=development` because the A1 tests below set it to `production`,
 * and in production `resolveRunner` fails closed to the compiled `/runner` binary
 * that does not exist in a test run. Deno test order is not guaranteed, so this
 * cannot rely on running first.
 */
function runBody(body: string, timeout = 15000) {
  Deno.env.set('NODE_ENV', 'development')
  return runInSandbox(
    // `async` so bodies may `await` — a non-async wrapper turns `await import(...)`
    // into a SyntaxError, which would fail a denial test for entirely the wrong reason.
    { code: `async function main() {\n${body}\n}`, codeInput: {}, inputsConfig: [], variables: {} },
    timeout
  )
}

/** Capture the error name from inside the child, where the denial actually happens. */
function nameOfThrow(expression: string) {
  return runBody(
    `try { ${expression}; return { name: 'NO_THROW' } } catch (e) { return { name: e.name } }`
  )
}

const spawnTest = { sanitizeOps: false, sanitizeResources: false }

// ---------------------------------------------------------------------------
// §10 rows 1, 2, 10, 11, 15, 16 — capability denials
// ---------------------------------------------------------------------------

Deno.test('row 1: Deno.env.toObject() is denied', spawnTest, async () => {
  const result = await nameOfThrow('return Deno.env.toObject()')

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

Deno.test(
  'row 2: the invoke secret is unreachable, by denial not by absence',
  spawnTest,
  async () => {
    // Set it in the PARENT first. If the child could reach the environment at all,
    // this is the value it would find — so a pass here cannot be the empty-value
    // false positive the plan warns about.
    Deno.env.set('LAMBDA_INVOKE_SECRET', 'probe-secret-value')

    const result = await nameOfThrow("return Deno.env.get('LAMBDA_INVOKE_SECRET')")

    assertEquals((result.value as { name: string }).name, 'NotCapable')
    assertEquals(JSON.stringify(result).includes('probe-secret-value'), false)
  }
)

Deno.test('row 10: the filesystem is unreadable', spawnTest, async () => {
  const result = await nameOfThrow("return Deno.readTextFileSync('/etc/passwd')")

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

Deno.test('row 11: node:fs cannot reach the filesystem either', spawnTest, async () => {
  // The §4.3 bypass. Deleting `globalThis.Deno` never stopped this — node:fs kept
  // full read AND write. Only the process boundary closes it.
  const result = await runBody(`
    try {
      const fs = await import('node:fs')
      return { name: 'NO_THROW', bytes: fs.readFileSync('/etc/passwd', 'utf8').length }
    } catch (e) { return { name: e.name } }
  `)

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

Deno.test('row 15: the filesystem is unwritable', spawnTest, async () => {
  const result = await nameOfThrow("return Deno.writeTextFileSync('/tmp/pwned', 'x')")

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

Deno.test('row 9: spawning a process is denied at call time', spawnTest, async () => {
  // Two traps here, both of which produce a test that passes for the wrong reason.
  //
  // 1. Assert on .outputSync(), NEVER on `typeof Deno.Command` — the constructor is
  //    present regardless of permissions; --allow-run is enforced when it is called.
  // 2. Use an ABSOLUTE path. `clearEnv: true` (D5) leaves the child with no PATH, so
  //    a bare 'sh' fails with "no path to search ... not an absolute path" — an
  //    incidental resolution failure, not a permission denial. That would keep
  //    passing even if --allow-run were granted.
  const result = await nameOfThrow(
    "return new Deno.Command('/bin/sh', { args: ['-c', 'id'] }).outputSync()"
  )

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

Deno.test('row 16: FFI is denied', spawnTest, async () => {
  // The permission check precedes any attempt to open the library, so this asserts
  // the denial rather than the path's existence and holds on any platform.
  const result = await nameOfThrow("return Deno.dlopen('/usr/lib/libSystem.dylib', {})")

  assertEquals((result.value as { name: string }).name, 'NotCapable')
})

// ---------------------------------------------------------------------------
// §10 rows 7, 8, 13 — resource limits, and the parent surviving each one
// ---------------------------------------------------------------------------

Deno.test(
  'row 7: a synchronous infinite loop is killed, and the parent still serves',
  spawnTest,
  async () => {
    // The defect Promise.race could never fix (§2.3): a macrotask timer cannot fire
    // while `while(true)` holds the isolate. SIGKILL does not need the child's consent.
    const started = Date.now()
    const hung = await runBody('while (true) {}', 2000)
    const elapsed = Date.now() - started

    assertEquals(hung.ok, false)
    assertEquals(hung.failure, 'timeout')
    assertEquals(elapsed < 10000, true, `expected a prompt kill, took ${elapsed}ms`)

    // The property that matters more than the kill itself.
    const next = await runBody("return 'parent still serving'")
    assertEquals(next.value, 'parent still serving')
  }
)

Deno.test('row 8: a memory bomb kills only the child', spawnTest, async () => {
  // The measurement that rejected Workers (§4.2): this exact input aborted the
  // ENTIRE host process (exit 133) in a worker, and `event.preventDefault()` did
  // not help because a V8 fatal abort is not a JS error. Here it must be contained.
  const bomb = await runBody(
    'const a = []; while (true) { a.push(new Array(1e6).fill("x")) }',
    30000
  )

  assertEquals(bomb.ok, false)
  assertEquals(bomb.failure, 'out_of_memory')

  const next = await runBody("return 'parent survived the bomb'")
  assertEquals(next.value, 'parent survived the bomb')
})

Deno.test('row 13: an oversized result trips the output cap', spawnTest, async () => {
  const big = await runBody('return "x".repeat(50 * 1024 * 1024)')

  assertEquals(big.ok, false)
  assertEquals(big.failure, 'output_too_large')

  const next = await runBody("return 'parent healthy'")
  assertEquals(next.value, 'parent healthy')
})

// ---------------------------------------------------------------------------
// §10 row 14 — no authority crosses the boundary
// ---------------------------------------------------------------------------

Deno.test('row 14: callback tokens are not reachable from the child', spawnTest, async () => {
  // §8 item 1. In the parent's realm `runtime-helpers/index.ts` assigns the whole
  // RuntimeContext — tokens included — onto globalThis. Nothing may serialize it
  // across: a child holding a bearer credential gives back most of the boundary.
  const result = await runBody('return typeof globalThis.__AUXX_SERVER_CONTEXT__')

  assertEquals(result.value, 'undefined')
})

// ---------------------------------------------------------------------------
// Non-escape regressions — the boundary must not break legitimate code
// ---------------------------------------------------------------------------

Deno.test('the sanitizeForJson contract survives the boundary', spawnTest, async () => {
  // Pins the `undefined → null` guarantee now that it is applied in the child.
  Deno.env.set('NODE_ENV', 'development')
  const result = await runInSandbox(
    {
      code: 'function main() { return { present: 1, missing: undefined, nested: { gone: undefined } } }',
      codeInput: {},
      inputsConfig: [],
      variables: {},
    },
    15000
  )

  assertEquals(result.ok, true)
  assertEquals(result.value, { present: 1, missing: null, nested: { gone: null } })
})

Deno.test(
  '$(...).var() still resolves workflow variables across the boundary',
  spawnTest,
  async () => {
    Deno.env.set('NODE_ENV', 'development')
    const result = await runInSandbox(
      {
        code: "function main() { return $('sys').var('workflowId') }",
        codeInput: {},
        inputsConfig: [],
        variables: { 'sys.workflowId': 'wf_123' },
      },
      15000
    )

    assertEquals(result.value, 'wf_123')
  }
)

Deno.test('console output is captured in the child and returned', spawnTest, async () => {
  const result = await executeCode(codeEvent("console.log('from the child'); return 'done'"))

  assertEquals(result.result, 'done')
  assertEquals(result.metadata?.consoleLogs?.[0]?.message, 'from the child')
})

Deno.test(
  'a user error surfaces with its message, not as a platform crash',
  spawnTest,
  async () => {
    let message = ''
    try {
      await executeCode(codeEvent("throw new Error('deliberate user failure')"))
    } catch (error) {
      message = (error as Error).message
    }

    assertStringIncludes(message, 'deliberate user failure')
  }
)

// ---------------------------------------------------------------------------
// Phase A — parent-side mitigations, unchanged by the boundary
// ---------------------------------------------------------------------------

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

  // Restore, so a later-scheduled sandbox test does not fail closed to /runner.
  Deno.env.set('NODE_ENV', 'development')
})

Deno.test('A3: an oversized execution result is rejected, not returned', spawnTest, async () => {
  // No secret configured + NODE_ENV=development skips the inbound auth gate, so
  // the handler can be exercised directly. See index.ts:154-162.
  Deno.env.set('NODE_ENV', 'development')
  Deno.env.delete('LAMBDA_INVOKE_SECRET')

  const { handler } = await import('../../index.ts')

  const oversized = await handler({
    ...codeEvent("return 'x'.repeat(6 * 1024 * 1024)"),
  } as never)

  // Still 413 RESPONSE_TOO_LARGE, but it is now the SANDBOX's 4 MB frame cap that
  // trips rather than the handler measuring a serialized body — the child is killed
  // before it can hand the parent something that large. index.ts maps the code back
  // to 413 so the documented status is not silently downgraded to a generic 500.
  assertEquals(oversized.statusCode, 413)
  assertEquals(JSON.parse(oversized.body).error.code, 'RESPONSE_TOO_LARGE')

  // A normal-sized result still comes back 200 — the cap must not reject everything.
  const ok = await handler({ ...codeEvent("return 'small'") } as never)

  assertEquals(ok.statusCode, 200)
  assertEquals(JSON.parse(ok.body).execution_result, 'small')
})
