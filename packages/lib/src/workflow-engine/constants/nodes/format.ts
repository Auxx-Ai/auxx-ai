// packages/lib/src/workflow-engine/constants/nodes/format.ts

import type { NodeConstants } from '../types'

/** All format operations */
export enum FormatOperation {
  // General
  COMBINE = 'combine',

  // Text case
  UPPERCASE = 'uppercase',
  LOWERCASE = 'lowercase',
  TITLE_CASE = 'title_case',
  SENTENCE_CASE = 'sentence_case',
  CAMEL_CASE = 'camel_case',
  SNAKE_CASE = 'snake_case',
  KEBAB_CASE = 'kebab_case',

  // Trim & Pad
  TRIM = 'trim',
  PAD_START = 'pad_start',
  PAD_END = 'pad_end',

  // Truncate & Wrap
  TRUNCATE = 'truncate',
  WRAP = 'wrap',

  // Find & Replace
  REPLACE = 'replace',
  REPLACE_REGEX = 'replace_regex',
  REMOVE = 'remove',

  // Number formatting
  CURRENCY = 'currency',
  PERCENTAGE = 'percentage',
  FIXED_DECIMALS = 'fixed_decimals',
  ORDINAL = 'ordinal',
  COMPACT = 'compact',

  // Encode / Decode
  URL_ENCODE = 'url_encode',
  URL_DECODE = 'url_decode',
  HTML_ENCODE = 'html_encode',
  HTML_DECODE = 'html_decode',
  BASE64_ENCODE = 'base64_encode',
  BASE64_DECODE = 'base64_decode',
  SLUG = 'slug',

  // Extract / Parse
  SUBSTRING = 'substring',
  FIRST_N = 'first_n',
  LAST_N = 'last_n',
  REGEX_MATCH = 'regex_match',
  SPLIT = 'split',
  STRIP_HTML = 'strip_html',
}

/** Operation categories for grouped dropdown */
export enum FormatCategory {
  GENERAL = 'general',
  TEXT_CASE = 'text_case',
  TRIM_PAD = 'trim_pad',
  TRUNCATE_WRAP = 'truncate_wrap',
  FIND_REPLACE = 'find_replace',
  NUMBER = 'number',
  ENCODE_DECODE = 'encode_decode',
  EXTRACT = 'extract',
}

// --- Config interfaces per operation group ---

export interface TrimConfig {
  trimAll?: boolean
}

export interface PadConfig {
  length?: number | string
  isLengthConstant?: boolean
  character?: string
}

export interface TruncateConfig {
  maxLength?: number | string
  isMaxLengthConstant?: boolean
  suffix?: string
}

export interface WrapConfig {
  prefix?: string
  suffix?: string
}

export interface ReplaceConfig {
  find?: string
  replaceWith?: string
  replaceAll?: boolean
}

export interface ReplaceRegexConfig {
  pattern?: string
  replaceWith?: string
  flags?: string
}

export interface RemoveConfig {
  find?: string
}

export interface CurrencyConfig {
  locale?: string
  currencyCode?: string
}

export interface PercentageConfig {
  decimals?: number | string
  isDecimalsConstant?: boolean
}

export interface FixedDecimalsConfig {
  decimals?: number | string
  isDecimalsConstant?: boolean
}

export interface CompactConfig {
  locale?: string
}

export interface SlugConfig {
  separator?: string
}

export interface SubstringConfig {
  start?: number | string
  isStartConstant?: boolean
  end?: number | string
  isEndConstant?: boolean
}

export interface FirstLastNConfig {
  count?: number | string
  isCountConstant?: boolean
}

export interface RegexMatchConfig {
  pattern?: string
  group?: number
}

export interface SplitConfig {
  delimiter?: string
}

export interface StripHtmlConfig {
  keepLineBreaks?: boolean
}

// --- Operation metadata for UI display ---

export interface FormatOperationMetadata {
  label: string
  description: string
  category: FormatCategory
}

export const OPERATION_METADATA: Record<FormatOperation, FormatOperationMetadata> = {
  // General
  [FormatOperation.COMBINE]: {
    label: 'Combine',
    description: 'Combine text and variables together',
    category: FormatCategory.GENERAL,
  },
  // Text Case
  [FormatOperation.UPPERCASE]: {
    label: 'Uppercase',
    description: 'Convert to UPPERCASE',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.LOWERCASE]: {
    label: 'Lowercase',
    description: 'Convert to lowercase',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.TITLE_CASE]: {
    label: 'Title Case',
    description: 'Capitalize Each Word',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.SENTENCE_CASE]: {
    label: 'Sentence Case',
    description: 'Capitalize first word of each sentence',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.CAMEL_CASE]: {
    label: 'camelCase',
    description: 'Convert to camelCase',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.SNAKE_CASE]: {
    label: 'snake_case',
    description: 'Convert to snake_case',
    category: FormatCategory.TEXT_CASE,
  },
  [FormatOperation.KEBAB_CASE]: {
    label: 'kebab-case',
    description: 'Convert to kebab-case',
    category: FormatCategory.TEXT_CASE,
  },
  // Trim & Pad
  [FormatOperation.TRIM]: {
    label: 'Trim',
    description: 'Remove leading/trailing whitespace',
    category: FormatCategory.TRIM_PAD,
  },
  [FormatOperation.PAD_START]: {
    label: 'Pad Start',
    description: 'Pad beginning to target length',
    category: FormatCategory.TRIM_PAD,
  },
  [FormatOperation.PAD_END]: {
    label: 'Pad End',
    description: 'Pad end to target length',
    category: FormatCategory.TRIM_PAD,
  },
  // Truncate & Wrap
  [FormatOperation.TRUNCATE]: {
    label: 'Truncate',
    description: 'Cut to max length with suffix',
    category: FormatCategory.TRUNCATE_WRAP,
  },
  [FormatOperation.WRAP]: {
    label: 'Wrap',
    description: 'Add prefix and/or suffix',
    category: FormatCategory.TRUNCATE_WRAP,
  },
  // Find & Replace
  [FormatOperation.REPLACE]: {
    label: 'Replace',
    description: 'Find and replace text',
    category: FormatCategory.FIND_REPLACE,
  },
  [FormatOperation.REPLACE_REGEX]: {
    label: 'Replace (Regex)',
    description: 'Regex find and replace',
    category: FormatCategory.FIND_REPLACE,
  },
  [FormatOperation.REMOVE]: {
    label: 'Remove',
    description: 'Remove all occurrences of text',
    category: FormatCategory.FIND_REPLACE,
  },
  // Number Formatting
  [FormatOperation.CURRENCY]: {
    label: 'Currency',
    description: 'Format number as currency',
    category: FormatCategory.NUMBER,
  },
  [FormatOperation.PERCENTAGE]: {
    label: 'Percentage',
    description: 'Format number as percentage',
    category: FormatCategory.NUMBER,
  },
  [FormatOperation.FIXED_DECIMALS]: {
    label: 'Fixed Decimals',
    description: 'Round to fixed decimal places',
    category: FormatCategory.NUMBER,
  },
  [FormatOperation.ORDINAL]: {
    label: 'Ordinal',
    description: 'Convert number to ordinal (1st, 2nd)',
    category: FormatCategory.NUMBER,
  },
  [FormatOperation.COMPACT]: {
    label: 'Compact',
    description: 'Compact number notation (1.2M)',
    category: FormatCategory.NUMBER,
  },
  // Encode / Decode
  [FormatOperation.URL_ENCODE]: {
    label: 'URL Encode',
    description: 'Encode text for URLs',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.URL_DECODE]: {
    label: 'URL Decode',
    description: 'Decode URL-encoded text',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.HTML_ENCODE]: {
    label: 'HTML Encode',
    description: 'Escape HTML entities',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.HTML_DECODE]: {
    label: 'HTML Decode',
    description: 'Unescape HTML entities',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.BASE64_ENCODE]: {
    label: 'Base64 Encode',
    description: 'Encode text to Base64',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.BASE64_DECODE]: {
    label: 'Base64 Decode',
    description: 'Decode Base64 to text',
    category: FormatCategory.ENCODE_DECODE,
  },
  [FormatOperation.SLUG]: {
    label: 'Slug',
    description: 'Convert to URL-safe slug',
    category: FormatCategory.ENCODE_DECODE,
  },
  // Extract / Parse
  [FormatOperation.SUBSTRING]: {
    label: 'Substring',
    description: 'Extract character range',
    category: FormatCategory.EXTRACT,
  },
  [FormatOperation.FIRST_N]: {
    label: 'First N',
    description: 'First N characters',
    category: FormatCategory.EXTRACT,
  },
  [FormatOperation.LAST_N]: {
    label: 'Last N',
    description: 'Last N characters',
    category: FormatCategory.EXTRACT,
  },
  [FormatOperation.REGEX_MATCH]: {
    label: 'Regex Match',
    description: 'Extract first regex match',
    category: FormatCategory.EXTRACT,
  },
  [FormatOperation.SPLIT]: {
    label: 'Split',
    description: 'Split string into array',
    category: FormatCategory.EXTRACT,
  },
  [FormatOperation.STRIP_HTML]: {
    label: 'Strip HTML',
    description: 'Remove HTML tags',
    category: FormatCategory.EXTRACT,
  },
}

/** Short input → output example for each operation */
export const OPERATION_EXAMPLES: Record<FormatOperation, string> = {
  [FormatOperation.COMBINE]: '"Hello " + {{name}} → "Hello John"',
  [FormatOperation.UPPERCASE]: 'hello → HELLO',
  [FormatOperation.LOWERCASE]: 'Hello → hello',
  [FormatOperation.TITLE_CASE]: 'hello world → Hello World',
  [FormatOperation.SENTENCE_CASE]: 'hello. bye → Hello. Bye',
  [FormatOperation.CAMEL_CASE]: 'hello world → helloWorld',
  [FormatOperation.SNAKE_CASE]: 'Hello World → hello_world',
  [FormatOperation.KEBAB_CASE]: 'Hello World → hello-world',
  [FormatOperation.TRIM]: '" hello " → "hello"',
  [FormatOperation.PAD_START]: '"42" → "0042" (length: 4, char: "0")',
  [FormatOperation.PAD_END]: '"hi" → "hi.." (length: 4, char: ".")',
  [FormatOperation.TRUNCATE]: '"Hello World" → "Hello..." (max: 5)',
  [FormatOperation.WRAP]: '"world" → "[Hello ]world[!]" (prefix + input + suffix)',
  [FormatOperation.REPLACE]: '"hello world" → "hello earth"',
  [FormatOperation.REPLACE_REGEX]: '"abc 123" → "abc ***" (\\d+)',
  [FormatOperation.REMOVE]: '"hello world" → "hello "',
  [FormatOperation.CURRENCY]: '1234.5 → $1,234.50',
  [FormatOperation.PERCENTAGE]: '0.156 → 16%',
  [FormatOperation.FIXED_DECIMALS]: '3.14159 → 3.14',
  [FormatOperation.ORDINAL]: '3 → 3rd',
  [FormatOperation.COMPACT]: '1200000 → 1.2M',
  [FormatOperation.URL_ENCODE]: 'hello world → hello%20world',
  [FormatOperation.URL_DECODE]: 'hello%20world → hello world',
  [FormatOperation.HTML_ENCODE]: '<b>hi</b> → &lt;b&gt;hi&lt;/b&gt;',
  [FormatOperation.HTML_DECODE]: '&lt;b&gt; → <b>',
  [FormatOperation.BASE64_ENCODE]: 'hello → aGVsbG8=',
  [FormatOperation.BASE64_DECODE]: 'aGVsbG8= → hello',
  [FormatOperation.SLUG]: 'Hello World! → hello-world',
  [FormatOperation.SUBSTRING]: '"hello" → "ell" (start: 1, end: 4)',
  [FormatOperation.FIRST_N]: '"hello" → "hel" (count: 3)',
  [FormatOperation.LAST_N]: '"hello" → "llo" (count: 3)',
  [FormatOperation.REGEX_MATCH]: '"age: 25" → "25" (\\d+)',
  [FormatOperation.SPLIT]: '"a,b,c" → ["a", "b", "c"]',
  [FormatOperation.STRIP_HTML]: '"<b>hello</b>" → "hello"',
}

/** Operation group definitions for ComboPicker */
export interface FormatOperationGroup {
  label: string
  category: FormatCategory
  iconId: string
  color: string
  operations: FormatOperation[]
}

export const OPERATION_GROUPS: FormatOperationGroup[] = [
  {
    label: 'General',
    category: FormatCategory.GENERAL,
    iconId: 'text-cursor-input',
    color: 'blue',
    operations: [FormatOperation.COMBINE],
  },
  {
    label: 'Text Case',
    category: FormatCategory.TEXT_CASE,
    iconId: 'case-sensitive',
    color: 'blue',
    operations: [
      FormatOperation.UPPERCASE,
      FormatOperation.LOWERCASE,
      FormatOperation.TITLE_CASE,
      FormatOperation.SENTENCE_CASE,
      FormatOperation.CAMEL_CASE,
      FormatOperation.SNAKE_CASE,
      FormatOperation.KEBAB_CASE,
    ],
  },
  {
    label: 'Trim & Pad',
    category: FormatCategory.TRIM_PAD,
    iconId: 'align-center',
    color: 'teal',
    operations: [FormatOperation.TRIM, FormatOperation.PAD_START, FormatOperation.PAD_END],
  },
  {
    label: 'Truncate & Wrap',
    category: FormatCategory.TRUNCATE_WRAP,
    iconId: 'scissors',
    color: 'green',
    operations: [FormatOperation.TRUNCATE, FormatOperation.WRAP],
  },
  {
    label: 'Find & Replace',
    category: FormatCategory.FIND_REPLACE,
    iconId: 'replace',
    color: 'orange',
    operations: [FormatOperation.REPLACE, FormatOperation.REPLACE_REGEX, FormatOperation.REMOVE],
  },
  {
    label: 'Number',
    category: FormatCategory.NUMBER,
    iconId: 'hash',
    color: 'purple',
    operations: [
      FormatOperation.CURRENCY,
      FormatOperation.PERCENTAGE,
      FormatOperation.FIXED_DECIMALS,
      FormatOperation.ORDINAL,
      FormatOperation.COMPACT,
    ],
  },
  {
    label: 'Encode / Decode',
    category: FormatCategory.ENCODE_DECODE,
    iconId: 'lock',
    color: 'indigo',
    operations: [
      FormatOperation.URL_ENCODE,
      FormatOperation.URL_DECODE,
      FormatOperation.HTML_ENCODE,
      FormatOperation.HTML_DECODE,
      FormatOperation.BASE64_ENCODE,
      FormatOperation.BASE64_DECODE,
      FormatOperation.SLUG,
    ],
  },
  {
    label: 'Extract',
    category: FormatCategory.EXTRACT,
    iconId: 'regex',
    color: 'pink',
    operations: [
      FormatOperation.SUBSTRING,
      FormatOperation.FIRST_N,
      FormatOperation.LAST_N,
      FormatOperation.REGEX_MATCH,
      FormatOperation.SPLIT,
      FormatOperation.STRIP_HTML,
    ],
  },
]

/** Default operation */
export const DEFAULT_OPERATION = FormatOperation.COMBINE

/** Find the group for an operation */
export function getOperationGroup(operation: FormatOperation) {
  return OPERATION_GROUPS.find((g) => g.operations.includes(operation))
}

/** Bundled export for consistency with other node constants */
export const FORMAT_NODE_CONSTANTS = {
  OPERATION_METADATA,
  OPERATION_GROUPS,
  DEFAULT_OPERATION,
} as const satisfies NodeConstants
