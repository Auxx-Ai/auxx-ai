// apps/lambda/src/executors/code-executor.ts

/**
 * Code executor for Lambda runtime.
 *
 * Routes workflow code nodes through the sandbox child process
 * (`../sandbox/spawn.ts`). This file no longer evaluates anything itself — the
 * `new Function` call that ran user code in this realm is deleted, along with the
 * wrapper generation and `sanitizeForJson`, both of which moved into the runner so
 * they execute on the far side of the boundary.
 *
 * See `plans/lambda/security/01-sandbox-hardening-plan.md` §5, Phase B step 4.
 * This is the surface every full-seat member can reach
 * (`MEMBER_BASELINE_LEVELS[Area.workflows] = Level.Full`), so it cuts over first.
 */

import { setCapturedLogs } from '../runtime-helpers/console.ts'
import { runInSandbox } from '../sandbox/spawn.ts'
import type { ExecutionResult } from '../types.ts'
import type { CodeExecutionEvent } from '../validator.ts'

/**
 * Execute Python code (placeholder for future implementation)
 */
function executePython(): never {
  throw new Error('Python execution not yet implemented')
}

/**
 * Main code executor function.
 *
 * Executes user code in a child process with no ambient authority, with:
 * - `$` function for workflow variable access
 * - input variables passed as function parameters
 * - console log capture (performed in the child, shipped back over stdio)
 * - timeout enforcement that can preempt synchronous code
 *
 * Uses CodeExecutionEvent type from validator for type safety.
 */
export async function executeCode(options: CodeExecutionEvent): Promise<ExecutionResult> {
  const { code, codeLanguage, codeInput = {}, inputsConfig = [], variables, timeout } = options

  console.log('[CodeExecutor] Executing code:', {
    language: codeLanguage,
    timeout,
    inputCount: Object.keys(codeInput).length,
    variableCount: Object.keys(variables).length,
    workflowId: variables['sys.workflowId'],
    organizationId: variables['sys.organizationId'],
    userId: variables['sys.userId'],
  })

  if (codeLanguage === 'python3') {
    executePython()
  }

  if (codeLanguage !== 'javascript') {
    throw new Error(`Unsupported language: ${codeLanguage}`)
  }

  const outcome = await runInSandbox({ code, codeInput, inputsConfig, variables }, timeout)

  // Publish the child's logs before any throw, so the error path in index.ts
  // still reports what the code printed before it failed.
  setCapturedLogs(outcome.logs)

  if (!outcome.ok) {
    console.error('[CodeExecutor] Execution failed:', {
      failure: outcome.failure,
      logCount: outcome.logs.length,
    })

    const error = new Error(outcome.message ?? 'Code execution failed') as Error & {
      code?: string
    }
    // Preserves the 413 the handler already returns for oversized results — the
    // sandbox cap now trips before index.ts can measure the serialized body.
    if (outcome.failure === 'output_too_large') error.code = 'RESPONSE_TOO_LARGE'
    throw error
  }

  console.log('[CodeExecutor] Execution succeeded:', {
    resultType: typeof outcome.value,
    logCount: outcome.logs.length,
  })

  return {
    result: outcome.value,
    metadata: { consoleLogs: outcome.logs },
  }
}
