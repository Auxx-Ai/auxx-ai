// packages/lib/src/workflow-engine/nodes/form-input/form-input-processor.ts

import { createScopedLogger } from '@auxx/logger'
import {
  type FormInputNodeData as CatalogFormInputNodeData,
  isEmptyFormInputValue,
  isMultiSelect,
  type TypeOptions,
} from '../../catalog/nodes/form-input'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  NodeProcessor,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { BaseType, NodeRunningStatus } from '../../core/types'

const logger = createScopedLogger('form-input-processor')

/**
 * The option shapes are the catalog's — re-exported here (rather than
 * re-declared, as they were until the migration) because
 * `nodes/trigger-nodes/manual.ts` imports `TypeOptions` from this module.
 */
export type {
  AddressTypeOptions,
  CurrencyTypeOptions,
  EnumOption,
  FileTypeOptions,
  TypeOptions,
} from '../../catalog/nodes/form-input'

/**
 * The slice of the persisted form-input config this processor reads.
 * `inputType` is optional here — the processor defaults it — while the catalog
 * data interface always carries one.
 */
type FormInputNodeConfig = Pick<
  CatalogFormInputNodeData,
  'label' | 'required' | 'defaultValue' | 'typeOptions'
> & {
  inputType?: BaseType
}

/**
 * Apply the output variables a form-input node declares — `value` (expanded per
 * type), plus the common `label` / `inputType` / `isEmpty`.
 *
 * Lives at module scope with two callers on purpose. Form-input nodes wired into
 * a trigger are NON_EXECUTABLE, so `FormInputNodeProcessor.execute` never runs for
 * them and `ManualTriggerProcessor` has to publish the same contract. Two copies
 * of this switch is how `{{node.value}}` silently resolved to empty.
 */
export function applyFormInputOutputVariables(params: {
  nodeId: string
  value: unknown
  inputType: BaseType
  typeOptions?: TypeOptions
  /** Omitted when the caller cannot resolve it — better absent than wrong. */
  label?: string
  ctx: ExecutionContextManager
}): void {
  const { nodeId, value, inputType, typeOptions, label, ctx } = params

  setTypedOutputVariables(nodeId, value, inputType, typeOptions, ctx)

  if (label !== undefined) ctx.setNodeVariable(nodeId, 'label', label)
  ctx.setNodeVariable(nodeId, 'inputType', inputType)
  ctx.setNodeVariable(nodeId, 'isEmpty', isEmptyFormInputValue(value))
}

/**
 * Form Input Node Processor
 *
 * A lightweight processor for form-input nodes that doesn't extend BaseNodeProcessor.
 * Form input nodes are data sources, not data processors - they don't resolve
 * upstream variables or perform complex preprocessing.
 *
 * Flow:
 * 1. ManualTriggerProcessor injects user value via contextManager.setVariable(nodeId, value)
 * 2. FormInputNodeProcessor reads that value
 * 3. Transforms based on inputType (ADDRESS→nested, FILE→structured, etc.)
 * 4. Sets output variables via contextManager.setNodeVariable()
 */
export class FormInputNodeProcessor implements NodeProcessor {
  readonly type = 'form-input'

  /**
   * Minimal preprocessing - no variable resolution needed
   * Input nodes receive their data from triggerData, not upstream nodes
   */
  async preprocessNode(
    node: WorkflowNode,
    _contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as FormInputNodeConfig

    // Just pass through config - no variable resolution
    return {
      inputs: {
        label: config.label || 'Input',
        inputType: config.inputType || BaseType.STRING,
        required: config.required || false,
        defaultValue: config.defaultValue,
        typeOptions: config.typeOptions,
      },
      metadata: {
        nodeType: 'input',
        inputType: config.inputType || BaseType.STRING,
      },
    }
  }

  /**
   * Execute - read pre-injected value and set output variables
   */
  async execute(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now()
    const nodeId = node.nodeId
    const inputs = preprocessedData?.inputs || {}

    const inputType = (inputs.inputType as BaseType) || BaseType.STRING
    const required = inputs.required as boolean
    const defaultValue = inputs.defaultValue
    const label = inputs.label as string
    const typeOptions = inputs.typeOptions as TypeOptions | undefined

    logger.debug('Executing form-input node', { nodeId, inputType, label, required })

    try {
      // 1. Get pre-injected value (set by ManualTriggerProcessor)
      let value = await contextManager.getVariable(nodeId)

      logger.debug('Retrieved value from context', {
        nodeId,
        hasValue: value !== undefined && value !== null,
        valueType: typeof value,
      })

      // 2. Apply default if empty
      if (value === undefined || value === null || value === '') {
        value = defaultValue
      }

      // 3. Calculate isEmpty for output variables
      // Note: Required validation is now handled pre-execution at the API layer
      const isEmpty = value === undefined || value === null || value === ''

      // 4/5. Set the declared output variables — same contract the manual trigger
      // publishes for form-input nodes that never execute.
      applyFormInputOutputVariables({
        nodeId,
        value,
        inputType,
        typeOptions,
        label,
        ctx: contextManager,
      })

      logger.debug('Form-input node executed successfully', { nodeId, inputType, isEmpty })

      return {
        nodeId,
        status: NodeRunningStatus.Succeeded,
        output: { value, label, inputType, isEmpty },
        outputHandle: 'source',
        executionTime: Date.now() - startTime,
      }
    } catch (error) {
      logger.error('Form-input node execution failed', {
        nodeId,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        nodeId,
        status: NodeRunningStatus.Failed,
        error: error instanceof Error ? error.message : 'Input processing failed',
        executionTime: Date.now() - startTime,
      }
    }
  }

  /**
   * Validate node configuration
   */
  async validate(node: WorkflowNode): Promise<ValidationResult> {
    const config = node.data as unknown as FormInputNodeConfig
    const errors: string[] = []
    const warnings: string[] = []

    if (!config.label?.trim()) {
      errors.push('Label is required')
    }

    if (config.inputType === BaseType.ENUM && !config.typeOptions?.enum?.options?.length) {
      warnings.push('Select type has no options defined')
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}

/**
 * Set the type-specific `value` output(s) for a form-input node.
 */
function setTypedOutputVariables(
  nodeId: string,
  value: unknown,
  inputType: BaseType,
  typeOptions: TypeOptions | undefined,
  ctx: ExecutionContextManager
): void {
  // A multi Select submits an array and therefore writes the array contract
  // (`values` + `count`), exactly as the catalog's `getFormInputOutputVariables`
  // advertises for it. Both sides route through `isMultiSelect` so they cannot
  // disagree about which shape a node produces.
  if (isMultiSelect({ inputType, typeOptions })) {
    setArrayOutputs(nodeId, value, ctx)
    return
  }

  switch (inputType) {
    case BaseType.ADDRESS:
      setAddressOutputs(nodeId, value, ctx)
      break

    case BaseType.FILE:
      setFileOutputs(nodeId, value, typeOptions?.file?.allowMultiple ?? false, ctx)
      break

    // TAGS and ARRAY are inherently multi-value. Both MUST land here: the
    // catalog's `getFormInputOutputVariables` advertises `values`/`count` for
    // the pair, so routing only TAGS left an ARRAY input publishing a scalar
    // `value` while its declared contract promised an array — the exact
    // mismatch that makes a downstream Loop fail with "Expected array but got
    // undefined".
    case BaseType.TAGS:
    case BaseType.ARRAY:
      setArrayOutputs(nodeId, value, ctx)
      break

    case BaseType.CURRENCY:
      setCurrencyOutputs(nodeId, value, typeOptions?.currency?.currencyCode ?? 'USD', ctx)
      break

    default:
      // Simple types: STRING, NUMBER, BOOLEAN, EMAIL, URL, PHONE, DATE, DATETIME, TIME,
      // and a single Select.
      ctx.setNodeVariable(nodeId, 'value', value)
  }
}

/**
 * Set ADDRESS type outputs (nested structure)
 */
function setAddressOutputs(nodeId: string, value: unknown, ctx: ExecutionContextManager): void {
  const addr = typeof value === 'object' && value !== null ? (value as Record<string, string>) : {}

  ctx.setNodeVariable(nodeId, 'value', addr)
  ctx.setNodeVariable(nodeId, 'value.street1', addr.street1 || '')
  ctx.setNodeVariable(nodeId, 'value.street2', addr.street2 || '')
  ctx.setNodeVariable(nodeId, 'value.city', addr.city || '')
  ctx.setNodeVariable(nodeId, 'value.state', addr.state || '')
  ctx.setNodeVariable(nodeId, 'value.zipCode', addr.zipCode || '')
  ctx.setNodeVariable(nodeId, 'value.country', addr.country || '')
}

/**
 * Set FILE type outputs
 * NOTE: ManualTriggerProcessor already structures file data
 */
function setFileOutputs(
  nodeId: string,
  value: unknown,
  allowMultiple: boolean,
  ctx: ExecutionContextManager
): void {
  interface FileData {
    id?: string
    fileId?: string
    filename?: string
    size?: number
    mimeType?: string
    url?: string
  }

  if (allowMultiple) {
    const files = Array.isArray(value)
      ? (value as FileData[])
      : (value as { files?: FileData[] })?.files || []
    ctx.setNodeVariable(nodeId, 'files', files)
    ctx.setNodeVariable(nodeId, 'files.count', files.length)
    ctx.setNodeVariable(
      nodeId,
      'files.totalSize',
      files.reduce((sum: number, f: FileData) => sum + (f.size || 0), 0)
    )
  } else {
    const file = Array.isArray(value)
      ? (value as FileData[])[0]
      : (value as { file?: FileData })?.file || (value as FileData)
    ctx.setNodeVariable(nodeId, 'file', file || null)
    if (file) {
      ctx.setNodeVariable(nodeId, 'file.id', file.id || file.fileId || '')
      ctx.setNodeVariable(nodeId, 'file.filename', file.filename || '')
      ctx.setNodeVariable(nodeId, 'file.size', file.size || 0)
      ctx.setNodeVariable(nodeId, 'file.mimeType', file.mimeType || '')
      ctx.setNodeVariable(nodeId, 'file.url', file.url || '')
    }
  }
}

/**
 * Set TAGS/array type outputs
 */
function setArrayOutputs(nodeId: string, value: unknown, ctx: ExecutionContextManager): void {
  const values = Array.isArray(value) ? value : []
  ctx.setNodeVariable(nodeId, 'values', values)
  ctx.setNodeVariable(nodeId, 'count', values.length)
}

/**
 * Set CURRENCY type outputs
 */
function setCurrencyOutputs(
  nodeId: string,
  value: unknown,
  currencyCode: string,
  ctx: ExecutionContextManager
): void {
  let amount: number
  let currency: string

  if (typeof value === 'object' && value !== null) {
    const currencyValue = value as { amount?: number; currency?: string }
    amount = currencyValue.amount || 0
    currency = currencyValue.currency || currencyCode
  } else {
    amount = typeof value === 'number' ? value : parseFloat(String(value)) || 0
    currency = currencyCode
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount)

  ctx.setNodeVariable(nodeId, 'value', { amount, currency, formatted })
  ctx.setNodeVariable(nodeId, 'value.amount', amount)
  ctx.setNodeVariable(nodeId, 'value.currency', currency)
  ctx.setNodeVariable(nodeId, 'value.formatted', formatted)
}
