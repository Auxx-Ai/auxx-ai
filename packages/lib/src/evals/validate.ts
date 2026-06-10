// packages/lib/src/evals/validate.ts
//
// Pre-run validation for a case — the diagnostics the `eval.validate` endpoint
// surfaces. Resolves the effective agent toolset + pinned compiled procedures and
// reports the cheaply-checkable problems: missing/invalid pinned version, agent
// not found, mocks targeting tools absent from the effective toolset, unused
// mocks, an unsupported full-clock-freeze expectation, and empty assertions.
// See plans/evals/phase-1-agent-simulation.md §1.10.

import type { AgentEvalAssertion, AgentEvalTarget, SimulationConfig } from '@auxx/types/evals'
import type { CompiledProcedure } from '../agents/procedures'
import { getProcedureVersionById, readCompiled } from '../agents/procedures'
import { toolCategory } from '../agents/tool-visibility'
import { buildEffectiveAgentRuntime } from '../ai/agent-framework/effective-runtime'
import { getCachedAgentById } from '../cache'

export interface ValidateEvalCaseInput {
  organizationId: string
  userId: string
  target: AgentEvalTarget
  config: SimulationConfig
  assertions: AgentEvalAssertion[]
}

export interface EvalValidationReport {
  ok: boolean
  errors: string[]
  warnings: string[]
}

export async function validateEvalCase(
  input: ValidateEvalCaseInput
): Promise<EvalValidationReport> {
  const { organizationId, userId, target, config, assertions } = input
  const errors: string[] = []
  const warnings: string[] = []

  // Agent must exist in the org.
  const agent = await getCachedAgentById(organizationId, target.agentId)
  if (!agent) errors.push(`Agent not found: ${target.agentId}`)

  // Pinned procedure (procedure scope) must exist + compile.
  let compiledSet: CompiledProcedure[] = []
  if (target.scope === 'procedure') {
    const version = await getProcedureVersionById({
      organizationId,
      procedureVersionId: target.procedureVersionId,
    })
    if (version.isErr() || !version.value) {
      errors.push(`Pinned procedure version not found: ${target.procedureVersionId}`)
    } else {
      const compiled = readCompiled(version.value)
      if (!compiled) errors.push(`Pinned procedure version is not compiled`)
      else compiledSet = [compiled]
      // The pinned version must belong to the targeted procedure.
      if (version.value.procedureId !== target.procedureId) {
        errors.push('Pinned version does not belong to the targeted procedure')
      }
    }
  } else {
    compiledSet = (agent?.procedures ?? []).map((p) => p.compiled)
  }

  // Resolve the effective toolset (best-effort; skip if the agent is missing).
  if (agent) {
    const runtime = await buildEffectiveAgentRuntime({
      organizationId,
      userId,
      sessionId: `eval-validate-${target.agentId}`,
      agentId: target.agentId,
      domain: 'kopilot',
      hasProcedures: compiledSet.length > 0,
    })
    const toolNames = new Set(runtime.tools.map((t) => t.name))
    // Control tools (procedure/plan signals) pass through unwrapped in sims, so a
    // mock against one can never match. Possible only for legacy rows — the editor
    // no longer offers them.
    const controlToolNames = new Set(
      runtime.tools.filter((t) => toolCategory(t) === 'control').map((t) => t.name)
    )

    // Mocks targeting a tool the agent can't call are dead config.
    const seen = new Set<string>()
    for (const mock of config.connectorMocks) {
      if (!toolNames.has(mock.toolName)) {
        warnings.push(`Mock targets tool "${mock.toolName}" which is not in the effective toolset`)
      } else if (controlToolNames.has(mock.toolName)) {
        warnings.push(
          `Mock targets control tool "${mock.toolName}"; control tools run unwrapped in simulations, so the mock will never match`
        )
      }
      seen.add(mock.toolName)
    }

    // Tools the procedure references that have no literal mock ride the live
    // example default (or run live under passthrough) — surface it so a
    // contradictory canned example doesn't silently poison the conversation
    // (the scenario says order #10483, the example says #2088). Scoped to
    // `tool:` chips in the compiled docs; un-referenced tools stay quiet (the
    // trace's resolution badge self-explains at run time).
    const referenced = collectReferencedToolNames(compiledSet)
    for (const tool of runtime.tools) {
      if (!referenced.has(tool.name) || seen.has(tool.name)) continue
      if (toolCategory(tool) === 'control') continue
      if (tool.exampleOutput !== undefined) {
        warnings.push(
          `Tool "${tool.name}" has no mock; it will return its live default example — verify the example is consistent with this scenario (ids, amounts, names)`
        )
      } else if (
        config.unmatchedToolPolicy === 'passthrough_readonly' &&
        tool.idempotent === true
      ) {
        warnings.push(
          `Tool "${tool.name}" has no mock and no default example; it will execute for real (read-only passthrough)`
        )
      }
    }

    // Assertions referencing a tool absent from the toolset can never pass.
    for (const a of assertions) {
      if (
        (a.type === 'tool_called' || a.type === 'tool_not_called') &&
        !toolNames.has(a.data.toolName)
      ) {
        if (a.type === 'tool_called') {
          warnings.push(
            `Assertion expects tool "${a.data.toolName}" which is not in the effective toolset`
          )
        }
      }
    }
  }

  // Unsupported full clock freeze: a code step's `Date.now()` isn't frozen in v1.
  if (config.timeFrozenAt && compiledSet.some((c) => Object.keys(c.codeBlocks).length > 0)) {
    warnings.push(
      'timeFrozenAt is set but a compiled procedure contains code steps; their direct Date.now() calls are not frozen in v1'
    )
  }

  if (assertions.length === 0) errors.push('A case must declare at least one assertion')

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Collect the tool names referenced by `tool:<name>` chips in the compiled
 * procedures' instruction docs. Pure; unknown node shapes are ignored.
 */
export function collectReferencedToolNames(compiledSet: CompiledProcedure[]): Set<string> {
  const names = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; attrs?: { id?: unknown }; content?: unknown[] }
    if (
      n.type === 'reference' &&
      typeof n.attrs?.id === 'string' &&
      n.attrs.id.startsWith('tool:')
    ) {
      const name = n.attrs.id.slice('tool:'.length)
      if (name) names.add(name)
    }
    if (Array.isArray(n.content)) for (const child of n.content) visit(child)
  }
  for (const compiled of compiledSet) {
    for (const step of Object.values(compiled.steps)) {
      if (step.kind === 'instruction') visit(step.doc)
    }
  }
  return names
}
