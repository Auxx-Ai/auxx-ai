// packages/lib/src/workflow-engine/nodes/transform-nodes/format-processor.ts

import type { ExecutionContextManager } from '../../core/execution-context'
import type { NodeExecutionResult, ValidationResult, WorkflowNode } from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

// --- Helper functions ---

function toTitleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}

function toSentenceCase(s: string): string {
  return s.replace(/(^\s*|[.!?]\s+)(\w)/g, (_match, sep, char) => sep + char.toUpperCase())
}

function splitWords(s: string): string[] {
  // Split on camelCase boundaries, non-alphanumeric chars, and existing separators
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s_\-./\\]+|(?=[A-Z][a-z])/)
    .filter(Boolean)
}

function toCamelCase(s: string): string {
  const words = splitWords(s)
  if (words.length === 0) return ''
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('')
  )
}

function toSnakeCase(s: string): string {
  return splitWords(s)
    .map((w) => w.toLowerCase())
    .join('_')
}

function toKebabCase(s: string): string {
  return splitWords(s)
    .map((w) => w.toLowerCase())
    .join('-')
}

function toSlug(s: string, separator = '-'): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, separator)
    .replace(new RegExp(`${escapeRegex(separator)}+`, 'g'), separator)
    .replace(new RegExp(`^${escapeRegex(separator)}|${escapeRegex(separator)}$`, 'g'), '')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function toOrdinal(n: number): string {
  if (Number.isNaN(n)) return String(n)
  const abs = Math.abs(n)
  const mod100 = abs % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  switch (abs % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

const HTML_ENTITY_REVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(HTML_ENTITIES).map(([k, v]) => [v, k])
)

function htmlEncode(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ENTITIES[c] ?? c)
}

function htmlDecode(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITY_REVERSE[entity] ?? entity)
}

function stripHtml(s: string, keepLineBreaks: boolean): string {
  let result = s
  if (keepLineBreaks) {
    // Replace <br>, <br/>, <br />, </p>, </div> with newlines before stripping
    result = result.replace(/<br\s*\/?>/gi, '\n')
    result = result.replace(/<\/(?:p|div)>/gi, '\n')
  }
  // Remove all HTML tags
  result = result.replace(/<[^>]*>/g, '')
  // Collapse multiple newlines if keeping line breaks
  if (keepLineBreaks) {
    result = result.replace(/\n{3,}/g, '\n\n')
  }
  return result.trim()
}

/**
 * Format processor — handles all text/number/encode formatting operations
 */
export class FormatProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.FORMAT

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    try {
      const data = node.data as Record<string, any>
      const operation = data.operation as string
      const ctx = contextManager

      // Interpolate main input — resolves {{variable}} references
      const input = await this.interpolateField(data.input, ctx)

      contextManager.log('INFO', node.name, `Executing format operation: ${operation}`)

      let result: string | string[]

      switch (operation) {
        // --- General ---
        case 'combine':
          result = input
          break

        // --- Text Case ---
        case 'uppercase':
          result = input.toUpperCase()
          break
        case 'lowercase':
          result = input.toLowerCase()
          break
        case 'title_case':
          result = toTitleCase(input)
          break
        case 'sentence_case':
          result = toSentenceCase(input)
          break
        case 'camel_case':
          result = toCamelCase(input)
          break
        case 'snake_case':
          result = toSnakeCase(input)
          break
        case 'kebab_case':
          result = toKebabCase(input)
          break

        // --- Trim & Pad ---
        case 'trim':
          result = data.trimConfig?.trimAll ? input.replace(/\s+/g, ' ').trim() : input.trim()
          break
        case 'pad_start': {
          const len = await this.resolveNumberField(
            data.padConfig?.length,
            data.padConfig?.isLengthConstant,
            0,
            ctx
          )
          const char = String(data.padConfig?.character ?? ' ')
          result = input.padStart(len, char)
          break
        }
        case 'pad_end': {
          const len = await this.resolveNumberField(
            data.padConfig?.length,
            data.padConfig?.isLengthConstant,
            0,
            ctx
          )
          const char = String(data.padConfig?.character ?? ' ')
          result = input.padEnd(len, char)
          break
        }

        // --- Truncate & Wrap ---
        case 'truncate': {
          const max = await this.resolveNumberField(
            data.truncateConfig?.maxLength,
            data.truncateConfig?.isMaxLengthConstant,
            100,
            ctx
          )
          const suffix = String(data.truncateConfig?.suffix ?? '...')
          result = input.length > max ? input.slice(0, max) + suffix : input
          break
        }
        case 'wrap': {
          const prefix = await this.interpolateField(data.wrapConfig?.prefix, ctx)
          const suffix = await this.interpolateField(data.wrapConfig?.suffix, ctx)
          result = `${prefix}${input}${suffix}`
          break
        }

        // --- Find & Replace ---
        case 'replace': {
          const find = await this.interpolateField(data.replaceConfig?.find, ctx)
          const replaceWith = await this.interpolateField(data.replaceConfig?.replaceWith, ctx)
          if (!find) {
            result = input
          } else if (data.replaceConfig?.replaceAll) {
            result = input.replaceAll(find, replaceWith)
          } else {
            result = input.replace(find, replaceWith)
          }
          break
        }
        case 'replace_regex': {
          const pattern = String(data.replaceRegexConfig?.pattern ?? '')
          const replaceWith = await this.interpolateField(data.replaceRegexConfig?.replaceWith, ctx)
          const flags = String(data.replaceRegexConfig?.flags ?? 'g')
          if (!pattern) {
            result = input
          } else {
            const regex = new RegExp(pattern, flags)
            result = input.replace(regex, replaceWith)
          }
          break
        }
        case 'remove': {
          const find = await this.interpolateField(data.removeConfig?.find, ctx)
          result = find ? input.replaceAll(find, '') : input
          break
        }

        // --- Number Formatting ---
        case 'currency': {
          const num = Number.parseFloat(input)
          if (Number.isNaN(num)) {
            result = input
          } else {
            const locale = String(data.currencyConfig?.locale ?? 'en-US')
            const currency = String(data.currencyConfig?.currencyCode ?? 'USD')
            result = new Intl.NumberFormat(locale, { style: 'currency', currency }).format(num)
          }
          break
        }
        case 'percentage': {
          const num = Number.parseFloat(input)
          if (Number.isNaN(num)) {
            result = input
          } else {
            const decimals = await this.resolveNumberField(
              data.percentageConfig?.decimals,
              data.percentageConfig?.isDecimalsConstant,
              0,
              ctx
            )
            result = new Intl.NumberFormat('en-US', {
              style: 'percent',
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            }).format(num)
          }
          break
        }
        case 'fixed_decimals': {
          const num = Number.parseFloat(input)
          const decimals = await this.resolveNumberField(
            data.fixedDecimalsConfig?.decimals,
            data.fixedDecimalsConfig?.isDecimalsConstant,
            2,
            ctx
          )
          result = Number.isNaN(num) ? input : num.toFixed(decimals)
          break
        }
        case 'ordinal': {
          const num = Number.parseInt(input, 10)
          result = Number.isNaN(num) ? input : toOrdinal(num)
          break
        }
        case 'compact': {
          const num = Number.parseFloat(input)
          if (Number.isNaN(num)) {
            result = input
          } else {
            const locale = String(data.compactConfig?.locale ?? 'en-US')
            result = new Intl.NumberFormat(locale, { notation: 'compact' }).format(num)
          }
          break
        }

        // --- Encode / Decode ---
        case 'url_encode':
          result = encodeURIComponent(input)
          break
        case 'url_decode':
          result = decodeURIComponent(input)
          break
        case 'html_encode':
          result = htmlEncode(input)
          break
        case 'html_decode':
          result = htmlDecode(input)
          break
        case 'base64_encode':
          result = Buffer.from(input).toString('base64')
          break
        case 'base64_decode':
          result = Buffer.from(input, 'base64').toString('utf-8')
          break
        case 'slug': {
          const separator = String(data.slugConfig?.separator ?? '-')
          result = toSlug(input, separator)
          break
        }

        // --- Extract / Parse ---
        case 'substring': {
          const start = await this.resolveNumberField(
            data.substringConfig?.start,
            data.substringConfig?.isStartConstant,
            0,
            ctx
          )
          const end =
            data.substringConfig?.end != null
              ? await this.resolveNumberField(
                  data.substringConfig.end,
                  data.substringConfig?.isEndConstant,
                  input.length,
                  ctx
                )
              : input.length
          result = input.substring(start, end)
          break
        }
        case 'first_n': {
          const count = await this.resolveNumberField(
            data.firstLastNConfig?.count,
            data.firstLastNConfig?.isCountConstant,
            1,
            ctx
          )
          result = input.slice(0, count)
          break
        }
        case 'last_n': {
          const count = await this.resolveNumberField(
            data.firstLastNConfig?.count,
            data.firstLastNConfig?.isCountConstant,
            1,
            ctx
          )
          result = input.slice(-count)
          break
        }
        case 'regex_match': {
          const pattern = String(data.regexMatchConfig?.pattern ?? '')
          const group = Number(data.regexMatchConfig?.group ?? 0)
          if (!pattern) {
            result = ''
          } else {
            const regex = new RegExp(pattern)
            const match = regex.exec(input)
            result = match?.[group] ?? ''
          }
          break
        }
        case 'split': {
          const delimiter = await this.interpolateField(data.splitConfig?.delimiter, ctx)
          result = input.split(delimiter || ',')
          break
        }
        case 'strip_html': {
          const keepBreaks = data.stripHtmlConfig?.keepLineBreaks ?? true
          result = stripHtml(input, keepBreaks)
          break
        }

        default:
          result = input
      }

      contextManager.setNodeVariable(node.nodeId, 'result', result)

      return {
        status: NodeRunningStatus.Succeeded,
        output: { result },
        outputHandle: 'source',
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      contextManager.log('ERROR', node.name, `Format operation failed: ${errorMessage}`)
      return {
        status: NodeRunningStatus.Failed,
        error: errorMessage,
        outputHandle: 'error',
      }
    }
  }

  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const variables = new Set<string>()
    const data = node.data as Record<string, any>

    // Extract from main input
    if (data.input && typeof data.input === 'string') {
      this.extractVariableIds(data.input).forEach((v) => variables.add(v))
    }

    // Extract from rich-text config fields
    const richFields = [
      data.replaceConfig?.find,
      data.replaceConfig?.replaceWith,
      data.replaceRegexConfig?.replaceWith,
      data.removeConfig?.find,
      data.wrapConfig?.prefix,
      data.wrapConfig?.suffix,
      data.splitConfig?.delimiter,
    ]
    for (const field of richFields) {
      if (field && typeof field === 'string') {
        this.extractVariableIds(field).forEach((v) => variables.add(v))
      }
    }

    // Extract from variable-mode numeric fields
    const varFields = [
      { value: data.padConfig?.length, isConstant: data.padConfig?.isLengthConstant },
      {
        value: data.truncateConfig?.maxLength,
        isConstant: data.truncateConfig?.isMaxLengthConstant,
      },
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
        this.extractVariableIds(value).forEach((v) => variables.add(v))
      }
    }

    return Array.from(variables)
  }

  protected async validateNodeConfig(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const data = node.data as Record<string, any>

    if (!data.operation) errors.push('Operation is required')
    if (!data.input && data.input !== '') errors.push('Input is required')

    return { valid: errors.length === 0, errors, warnings: [] }
  }
}
