// packages/lib/src/workflow-engine/nodes/action-nodes/ai-v2.ts

import type { ResolvedAgentConfig } from '../../../agents'
import type { AgentEvent } from '../../../ai/agent-framework/types'
import { LLMClient } from '../../../ai/clients/base/llm-client'
import type { Message, MultiModalContent } from '../../../ai/clients/base/types'
import { buildInstructionReferenceResolver } from '../../../ai/kopilot/prompts/resolve-instruction-references'
import { collectVariableIds, docToText } from '../../../tiptap'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  Workflow,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { type BaseAiModelConfig, BaseAiNodeProcessor } from '../base-ai-node'
import type {
  InvokeOrchestratorResponse,
  StructuredOutputConfig,
} from '../utils/ai-invocation-utils'
import {
  extractModelConfig,
  logUnresolvedVariables,
  type PromptTemplate,
  resolveModelConfig,
} from '../utils/ai-node-utils'
import { type CapabilityGates, resolveCapabilityGates } from '../utils/model-capability-gates'

interface AiModelConfig extends BaseAiModelConfig {
  completion_params?: {
    temperature?: number
    max_tokens?: number
    top_p?: number
    frequency_penalty?: number
    presence_penalty?: number
    reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high'
    verbosity?: 'low' | 'medium' | 'high'
    max_completion_tokens?: number
    [key: string]: any
  }
}

/**
 * Per-toolset entry on the AI node. Shape matches `Agent.toolsets` so the
 * picker dialog and `filterToolsByToolsets` work without translation.
 */
export interface AiToolsetEntry {
  slug: string
  enabled: boolean
  config?: { enabledTools?: string[] }
  source: 'manual'
}

/**
 * Flat AI-node data shape — see `plans/workflow/ai/phase-2-ai-processor-migration.md`.
 * No legacy `tools: AiToolsConfig` block; per `project_no_production_users.md`
 * we break the shape outright.
 */
interface AiNodeConfig {
  title?: string
  desc?: string
  model: AiModelConfig
  prompt_template: PromptTemplate[]
  files?: {
    enabled: boolean
    input?: string
    isConstant?: boolean
    maxFiles?: number
    maxTotalSize?: number
  }
  structured_output?: {
    enabled: boolean
    schema?: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }

  /** Master gate for the entire tool surface on this node. */
  toolsEnabled?: boolean
  /** Per-toolset enablement. */
  toolsets?: AiToolsetEntry[]
  /** Per-app explicit credential pin. */
  appAccounts?: Record<string, { credId: string }>
  /** Approval mode reserved for future use; v1 is always `auto`. */
  approvalMode?: 'auto'
  /** Default 10 for AI node; agent default is 30. */
  maxIterations?: number

  // Legacy fields preserved for `buildMessages` only.
  prompt?: string
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  outputVariable?: string
}

/**
 * AI workflow node processor. When `toolsEnabled` is false the node executes
 * through the shared `BaseAiNodeProcessor` template (single LLM call). When
 * tools are enabled the node runs through the agent framework via
 * `runWorkflowAiTurn` — reusing the agents' `createAppCapabilities` +
 * `createNativeWorkflowCapabilities` pipeline (per
 * `plans/workflow/ai/phase-2-ai-processor-migration.md`).
 */
export class AIProcessorV2 extends BaseAiNodeProcessor {
  readonly type: WorkflowNodeType = WorkflowNodeType.AI

  // Constructor kept for back-compat with `NodeProcessorRegistry.registerDefaults`
  // which passes a `nodeRegistry` arg. The registry is now unused — workflow-node-as-tool
  // is deferred to v2 (see plan §0.4).
  constructor(_nodeRegistry?: unknown) {
    super()
  }

  /**
   * Build messages from prompt templates (or legacy prompt fields) and attach
   * file content if `files` is enabled. Identical to the previous behavior —
   * only the tools pipeline is touched in this phase.
   */
  protected async buildMessages(
    node: WorkflowNode,
    data: any,
    contextManager: ExecutionContextManager
  ): Promise<Message[]> {
    const config = data as AiNodeConfig
    const messages: Message[] = []

    if (config.prompt_template && config.prompt_template.length > 0) {
      // Phase 5: single-walk render. Each `template.json` is flattened once via
      // `docToText({ references, variables })` — chips and variable nodes are
      // substituted in the same walk; no second regex pass. Variables for the
      // whole AI-node run are resolved up front in a single batched call.
      //
      // Lazy import of `../../../agents` matches the no-tools path's pattern
      // (see `executeNodeWithTools`) — the agents barrel re-exports runtime
      // code that drags `@auxx/services` into the module graph, and
      // `buildMessages` is hot on the no-tools path too.
      const { getOrgToolCatalog, getOrgToolsetCatalog } = await import('../../../agents')

      const organizationId = (await contextManager.getVariable('sys.organizationId')) as
        | string
        | undefined
      const [toolCatalog, toolsetCatalog] = organizationId
        ? await Promise.all([
            getOrgToolCatalog(organizationId),
            getOrgToolsetCatalog(organizationId),
          ])
        : [undefined, undefined]
      const references = buildInstructionReferenceResolver({ toolCatalog, toolsetCatalog })

      // Cross-template union of variable ids — resolve once, share across templates.
      const allVarIds = [
        ...new Set(config.prompt_template.flatMap((t) => collectVariableIds(t.json))),
      ]
      const resolved = await contextManager.buildOptimizedContext(allVarIds)
      const variables = (id: string) => contextManager.formatForDisplay(resolved.get(id), id)

      for (const template of config.prompt_template) {
        const text = docToText(template.json, { references, variables })
        logUnresolvedVariables(text, contextManager, 'ai-node', template.role)
        messages.push({ role: template.role, content: text })
      }

      // Stash resolved variable map for run-log + downstream uses (Phase 4 §0.3).
      contextManager.setNodeVariable(
        node.nodeId,
        '_resolvedPromptVars',
        Object.fromEntries(resolved)
      )
    } else if (config.prompt) {
      const promptPromises: Promise<Message>[] = []
      if (config.systemPrompt) {
        promptPromises.push(
          this.interpolateVariables(config.systemPrompt, contextManager).then((content) => ({
            role: 'system' as const,
            content,
          }))
        )
      }
      promptPromises.push(
        this.interpolateVariables(config.prompt, contextManager).then((content) => ({
          role: 'user' as const,
          content,
        }))
      )
      messages.push(...(await Promise.all(promptPromises)))
    } else {
      throw new Error('No prompt configuration found')
    }

    // File attachment (unchanged from previous implementation).
    if (config.files?.enabled && config.files.input) {
      contextManager.log('INFO', node.nodeId, '[Files] Starting file attachment', {
        input: config.files.input,
        isConstant: config.files.isConstant,
      })

      const fileService = contextManager.getFileService()
      const fileContents: MultiModalContent[] = []
      let totalSize = 0
      const maxTotal = config.files.maxTotalSize ?? 20 * 1024 * 1024
      const maxFiles = config.files.maxFiles ?? 10

      let rawValue: any
      if (config.files.isConstant) {
        rawValue = config.files.input.split(',').filter(Boolean)
      } else {
        const varIds = this.extractVariableIds(config.files.input)
        rawValue =
          varIds.length > 0
            ? await this.resolveVariablePath(varIds[0]!, contextManager)
            : await this.resolveVariablePath(config.files.input, contextManager)
      }

      const fileRefs = await fileService.normalizeFileInputs(rawValue, node.nodeId)

      for (const fileRef of fileRefs) {
        if (fileContents.length >= maxFiles) {
          contextManager.log(
            'WARN',
            node.nodeId,
            'Max file count reached, skipping remaining files'
          )
          break
        }
        if (totalSize + fileRef.size > maxTotal) {
          contextManager.log(
            'WARN',
            node.nodeId,
            'File size limit reached, skipping remaining files'
          )
          break
        }
        if (!LLMClient.isSupportedFileMimeType(fileRef.mimeType)) {
          contextManager.log(
            'WARN',
            node.nodeId,
            `Skipping unsupported file type: ${fileRef.mimeType} (${fileRef.filename})`
          )
          continue
        }
        const base64 = (await fileService.getContent(fileRef, { asBase64: true })) as string
        fileContents.push(
          LLMClient.fileToMultiModalContent(
            base64,
            fileRef.mimeType,
            fileRef.filename,
            fileRef.size
          )
        )
        totalSize += fileRef.size
      }

      if (fileContents.length > 0) {
        const lastUserMsg = messages.findLast((m) => m.role === 'user')
        if (lastUserMsg) {
          const textContent: MultiModalContent = {
            type: 'text',
            data: lastUserMsg.content as string,
          }
          lastUserMsg.content = [textContent, ...fileContents]
        }
      }
    }

    return messages
  }

  /**
   * Subclass hook — used by the no-tools path. The tools path overrides
   * `executeNode` outright and never calls this.
   */
  protected async handleResponse(
    _node: WorkflowNode,
    _data: any,
    _contextManager: ExecutionContextManager,
    _response: InvokeOrchestratorResponse
  ): Promise<Partial<NodeExecutionResult>> {
    return {
      status: NodeRunningStatus.Succeeded,
      output: {},
      outputHandle: 'source',
    }
  }

  protected getStructuredOutputConfig(
    _node: WorkflowNode,
    data: any
  ): StructuredOutputConfig | undefined {
    const config = data as AiNodeConfig
    if (!config.structured_output?.enabled) return undefined
    return { enabled: true, schema: config.structured_output.schema }
  }

  /**
   * Template-method override. With tools disabled, delegate to
   * `BaseAiNodeProcessor.executeNode`. With tools enabled, run through the
   * agent framework — single source of truth for tool execution.
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const config = node.data as AiNodeConfig
    if (!config?.toolsEnabled) {
      const gates = await this.resolveGates(node, config, contextManager)
      const result = await super.executeNode(
        this.applyCapabilityGates(node, config, gates),
        contextManager,
        preprocessedData
      )
      if (gates.warnings.length > 0) {
        result.output = { ...result.output, _warnings: gates.warnings }
      }
      return result
    }
    return this.executeNodeWithTools(node, config, contextManager)
  }

  /**
   * Resolve the effective model and compute capability gates for the
   * configured features. Fails open (no gates) when the model can't be
   * resolved yet — the base execution path surfaces that error properly.
   * Skipped features are logged as run-log warnings here; the caller
   * surfaces them in `output._warnings` for the trace renderer.
   */
  private async resolveGates(
    node: WorkflowNode,
    config: AiNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<CapabilityGates> {
    const input = {
      structuredOutputEnabled: !!config?.structured_output?.enabled,
      filesEnabled: !!config?.files?.enabled,
    }
    if (!input.structuredOutputEnabled && !input.filesEnabled) {
      return { skipStructuredOutput: false, skipFiles: false, warnings: [] }
    }
    try {
      const organizationId = (await contextManager.getVariable('sys.organizationId')) as
        | string
        | undefined
      if (!organizationId) {
        return { skipStructuredOutput: false, skipFiles: false, warnings: [] }
      }
      const { model } = await resolveModelConfig(extractModelConfig(config.model), organizationId)
      const gates = resolveCapabilityGates(model, input)
      for (const warning of gates.warnings) {
        contextManager.log('WARN', node.name, warning)
      }
      return gates
    } catch {
      // Model resolution failed — fail open, base execution reports the error.
      return { skipStructuredOutput: false, skipFiles: false, warnings: [] }
    }
  }

  /**
   * Apply capability gates as a run-time-only node clone. The stored node
   * config is NEVER mutated — switching back to a capable model restores
   * everything as configured.
   */
  private applyCapabilityGates(
    node: WorkflowNode,
    config: AiNodeConfig,
    gates: CapabilityGates
  ): WorkflowNode {
    if (!gates.skipStructuredOutput && !gates.skipFiles) return node
    const data = { ...node.data } as WorkflowNode['data'] & AiNodeConfig
    if (gates.skipStructuredOutput && config.structured_output) {
      data.structured_output = { ...config.structured_output, enabled: false }
    }
    if (gates.skipFiles && config.files) {
      data.files = { ...config.files, enabled: false }
    }
    return { ...node, data }
  }

  /**
   * Tool-enabled execution path. Builds capabilities + filtered toolset, runs
   * the agent framework, optionally runs the structured-output second pass.
   */
  private async executeNodeWithTools(
    node: WorkflowNode,
    config: AiNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    const startTime = Date.now()

    // Lazy imports — keeps module load light for unit tests that never exercise
    // the agent-framework path and avoids dragging `@auxx/services` (lambda
    // execution, app connections) into modules that only need the no-tools path.
    const [{ filterToolsByToolsets }, kopilot] = await Promise.all([
      import('../../../agents'),
      import('../../../ai/kopilot'),
    ])
    const {
      createActorCapabilities,
      createAppCapabilities,
      createEntityCapabilities,
      createKbCapabilities,
      createKbReadCapabilities,
      createKnowledgeCapabilities,
      createMailCapabilities,
      createNativeWorkflowCapabilities,
      createTaskCapabilities,
      createToolDepsFactory,
      runStructuredOutputPass,
      runWorkflowAiTurn,
    } = kopilot

    const organizationId = (await contextManager.getVariable('sys.organizationId')) as string
    const userId = (await contextManager.getVariable('sys.userId')) as string
    if (!organizationId) throw new Error('Organization ID is required for AI node execution')
    if (!userId) throw new Error('User ID is required for AI node execution')

    const workflow = (await contextManager.getVariable('sys.workflow')) as Workflow | undefined
    const sessionId = workflow?.id ?? workflow?.workflowId ?? `ai-node-${node.nodeId}`

    // Resolve provider + model (defaults inherit org system default the same
    // way the no-tools path does).
    const extracted = extractModelConfig(config.model)
    const { provider, model } = await resolveModelConfig(extracted, organizationId)

    // Capability gating — skip features the resolved model explicitly can't
    // honor instead of degrading silently. Stored config is never mutated.
    const gates = resolveCapabilityGates(model, {
      structuredOutputEnabled: !!config.structured_output?.enabled,
      filesEnabled: !!config.files?.enabled,
    })
    const warnings = [...gates.warnings]
    for (const warning of gates.warnings) {
      contextManager.log('WARN', node.name, warning)
    }

    contextManager.log('INFO', node.name, 'AI node executing with tools', {
      provider,
      model,
      toolsetCount: config.toolsets?.length ?? 0,
      hasStructuredOutput: !!config.structured_output?.enabled,
    })

    // Capability factories — same pipeline the agent surface uses. The
    // built-in Auxx tools (mail / entities / knowledge / actors / tasks / KB)
    // are registered through their dedicated factories; `createAppCapabilities`
    // is for third-party installed apps only (the synthetic auxx installation
    // row has `currentDeployment: null` and is skipped by that path).
    const getToolDeps = createToolDepsFactory({
      organizationId,
      userId,
      sessionId,
      // DELIBERATELY unrestricted, and the one remaining legitimate `undefined`
      // on a production path: a workflow has no synthetic User and is not a
      // permission principal, so there is nothing to resolve (doc 14 §0.8 —
      // "Workflows are out of scope — documented follow-up"). This is stated
      // explicitly rather than achieved by omitting the property, which is why
      // `capabilities` is a required key. Fix by threading the owning user's
      // capabilities (run-as-owner) or giving workflows the same synthetic-member
      // treatment agents have; do NOT quietly widen anything else to match.
      capabilities: undefined,
    })
    const builtinCaps = [
      createEntityCapabilities(getToolDeps),
      createKnowledgeCapabilities(getToolDeps),
      createMailCapabilities(getToolDeps),
      createActorCapabilities(getToolDeps),
      createTaskCapabilities(getToolDeps),
      createKbReadCapabilities(getToolDeps),
      createKbCapabilities(getToolDeps),
    ]
    const appCaps = await createAppCapabilities({
      organizationId,
      userId,
      agentId: null,
      triggerId: null,
      sessionId,
      getToolDeps,
      // AI nodes own their own per-app credential bindings. Passing this
      // explicitly opts into the agent-style connection-presence gate
      // (workspace cred fallback allowed).
      appAccounts: config.appAccounts ?? {},
    })
    const nativeCaps = createNativeWorkflowCapabilities(getToolDeps)

    const allTools = [...builtinCaps.flatMap((c) => c.tools), ...appCaps.tools, ...nativeCaps.tools]
    const filtered = filterToolsByToolsets(allTools, this.buildResolvedAgentShim(config))

    if (filtered.length === 0) {
      contextManager.log('WARN', node.name, 'Tools enabled but no toolsets resolved', {
        toolsets: config.toolsets,
      })
    }

    // Build the prompt messages (same code path as the no-tools branch).
    // Capability gates are applied via a run-time-only clone so a skipped
    // file attachment never mutates the stored node config.
    const messages = await this.buildMessages(
      node,
      this.applyCapabilityGates(node, config, gates).data,
      contextManager
    )

    // Hand off to the agent framework.
    const turn = await runWorkflowAiTurn({
      organizationId,
      userId,
      sessionId,
      tools: filtered,
      model: { provider, model },
      messages,
      workflow: { nodeId: node.nodeId, contextManager },
      // The ECM conforms to ContextManager — hand it through as ctx.context.
      context: contextManager,
      parameters: config.model?.completion_params,
      maxIterations: config.maxIterations ?? 10,
      onEvent: (ev) => this.writeAgentEventToWorkflowLog(ev, contextManager, node.nodeId),
    })

    // Structured-output second pass (Q-7). Skipped outright when the model
    // explicitly doesn't support structured output (capability gate above).
    let structured: Record<string, unknown> | undefined
    if (
      config.structured_output?.enabled &&
      config.structured_output.schema &&
      !gates.skipStructuredOutput
    ) {
      const passResult = await runStructuredOutputPass({
        organizationId,
        userId,
        sessionId,
        workflowId: workflow?.id,
        nodeId: node.nodeId,
        model: { provider, model },
        schema: config.structured_output.schema as Record<string, unknown>,
        sourceMessage: turn.finalAssistantMessage,
        parameters: config.model?.completion_params,
      })
      if (passResult.ok) {
        structured = passResult.value
      } else {
        const warning = `Structured output pass failed: ${passResult.reason}`
        warnings.push(warning)
        contextManager.log('WARN', node.name, warning)
      }
    }

    // Standard output variables — match what `BaseAiNodeProcessor.storeAIResponse`
    // wrote so downstream nodes consume the same shape.
    const outputVariable = (config as any).outputVariable || `${node.nodeId}.text`
    contextManager.setVariable(outputVariable, turn.finalAssistantMessage)
    contextManager.setNodeVariable(node.nodeId, 'output', turn.finalAssistantMessage)
    contextManager.setNodeVariable(node.nodeId, 'text', turn.finalAssistantMessage)
    if (structured) {
      contextManager.setNodeVariable(node.nodeId, 'structured_output', structured)
      for (const [key, value] of Object.entries(structured)) {
        contextManager.setNodeVariable(node.nodeId, key, value)
      }
    }
    if (turn.toolCalls.length > 0) {
      const toolResults = turn.toolCalls.map((tc) => ({
        toolCallId: tc.toolCallId,
        toolName: tc.name,
        success: tc.success,
        output: tc.output ?? {},
        error: tc.error,
      }))
      contextManager.setNodeVariable(node.nodeId, 'tool_results', toolResults)
    }

    return {
      status: NodeRunningStatus.Succeeded,
      output: {
        text: turn.finalAssistantMessage,
        content: turn.finalAssistantMessage,
        structured_output: structured,
        tool_calls: turn.toolCalls.map((tc) => ({
          id: tc.toolCallId,
          name: tc.name,
          arguments: tc.args,
        })),
        tool_results: turn.toolCalls.map((tc) => ({
          toolCallId: tc.toolCallId,
          toolName: tc.name,
          success: tc.success,
          output: tc.output ?? {},
          error: tc.error,
        })),
        model,
        usage: turn.usage,
        ...(structured ?? {}),
        ...(warnings.length > 0 ? { _warnings: warnings } : {}),
      },
      processData: {
        model: {
          provider,
          name: model,
        },
        finalPrompts: messages.map((m) => ({ role: m.role, content: m.content })),
        structuredOutput: {
          enabled: !!config.structured_output?.enabled,
          schema: config.structured_output?.schema,
        },
        tokenUsage: turn.usage,
        executionTime: Date.now() - startTime,
      },
      metadata: {
        model,
        provider,
        promptTokens: turn.usage?.prompt_tokens,
        completionTokens: turn.usage?.completion_tokens,
        totalTokens: turn.usage?.total_tokens,
      },
      outputHandle: 'source',
    }
  }

  /**
   * Adapt the flat `nodeData` shape into the minimal `ResolvedAgentConfig`
   * surface `filterToolsByToolsets` reads — `toolsets[].slug` +
   * `toolsets[].enabledTools` (null = no per-tool list, every member tool
   * passes). Other `ResolvedAgentConfig` fields are unused by the filter and
   * are cast away.
   */
  private buildResolvedAgentShim(config: AiNodeConfig): ResolvedAgentConfig | undefined {
    const entries = (config.toolsets ?? []).filter((t) => t.enabled)
    if (entries.length === 0) return undefined
    const toolsets = entries.map((t) => ({
      slug: t.slug,
      enabledTools: Array.isArray(t.config?.enabledTools)
        ? new Set<string>(t.config.enabledTools)
        : null,
    }))
    return {
      agentId: null,
      name: 'workflow-ai-node',
      userId: null,
      prompt: null,
      description: null,
      toolsets,
      appAccounts: config.appAccounts ?? {},
      toolRestrictions: {},
      modelId: null,
    } as ResolvedAgentConfig
  }

  /**
   * Forward agent-framework events into the workflow run log. Text deltas are
   * intentionally dropped — too chatty for run logs.
   */
  private writeAgentEventToWorkflowLog(
    ev: AgentEvent,
    contextManager: ExecutionContextManager,
    nodeId: string
  ): void {
    switch (ev.type) {
      case 'tool-call-started':
        contextManager.log('INFO', nodeId, 'tool-call-start', {
          toolName: ev.name,
          args: ev.args,
        })
        return
      case 'tool-progress':
        contextManager.log('INFO', nodeId, 'tool-progress', {
          toolCallId: ev.toolCallId,
          kind: ev.kind,
          data: ev.data,
        })
        return
      case 'tool-call-completed':
        contextManager.log('INFO', nodeId, 'tool-call-finish', {
          toolCallId: ev.toolCallId,
          output: ev.output,
          digest: ev.digest,
        })
        return
      case 'tool-call-failed':
        contextManager.log('ERROR', nodeId, 'tool-call-failed', {
          toolCallId: ev.toolCallId,
          error: ev.error,
        })
        return
      case 'turn-error':
        contextManager.log('ERROR', nodeId, 'agent turn-error', { error: ev.error })
        return
      default:
        // text-delta / thinking-delta / message lifecycle events are not logged.
        return
    }
  }

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as AiNodeConfig
    const variables = new Set<string>()

    if (config.prompt_template && Array.isArray(config.prompt_template)) {
      config.prompt_template.forEach((template: PromptTemplate) => {
        if (template.json) {
          collectVariableIds(template.json).forEach((v) => variables.add(v))
        }
      })
    }

    if (config.prompt && typeof config.prompt === 'string') {
      this.extractVariableIds(config.prompt).forEach((v) => variables.add(v))
    }

    if (config.systemPrompt && typeof config.systemPrompt === 'string') {
      this.extractVariableIds(config.systemPrompt).forEach((v) => variables.add(v))
    }

    if (config.files?.enabled && config.files.input && !config.files.isConstant) {
      this.extractVariableIds(config.files.input).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as AiNodeConfig

    if (!config) {
      errors.push('AI node configuration is missing. Expected config in node.data')
      return { valid: false, errors, warnings }
    }

    if (!config.prompt_template?.length && !config.prompt) {
      const possiblePrompt =
        (config as any)?.prompt || (config as any)?.prompts || (config as any)?.messages
      if (!possiblePrompt) {
        errors.push(
          `AI node configuration is invalid. Expected 'prompt_template' array but found: ${Object.keys(
            config
          ).join(', ')}.`
        )
      }
    }

    if (!config.model?.provider && !config.model?.name && !config.model) {
      warnings.push('Model configuration is missing, will use defaults')
    }

    if (config.model?.completion_params?.temperature !== undefined) {
      const temp = config.model.completion_params.temperature
      if (typeof temp !== 'number' || temp < 0 || temp > 2) {
        errors.push('Temperature must be a number between 0 and 2')
      }
    }

    if (config.model?.completion_params?.max_tokens !== undefined) {
      const maxTokens = config.model.completion_params.max_tokens
      if (typeof maxTokens !== 'number' || maxTokens < 1) {
        errors.push('Max tokens must be a positive number')
      }
    }

    if (config.structured_output?.enabled) {
      if (!config.structured_output.schema) {
        errors.push('Structured output is enabled but no schema is defined')
      } else {
        const schema = config.structured_output.schema
        if (schema.type !== 'object') {
          errors.push('Structured output schema must have type "object"')
        }
        if (!schema.properties || Object.keys(schema.properties).length === 0) {
          errors.push('Structured output schema must define at least one property')
        }
      }
    }

    if (config.files?.enabled && !config.files.input) {
      warnings.push('Files are enabled but no file input is configured')
    }

    if (config.toolsEnabled) {
      if (config.toolsets && !Array.isArray(config.toolsets)) {
        errors.push('Toolsets must be an array')
      }
      if (config.maxIterations !== undefined) {
        if (typeof config.maxIterations !== 'number' || config.maxIterations < 1) {
          errors.push('Max iterations must be a positive number')
        }
      }
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
