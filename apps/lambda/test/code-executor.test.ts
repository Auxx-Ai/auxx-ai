// apps/lambda/test/code-executor.test.ts

/**
 * Executor-level contract test for the v9 procedures code step. The executor builds
 * `main(...)`'s arg list positionally from `inputsConfig` — it does NOT pass `codeInput`
 * whole. v9 wraps the ambient `{ vars, subject }` bag under ONE named input (`inputs`) so
 * the wrapper emits `main(codeInput.inputs)` and `function main(inputs)` receives the bag.
 * These tests pin that end-to-end (the stepper test mocks `runCode`, so it can't).
 */

import { assertEquals } from 'jsr:@std/assert'
import { executeCode } from '../src/executors/code-executor.ts'

const INPUTS_CONFIG = [{ name: 'inputs', variableId: 'inputs' }]

Deno.test('main(inputs) receives the ambient bag and reads inputs.vars.<attr>', async () => {
  const result = await executeCode({
    type: 'code',
    code: `function main(inputs) { return { doubled: inputs.vars.cartTotal * 2 } }`,
    codeLanguage: 'javascript',
    codeInput: { inputs: { vars: { cartTotal: 21 }, subject: {} } },
    inputsConfig: INPUTS_CONFIG,
    variables: {},
    timeout: 5000,
  } as any)

  assertEquals(result.result.doubled, 42)
})

Deno.test('an unwritten attribute gates to undefined (no throw)', async () => {
  const result = await executeCode({
    type: 'code',
    // `null` because sanitizeForJson maps undefined → null on the way out.
    code: `function main(inputs) { return { seen: inputs.vars.missing ?? 'GATE' } }`,
    codeLanguage: 'javascript',
    codeInput: { inputs: { vars: { missing: undefined }, subject: {} } },
    inputsConfig: INPUTS_CONFIG,
    variables: {},
    timeout: 5000,
  } as any)

  assertEquals(result.result.seen, 'GATE')
})

Deno.test('inputs.subject is reachable and empty on internal runs', async () => {
  const result = await executeCode({
    type: 'code',
    code: `function main(inputs) { return { keys: Object.keys(inputs.subject) } }`,
    codeLanguage: 'javascript',
    codeInput: { inputs: { vars: {}, subject: {} } },
    inputsConfig: INPUTS_CONFIG,
    variables: {},
    timeout: 5000,
  } as any)

  assertEquals(result.result.keys, [])
})
