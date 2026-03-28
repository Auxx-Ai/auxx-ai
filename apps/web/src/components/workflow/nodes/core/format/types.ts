// apps/web/src/components/workflow/nodes/core/format/types.ts

import type {
  CompactConfig,
  CurrencyConfig,
  FirstLastNConfig,
  FixedDecimalsConfig,
  FormatOperation,
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
} from '@auxx/lib/workflow-engine/constants'
import type { BaseNodeData, SpecificNode } from '~/components/workflow/types'

export type { FormatOperation } from '@auxx/lib/workflow-engine/constants'

/** Main node data — extends BaseNodeData which is a frontend type */
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

export type FormatNode = SpecificNode<'format', FormatNodeData>
