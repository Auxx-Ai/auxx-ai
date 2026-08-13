// packages/lib/src/workflow-engine/catalog/nodes/format.ts

import { z } from 'zod'
// The format node's operation vocabulary and every per-operation config type
// already live in `workflow-engine/constants` (shared panel↔engine since
// #1552) — this manifest only adds the schema/defaults/validator/extraction
// on top and re-exports nothing.
import type {
  CompactConfig,
  CurrencyConfig,
  FirstLastNConfig,
  FixedDecimalsConfig,
  PadConfig,
  PercentageConfig,
  RegexMatchConfig,
  RemoveConfig,
  ReplaceConfig,
  ReplaceRegexConfig,
  SlugConfig,
  SplitConfig,
  StripHtmlConfig,
  SubstringConfig,
  TrimConfig,
  TruncateConfig,
  WrapConfig,
} from '../../constants'
import { DEFAULT_OPERATION, FormatOperation } from '../../constants'
import { extractVariableRefs } from '../../nodes/utils/variable-refs'
import type { BaseNodeData } from '../node-base'
import { NodeCategory, type NodeManifest, type NodeValidationResult } from '../types'
import { extractVarIdsFromString } from '../variable-inference'

/** Main node data */
export interface FormatNodeData extends BaseNodeData {
  operation: FormatOperation
  input: string // Rich text VarEditor value (can contain {{var}} refs)

  /** Field mode tracking (constant vs variable) */
  fieldModes?: Record<string, boolean>

  // Operation-specific configs (only one active at a time)
  trimConfig?: TrimConfig
  padConfig?: PadConfig
  truncateConfig?: TruncateConfig
  wrapConfig?: WrapConfig
  replaceConfig?: ReplaceConfig
  replaceRegexConfig?: ReplaceRegexConfig
  removeConfig?: RemoveConfig
  currencyConfig?: CurrencyConfig
  percentageConfig?: PercentageConfig
  fixedDecimalsConfig?: FixedDecimalsConfig
  compactConfig?: CompactConfig
  slugConfig?: SlugConfig
  substringConfig?: SubstringConfig
  firstLastNConfig?: FirstLastNConfig
  regexMatchConfig?: RegexMatchConfig
  splitConfig?: SplitConfig
  stripHtmlConfig?: StripHtmlConfig
}

/** Zod schema for format node validation */
export const formatNodeSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  desc: z.string().optional(),
  operation: z.nativeEnum(FormatOperation),
  input: z.string().optional(),
})

/** Validator */
export function validateFormatNodeData(data: FormatNodeData): NodeValidationResult {
  const errors: Array<{ field: string; message: string; type?: 'warning' | 'error' }> = []

  if (!data.operation) {
    errors.push({ field: 'operation', message: 'Operation is required', type: 'error' })
  }

  // Operation-specific validation
  switch (data.operation) {
    case FormatOperation.REPLACE:
      if (!data.replaceConfig?.find) {
        errors.push({
          field: 'replaceConfig.find',
          message: 'Find text is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REPLACE_REGEX:
      if (!data.replaceRegexConfig?.pattern) {
        errors.push({
          field: 'replaceRegexConfig.pattern',
          message: 'Regex pattern is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REMOVE:
      if (!data.removeConfig?.find) {
        errors.push({
          field: 'removeConfig.find',
          message: 'Find text is required',
          type: 'warning',
        })
      }
      break
    case FormatOperation.REGEX_MATCH:
      if (!data.regexMatchConfig?.pattern) {
        errors.push({
          field: 'regexMatchConfig.pattern',
          message: 'Regex pattern is required',
          type: 'warning',
        })
      }
      break
  }

  return { isValid: errors.filter((e) => e.type === 'error').length === 0, errors }
}

/**
 * Extract referenced variable IDs from format node data.
 * Scans the main input and all operation-specific VarEditor fields.
 */
export function extractFormatVariables(data: Partial<FormatNodeData>): string[] {
  const ids = new Set<string>()

  // Main rich-text input
  if (data.input) {
    extractVarIdsFromString(data.input).forEach((v) => ids.add(v))
  }

  // Rich-text config fields
  if (data.replaceConfig?.find) {
    extractVarIdsFromString(data.replaceConfig.find).forEach((v) => ids.add(v))
  }
  if (data.replaceConfig?.replaceWith) {
    extractVarIdsFromString(data.replaceConfig.replaceWith).forEach((v) => ids.add(v))
  }
  if (data.replaceRegexConfig?.replaceWith) {
    extractVarIdsFromString(data.replaceRegexConfig.replaceWith).forEach((v) => ids.add(v))
  }
  if (data.removeConfig?.find) {
    extractVarIdsFromString(data.removeConfig.find).forEach((v) => ids.add(v))
  }
  if (data.wrapConfig?.prefix) {
    extractVarIdsFromString(data.wrapConfig.prefix).forEach((v) => ids.add(v))
  }
  if (data.wrapConfig?.suffix) {
    extractVarIdsFromString(data.wrapConfig.suffix).forEach((v) => ids.add(v))
  }
  if (data.splitConfig?.delimiter) {
    extractVarIdsFromString(data.splitConfig.delimiter).forEach((v) => ids.add(v))
  }

  // Variable-mode config fields (numeric fields track their own flag; the
  // boolean/enum toggles track theirs in `fieldModes`).
  //
  // These go through `extractVariableRefs`, not `extractVarIdsFromString`: the
  // toggle's variable side is a `VarEditor` in picker mode, which writes a **bare**
  // dotted path (`node-1.result`) with no braces. Scanning only for `{{…}}` here
  // meant a picker-bound field declared no dependency at all — and because the
  // engine's resolver had the same blind spot, both sides agreed and the parity
  // suite saw nothing.
  const fieldModes = data.fieldModes ?? {}
  const varFields = [
    { value: data.trimConfig?.trimAll, isConstant: fieldModes.trimAll ?? true },
    { value: data.replaceConfig?.replaceAll, isConstant: fieldModes.replaceAll ?? true },
    { value: data.currencyConfig?.currencyCode, isConstant: fieldModes.currencyCode ?? true },
    { value: data.stripHtmlConfig?.keepLineBreaks, isConstant: fieldModes.keepLineBreaks ?? true },
    { value: data.padConfig?.length, isConstant: data.padConfig?.isLengthConstant },
    { value: data.truncateConfig?.maxLength, isConstant: data.truncateConfig?.isMaxLengthConstant },
    { value: data.substringConfig?.start, isConstant: data.substringConfig?.isStartConstant },
    { value: data.substringConfig?.end, isConstant: data.substringConfig?.isEndConstant },
    { value: data.firstLastNConfig?.count, isConstant: data.firstLastNConfig?.isCountConstant },
    {
      value: data.percentageConfig?.decimals,
      isConstant: data.percentageConfig?.isDecimalsConstant,
    },
    {
      value: data.fixedDecimalsConfig?.decimals,
      isConstant: data.fixedDecimalsConfig?.isDecimalsConstant,
    },
  ]
  for (const { value, isConstant } of varFields) {
    if (value && typeof value === 'string' && !isConstant) {
      extractVariableRefs(value).forEach((v) => ids.add(v))
    }
  }

  return Array.from(ids)
}

/**
 * Format node manifest
 */
export const formatManifest: NodeManifest<FormatNodeData> = {
  id: 'format',
  category: NodeCategory.UTILITY,
  displayName: 'Format',
  description: 'Format and transform text, numbers, and encodings',
  icon: 'text-cursor-input',
  color: '#3B82F6',
  defaultData: () => ({
    title: 'Format',
    desc: 'Format and transform text',
    operation: DEFAULT_OPERATION,
    input: '',
  }),
  configSchema: formatNodeSchema as unknown as z.ZodType<FormatNodeData>,
  validate: validateFormatNodeData,
  extractVariables: extractFormatVariables,
  connection: {
    canRunSingle: true,
  },
  agent: {
    authorable: true,
    usage:
      'Pick `operation` (FormatOperation) and fill its matching <operation>Config object. ' +
      '`input` is the text to transform and may contain {{…}} refs.',
    examples: [
      {
        description: 'Uppercase an upstream subject',
        config: { operation: 'uppercase', input: '{{trigger-1.message.subject}}' },
      },
    ],
  },
}
