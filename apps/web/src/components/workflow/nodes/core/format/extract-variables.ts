// apps/web/src/components/workflow/nodes/core/format/extract-variables.ts

import { extractVarIdsFromString } from '~/components/workflow/ui/input-editor/tiptap-converters'
import type { FormatNodeData } from './types'

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

  // Variable-mode numeric fields
  const varFields = [
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
      extractVarIdsFromString(value).forEach((v) => ids.add(v))
    }
  }

  return Array.from(ids)
}
