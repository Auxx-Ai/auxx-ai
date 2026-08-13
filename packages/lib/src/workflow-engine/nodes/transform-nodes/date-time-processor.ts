// packages/lib/src/workflow-engine/nodes/transform-nodes/date-time-processor.ts
//
// ── THE TIMEZONE CONTRACT ───────────────────────────────────────────────────
// Every operation on this node is evaluated in ONE timezone: `config.timezone`,
// defaulting to **UTC**. Not the server's timezone — a workflow runs in a
// background job with no user attached, and a deployment detail must never
// decide what "start of day" means. UTC is the only deterministic answer, and
// it is what every date already flowing through the engine (DB timestamps, ISO
// strings) is expressed in.
//
// What the zone actually governs:
//   - parsing   a bare wall-clock input (`2024-01-15 09:00`) is read IN the zone
//   - formatting rendering goes through `formatInTimeZone`, so the offset is the
//               zone's, not the server's
//   - rounding  `start/endOf<unit>` are computed on the zone's wall clock
//   - add/sub   CALENDAR units (years…days) shift the zone's wall clock, so a
//               day across a DST boundary is 23 or 25 real hours; EXACT units
//               (hours…milliseconds) are absolute and zone-independent
//
// `result` is an ISO 8601 string with the zone's offset for every date-producing
// operation (add/subtract, round, parse), or epoch milliseconds when
// `outputAsTimestamp` is set. There is exactly one execution path — see
// `executeNode`.

import type { Duration, Locale } from 'date-fns'
import {
  add,
  differenceInMilliseconds,
  endOfDay,
  endOfHour,
  endOfMinute,
  endOfMonth,
  endOfSecond,
  endOfWeek,
  endOfYear,
  format,
  formatRelative,
  isValid,
  parse,
  startOfDay,
  startOfHour,
  startOfMinute,
  startOfMonth,
  startOfSecond,
  startOfWeek,
  startOfYear,
  sub,
} from 'date-fns'
import * as dateFnsLocales from 'date-fns/locale'
import { formatInTimeZone, fromZonedTime, toZonedTime } from 'date-fns-tz'
// Operation/unit/format vocabularies single-sourced from the node catalog
// (node-catalog Phase 1) — this file previously re-declared all four enums
// verbatim.
import {
  DateFormatType,
  DateTimeOperation,
  ParseDateFormatType,
  TimeUnit,
} from '../../catalog/nodes/date-time'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'
import { resolveModedValue } from '../utils/moded-field'
import { resolveTargetTime } from '../wait/target-time'

/**
 * The timezone every operation is evaluated in when the node does not name one.
 * See the file header for why this is UTC and not the server's zone.
 */
const DEFAULT_TIMEZONE = 'UTC'

/** Fallback locale for month/day names when the node does not name one. */
const DEFAULT_LOCALE = 'en-US'

/**
 * ISO 8601 with the offset of the *configured* zone. `XXX` renders a zero offset
 * as `Z`, so under the default UTC this is byte-identical to `Date#toISOString`.
 */
const ISO_FORMAT = "yyyy-MM-dd'T'HH:mm:ss.SSSXXX"

/**
 * Units whose arithmetic follows the calendar rather than an exact elapsed
 * duration. "Tomorrow at 09:00" stays 09:00 across a DST boundary (23 or 25 real
 * hours); "in 24 hours" does not. Anything not listed here is exact, and exact
 * arithmetic is the same in every zone.
 */
const CALENDAR_UNITS = new Set<string>([
  TimeUnit.YEARS,
  TimeUnit.QUARTERS,
  TimeUnit.MONTHS,
  TimeUnit.WEEKS,
  TimeUnit.DAYS,
])

/** Boundary functions for the ROUND operation, by unit. */
const ROUND_FUNCTIONS: Partial<
  Record<TimeUnit, { start: (date: Date) => Date; end: (date: Date) => Date }>
> = {
  [TimeUnit.YEARS]: { start: startOfYear, end: endOfYear },
  [TimeUnit.MONTHS]: { start: startOfMonth, end: endOfMonth },
  [TimeUnit.WEEKS]: { start: startOfWeek, end: endOfWeek },
  [TimeUnit.DAYS]: { start: startOfDay, end: endOfDay },
  [TimeUnit.HOURS]: { start: startOfHour, end: endOfHour },
  [TimeUnit.MINUTES]: { start: startOfMinute, end: endOfMinute },
  [TimeUnit.SECONDS]: { start: startOfSecond, end: endOfSecond },
}

/** Fallback patterns tried when a date string is not ISO-parseable. */
const FALLBACK_PARSE_FORMATS = [
  'yyyy-MM-dd',
  'MM/dd/yyyy',
  'dd/MM/yyyy',
  'MM-dd-yyyy',
  'dd-MM-yyyy',
]

/**
 * Resolved timezone/locale/output settings — computed once in `preprocessNode`
 * and threaded through every operation.
 */
interface LocalizationConfig {
  timezone: string
  locale: string
  outputAsTimestamp: boolean
}

const LOCALE_REGISTRY = dateFnsLocales as unknown as Record<string, Locale | undefined>

/**
 * Map a BCP-47 locale tag (`de-DE`, `pt-BR`, `en-US`) onto a date-fns locale.
 *
 * date-fns names its exports `enUS`, `ptBR`, `de` — so try the camel-cased tag first
 * (`pt-BR` → `ptBR`), then the bare language (`de-DE` → `de`), then fall back to en-US.
 */
function resolveDateFnsLocale(tag: string | undefined): Locale {
  const fallback = dateFnsLocales.enUS
  if (!tag) return fallback

  const parts = tag.trim().replace(/_/g, '-').split('-').filter(Boolean)
  const language = parts[0]?.toLowerCase()
  if (!language) return fallback

  if (parts.length > 1) {
    const camelCased = language + parts.slice(1).join('').toUpperCase()
    const regional = LOCALE_REGISTRY[camelCased]
    if (regional) return regional
  }

  return LOCALE_REGISTRY[language] ?? fallback
}

/**
 * Date time node configuration interface
 */
interface DateTimeNodeConfig {
  operation: DateTimeOperation
  inputDate?: string
  isInputDateConstant?: boolean
  addSubtract?: {
    action: 'add' | 'subtract'
    duration: number | string | undefined
    unit: TimeUnit | string
  }
  fieldModes?: Record<string, boolean>
  format?: { type: DateFormatType; customFormat?: string }
  timeBetween?: { endDate?: string; isEndDateConstant?: boolean; unit: TimeUnit }
  round?: { direction: 'up' | 'down' | 'nearest'; unit: TimeUnit }
  parseDate?: {
    formatType: ParseDateFormatType
    customFormat?: string
  }
  /** IANA zone every operation is evaluated in. Defaults to UTC. */
  timezone?: string
  /** BCP-47 tag for month/day names. Defaults to `en-US`. */
  locale?: string
  /**
   * Emit epoch milliseconds instead of an ISO string. Only meaningful for the
   * date-producing operations (add/subtract, round, parse) — `format` already
   * has `unix`/`unix_ms` format types and `time_between` returns a number.
   */
  outputAsTimestamp?: boolean
}

export class DateTimeProcessor extends BaseNodeProcessor {
  readonly type = WorkflowNodeType.DATE_TIME

  /**
   * Preprocess date-time node to extract and validate configuration
   */
  async preprocessNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<PreprocessedNodeData> {
    const config = node.data as unknown as DateTimeNodeConfig

    // Validate operation type
    if (!config.operation) {
      throw new Error('Date time operation is required')
    }

    if (!Object.values(DateTimeOperation).includes(config.operation)) {
      throw new Error(`Invalid operation: ${config.operation}`)
    }

    // 1. Resolve timezone/locale FIRST — every parse below is evaluated in that zone
    const localizationConfig: LocalizationConfig = {
      timezone: config.timezone || DEFAULT_TIMEZONE,
      locale: config.locale || DEFAULT_LOCALE,
      outputAsTimestamp: config.outputAsTimestamp ?? false,
    }

    // 2. Validate the timezone. `Intl` is checked with no locale on purpose: an
    // unknown locale tag must fall back silently, not masquerade as a bad zone.
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: localizationConfig.timezone })
    } catch {
      throw new Error(`Invalid timezone: ${localizationConfig.timezone}`)
    }

    // 3. Process and validate input date
    // For PARSE_DATE, don't parse the input - keep it as a string
    const inputDateInfo = await this.processInputDate(
      config,
      contextManager,
      localizationConfig.timezone,
      config.operation === DateTimeOperation.PARSE_DATE
    )

    // 4. Process operation-specific configuration
    let operationConfig: any = null

    switch (config.operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        operationConfig = await this.processAddSubtractOperation(config, contextManager)
        break

      case DateTimeOperation.FORMAT:
        operationConfig = this.processFormatOperation(config)
        break

      case DateTimeOperation.TIME_BETWEEN:
        operationConfig = await this.processTimeBetweenOperation(
          config,
          contextManager,
          localizationConfig.timezone
        )
        break

      case DateTimeOperation.ROUND:
        operationConfig = this.processRoundOperation(config)
        break

      case DateTimeOperation.PARSE_DATE:
        operationConfig = this.processParseDateOperation(config, contextManager)
        break

      default:
        throw new Error(`Unsupported operation: ${config.operation}`)
    }

    // 5. Pre-calculate result if possible (for constant inputs)
    let preCalculatedResult: any = null
    let canPreCalculate = inputDateInfo.isConstant && this.isOperationConstant(config)

    if (canPreCalculate) {
      try {
        // For PARSE_DATE, use the resolved string value instead of parsed date
        const inputValue =
          config.operation === DateTimeOperation.PARSE_DATE
            ? inputDateInfo.resolvedValue
            : inputDateInfo.parsedDate

        preCalculatedResult = this.performDateOperation(
          inputValue,
          config.operation,
          operationConfig,
          localizationConfig
        )
      } catch {
        // If pre-calculation fails, we'll calculate during execution
        canPreCalculate = false
      }
    }

    // 6. Extract variable references
    const usedVariables = new Set<string>()
    if (config.inputDate && !config.isInputDateConstant) {
      this.extractVariableIds(config.inputDate).forEach((v) => usedVariables.add(v))
    }

    // Add variables from operation-specific configuration
    this.extractOperationVariables(config, operationConfig).forEach((v) => usedVariables.add(v))

    return {
      inputs: {
        // Input date configuration
        inputDateInfo,

        // Operation configuration
        operation: config.operation,
        operationConfig,

        // Localization settings
        localizationConfig,

        // Pre-calculated result (if possible)
        preCalculatedResult,
        canPreCalculate,

        // Output configuration
        outputVariable: `${node.nodeId}_result`,
        outputFormat: this.determineOutputFormat(config),

        // Original configuration for reference
        originalConfig: config,

        // Processing metadata
        variablesUsed: Array.from(usedVariables),
        isReadyForExecution: true,
        preprocessedAt: new Date().toISOString(),
      },
      metadata: {
        nodeType: 'date-time',
        operation: config.operation,
        hasInputDate: !!inputDateInfo.originalValue,
        inputDateIsConstant: inputDateInfo.isConstant,
        timezone: localizationConfig.timezone,
        locale: localizationConfig.locale,
        canPreCalculate,
        hasPreCalculatedResult: !!preCalculatedResult,
        variableCount: usedVariables.size,
        estimatedExecutionTime: this.estimateExecutionTime(config.operation),
        preprocessingComplete: true,
      },
    }
  }

  /**
   * There is exactly ONE execution path.
   *
   * This node used to carry a second, hand-rolled implementation for the case
   * where the engine handed it no preprocessed data — and the two disagreed:
   * `iso` came back as a local-offset string from one and a UTC `Z` string from
   * the other, and `long` used two different format strings. Same node, same
   * config, different answer depending on how it was invoked. If preprocessing
   * has not happened, we run it here rather than reimplementing it.
   */
  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    const data = preprocessedData?.inputs
      ? preprocessedData
      : await this.preprocessNode(node, contextManager)
    const inputs = data.inputs

    contextManager.log('INFO', node.name, `Executing date-time operation: ${inputs.operation}`, {
      operation: inputs.operation,
      hasPreCalculatedResult: inputs.canPreCalculate,
      timezone: inputs.localizationConfig.timezone,
      locale: inputs.localizationConfig.locale,
    })

    try {
      let result: any

      // Use pre-calculated result if available
      if (inputs.canPreCalculate && inputs.preCalculatedResult !== null) {
        result = inputs.preCalculatedResult

        contextManager.log('DEBUG', node.name, 'Using pre-calculated date result', {
          result,
          operationType: inputs.operation,
          inputWasConstant: inputs.inputDateInfo.isConstant,
        })
      } else {
        result = await this.executeWithPreprocessedData(inputs, contextManager)
      }

      contextManager.setVariable(inputs.outputVariable, result)
      contextManager.setNodeVariable(node.nodeId, 'result', result)

      contextManager.log('INFO', node.name, 'Date-time operation completed', {
        operation: inputs.operation,
        result,
        usedPreCalculatedResult: inputs.canPreCalculate,
        outputVariable: inputs.outputVariable,
      })

      return {
        status: NodeRunningStatus.Succeeded,
        output: {
          result,
          operation: inputs.operation,
          inputDate: inputs.inputDateInfo.resolvedValue,
          outputFormat: inputs.outputFormat,
          executedAt: new Date(),
        },
        metadata: {
          operation: inputs.operation,
          usedPreCalculatedResult: inputs.canPreCalculate,
          timezone: inputs.localizationConfig.timezone,
          locale: inputs.localizationConfig.locale,
          executionTime: data.metadata?.estimatedExecutionTime,
        },
        outputHandle: 'source',
      }
    } catch (error) {
      contextManager.log('ERROR', node.name, 'Date-time operation failed', {
        error: error instanceof Error ? error.message : String(error),
        operation: inputs.operation,
      })
      throw error
    }
  }

  /**
   * Execute date operation with preprocessed data
   */
  private async executeWithPreprocessedData(
    inputs: any,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    const { inputDateInfo, operation, operationConfig, localizationConfig } = inputs

    // For PARSE_DATE, use the string value
    if (operation === DateTimeOperation.PARSE_DATE) {
      let inputValue = inputDateInfo.resolvedValue

      if (!inputDateInfo.isConstant) {
        // Re-resolve the variable value at execution time
        inputValue = await resolveModedValue(
          inputDateInfo.originalValue,
          inputDateInfo.isConstant,
          contextManager
        )
      }

      // Execute parse operation with string value
      return this.performDateOperation(inputValue, operation, operationConfig, localizationConfig)
    }

    // For other operations, use parsed date
    let inputDate = inputDateInfo.parsedDate

    if (!inputDateInfo.isConstant) {
      // Re-resolve the variable value at execution time
      const currentInputValue = await resolveModedValue(
        inputDateInfo.originalValue,
        inputDateInfo.isConstant,
        contextManager
      )

      inputDate = this.parseDate(currentInputValue, localizationConfig.timezone)
      if (!isValid(inputDate)) {
        throw new Error(`Invalid input date: ${currentInputValue}`)
      }
    }

    // Execute operation with preprocessed configuration
    return this.performDateOperation(inputDate, operation, operationConfig, localizationConfig)
  }

  /**
   * Parse a value into an instant, reading bare wall-clock strings IN `timezone`.
   *
   * `new Date('2024-01-15 09:00')` reads the string in the SERVER's zone — the
   * reason the node's timezone control did nothing. `resolveTargetTime` (shared
   * with the wait node) handles the trap that comes with fixing it: a value that
   * already carries `Z` or `±HH:MM` pins an absolute instant and must NOT be
   * re-interpreted, or it shifts twice.
   */
  private parseDate(value: any, timezone: string): Date {
    if (value instanceof Date) return value
    if (typeof value === 'number') return new Date(value)

    if (typeof value === 'string') {
      const zoned = resolveTargetTime(value, timezone)
      if (isValid(zoned)) return zoned

      // Non-ISO shapes `resolveTargetTime` cannot read. `parse` yields a
      // server-local wall clock, so re-anchor it in the configured zone.
      const reference = new Date()
      for (const fmt of FALLBACK_PARSE_FORMATS) {
        const parsed = parse(value.trim(), fmt, reference)
        if (isValid(parsed)) return fromZonedTime(parsed, timezone)
      }
    }

    throw new Error(`Cannot parse date: ${value}`)
  }

  /**
   * Convert duration to date-fns format
   */
  private convertDuration(value: number, unit: TimeUnit): Duration {
    switch (unit) {
      case TimeUnit.YEARS:
        return { years: value }
      case TimeUnit.QUARTERS:
        return { months: value * 3 }
      case TimeUnit.MONTHS:
        return { months: value }
      case TimeUnit.WEEKS:
        return { weeks: value }
      case TimeUnit.DAYS:
        return { days: value }
      case TimeUnit.HOURS:
        return { hours: value }
      case TimeUnit.MINUTES:
        return { minutes: value }
      case TimeUnit.SECONDS:
        return { seconds: value }
      case TimeUnit.MILLISECONDS:
        return { seconds: value / 1000 }
      default:
        throw new Error(`Unknown time unit: ${unit as any}`)
    }
  }

  /**
   * Convert milliseconds to specified unit
   */
  private convertMillisecondsToUnit(ms: number, unit: TimeUnit): number {
    const seconds = ms / 1000
    const minutes = seconds / 60
    const hours = minutes / 60
    const days = hours / 24
    const weeks = days / 7
    const months = days / 30.436875 // Average month length
    const years = days / 365.25

    switch (unit) {
      case TimeUnit.YEARS:
        return years
      case TimeUnit.QUARTERS:
        return months / 3
      case TimeUnit.MONTHS:
        return months
      case TimeUnit.WEEKS:
        return weeks
      case TimeUnit.DAYS:
        return days
      case TimeUnit.HOURS:
        return hours
      case TimeUnit.MINUTES:
        return minutes
      case TimeUnit.SECONDS:
        return seconds
      case TimeUnit.MILLISECONDS:
        return ms
      default:
        throw new Error(`Unknown time unit: ${unit as any}`)
    }
  }

  /**
   * Process and validate input date
   */
  private async processInputDate(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager,
    timezone: string,
    skipParsing = false
  ): Promise<any> {
    if (!config.inputDate) {
      throw new Error('Input date is required')
    }

    const isConstant = config.isInputDateConstant ?? true

    // Constant mode passes the literal through; variable mode resolves either shape.
    const inputDateValue = await resolveModedValue(config.inputDate, isConstant, contextManager)

    // For PARSE_DATE operation, skip parsing and keep as string
    if (skipParsing) {
      return {
        originalValue: config.inputDate,
        resolvedValue: inputDateValue,
        parsedDate: null, // No parsing for PARSE_DATE
        isConstant,
        dateType: 'string',
        isValidDate: false, // Not parsed yet
      }
    }

    // Parse and validate the date
    const parsedDate = this.parseDate(inputDateValue, timezone)

    if (!isValid(parsedDate)) {
      throw new Error(`Invalid input date: ${inputDateValue}`)
    }

    return {
      originalValue: config.inputDate,
      resolvedValue: inputDateValue,
      parsedDate,
      isConstant,
      dateType: this.determineDateType(inputDateValue),
      isValidDate: true,
    }
  }

  /**
   * Process add/subtract operation configuration
   */
  private async processAddSubtractOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    if (!config.addSubtract) {
      throw new Error('Add/subtract configuration is required for ADD_SUBTRACT operation')
    }

    const { action } = config.addSubtract

    if (!action || !['add', 'subtract'].includes(action)) {
      throw new Error('Action must be either "add" or "subtract"')
    }

    // Duration and unit can each be bound to a variable — `fieldModes` records which.
    const duration = await this.resolveAddSubtractDuration(config, contextManager)
    const unit = await this.resolveAddSubtractUnit(config, contextManager)

    if (typeof duration !== 'number' || Number.isNaN(duration) || duration <= 0) {
      throw new Error('Duration must be a positive number')
    }

    const timeUnit = Object.values(TimeUnit).find((u) => u === unit)
    if (!timeUnit) {
      throw new Error(`Invalid time unit: ${unit}`)
    }

    return {
      action,
      duration,
      unit: timeUnit,
      durationObject: this.convertDuration(duration, timeUnit),
    }
  }

  /**
   * Resolve the add/subtract duration, following the panel's `fieldModes.duration` flag.
   * In variable mode the stored value is a variable id (or a `{{…}}` template).
   */
  private async resolveAddSubtractDuration(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<number> {
    const raw = config.addSubtract?.duration
    const isConstant = config.fieldModes?.['duration'] ?? true

    if (isConstant || typeof raw !== 'string') {
      return typeof raw === 'number' ? raw : Number(raw)
    }

    const resolved = await resolveModedValue(raw, isConstant, contextManager)

    if (resolved === undefined || resolved === null || resolved === '') {
      throw new Error(`Duration variable resolved to no value: ${raw}`)
    }

    return typeof resolved === 'number' ? resolved : Number(resolved)
  }

  /**
   * Resolve the add/subtract time unit, following the panel's `fieldModes.unit` flag.
   */
  private async resolveAddSubtractUnit(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<string> {
    const raw = config.addSubtract?.unit
    const isConstant = config.fieldModes?.['unit'] ?? true

    if (isConstant || typeof raw !== 'string' || !raw) return String(raw ?? '')

    const resolved = await resolveModedValue(raw, isConstant, contextManager)

    return resolved === undefined || resolved === null ? '' : String(resolved)
  }

  /**
   * Process format operation configuration
   */
  private processFormatOperation(config: DateTimeNodeConfig): any {
    if (!config.format) {
      throw new Error('Format configuration is required for FORMAT operation')
    }

    const { type, customFormat } = config.format

    if (!Object.values(DateFormatType).includes(type)) {
      throw new Error(`Invalid format type: ${type}`)
    }

    if (type === DateFormatType.CUSTOM && !customFormat) {
      throw new Error('Custom format string is required when format type is "custom"')
    }

    // Validate custom format if provided
    if (type === DateFormatType.CUSTOM && customFormat) {
      try {
        // Test the format with a sample date
        format(new Date(), customFormat)
      } catch {
        throw new Error(`Invalid custom format string: ${customFormat}`)
      }
    }

    return {
      type,
      customFormat,
      formatString: this.getFormatString(type, customFormat),
      outputType: this.getFormatOutputType(type),
    }
  }

  /**
   * Process time between operation configuration
   */
  private async processTimeBetweenOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager,
    timezone: string
  ): Promise<any> {
    if (!config.timeBetween) {
      throw new Error('Time between configuration is required for TIME_BETWEEN operation')
    }

    const { endDate, isEndDateConstant, unit } = config.timeBetween

    if (!endDate) {
      throw new Error('End date is required for time between calculation')
    }

    if (!Object.values(TimeUnit).includes(unit)) {
      throw new Error(`Invalid time unit: ${unit}`)
    }

    // Process end date
    const endDateIsConstant = isEndDateConstant ?? true
    const endDateValue = await resolveModedValue(endDate, endDateIsConstant, contextManager)

    // Parse and validate end date
    const parsedEndDate = this.parseDate(endDateValue, timezone)

    if (!isValid(parsedEndDate)) {
      throw new Error(`Invalid end date: ${endDateValue}`)
    }

    return {
      endDate: endDateValue,
      parsedEndDate,
      isEndDateConstant: endDateIsConstant,
      unit,
      absoluteValue: true, // Always return absolute difference
    }
  }

  /**
   * Process round operation configuration
   */
  private processRoundOperation(config: DateTimeNodeConfig): any {
    if (!config.round) {
      throw new Error('Round configuration is required for ROUND operation')
    }

    const { direction, unit } = config.round

    if (!direction || !['up', 'down', 'nearest'].includes(direction)) {
      throw new Error('Direction must be "up", "down", or "nearest"')
    }

    if (!Object.values(TimeUnit).includes(unit)) {
      throw new Error(`Invalid time unit: ${unit}`)
    }

    if (!ROUND_FUNCTIONS[unit]) {
      throw new Error(`Cannot round to unit: ${unit}`)
    }

    return { direction, unit }
  }

  /**
   * Process parse date operation configuration
   */
  private processParseDateOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): any {
    if (!config.parseDate) {
      throw new Error('Parse date configuration is required for PARSE_DATE operation')
    }

    const { formatType, customFormat } = config.parseDate

    if (!Object.values(ParseDateFormatType).includes(formatType)) {
      throw new Error(`Invalid parse format type: ${formatType}`)
    }

    if (formatType === ParseDateFormatType.CUSTOM && !customFormat) {
      throw new Error('Custom format string is required when format type is "custom"')
    }

    // Validate custom format if provided
    if (formatType === ParseDateFormatType.CUSTOM && customFormat) {
      try {
        // Test the format with a sample date
        const testDate = '2024-01-01 12:00:00'
        parse(testDate, customFormat, new Date())
      } catch {
        // Format validation - non-blocking, will fail at runtime if truly invalid
        contextManager.log('WARN', 'PARSE_DATE', `Custom format may be invalid: ${customFormat}`)
      }
    }

    return {
      formatType,
      customFormat,
      formatString: this.getParseFormatString(formatType, customFormat),
    }
  }

  /**
   * Get format string for different format types
   */
  private getFormatString(type: DateFormatType, customFormat?: string): string {
    switch (type) {
      case DateFormatType.CUSTOM:
        return customFormat || ''
      case DateFormatType.ISO:
        return ISO_FORMAT
      case DateFormatType.MM_DD_YYYY:
        return 'MM/dd/yyyy'
      case DateFormatType.DD_MM_YYYY:
        return 'dd/MM/yyyy'
      case DateFormatType.YYYY_MM_DD:
        return 'yyyy/MM/dd'
      case DateFormatType.MM_DD_YYYY_DASH:
        return 'MM-dd-yyyy'
      case DateFormatType.DD_MM_YYYY_DASH:
        return 'dd-MM-yyyy'
      case DateFormatType.YYYY_MM_DD_DASH:
        return 'yyyy-MM-dd'
      case DateFormatType.LONG:
        return 'EEEE, MMMM do, yyyy'
      case DateFormatType.SHORT:
        return 'MMM dd, yyyy'
      case DateFormatType.TIME_ONLY:
        return 'HH:mm:ss'
      case DateFormatType.DATE_ONLY:
        return 'yyyy-MM-dd'
      case DateFormatType.RELATIVE:
        return 'relative' // Special case
      case DateFormatType.UNIX:
        return 'unix' // Special case
      case DateFormatType.UNIX_MS:
        return 'unix_ms' // Special case
      default:
        return 'yyyy-MM-dd HH:mm:ss'
    }
  }

  /**
   * Get format string for parsing different format types
   */
  private getParseFormatString(type: ParseDateFormatType, customFormat?: string): string | null {
    switch (type) {
      case ParseDateFormatType.AUTO:
        return null // Auto-detect
      case ParseDateFormatType.CUSTOM:
        return customFormat || ''
      case ParseDateFormatType.ISO:
        return "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"
      case ParseDateFormatType.MM_DD_YYYY:
        return 'MM/dd/yyyy'
      case ParseDateFormatType.DD_MM_YYYY:
        return 'dd/MM/yyyy'
      case ParseDateFormatType.YYYY_MM_DD:
        return 'yyyy/MM/dd'
      case ParseDateFormatType.MM_DD_YYYY_DASH:
        return 'MM-dd-yyyy'
      case ParseDateFormatType.DD_MM_YYYY_DASH:
        return 'dd-MM-yyyy'
      case ParseDateFormatType.YYYY_MM_DD_DASH:
        return 'yyyy-MM-dd'
      case ParseDateFormatType.UNIX:
        return 'unix'
      case ParseDateFormatType.UNIX_MS:
        return 'unix_ms'
      default:
        return null
    }
  }

  /**
   * Parse date string with specified format
   */
  private parseWithFormat(
    dateString: string,
    formatType: ParseDateFormatType,
    formatString: string | null,
    timezone: string
  ): Date {
    let parsedDate: Date

    switch (formatType) {
      // Epoch values are absolute — no zone can reinterpret them.
      case ParseDateFormatType.UNIX:
        parsedDate = new Date(Number(dateString) * 1000)
        break

      case ParseDateFormatType.UNIX_MS:
        parsedDate = new Date(Number(dateString))
        break

      case ParseDateFormatType.AUTO:
      case ParseDateFormatType.ISO:
        parsedDate = this.parseDate(dateString, timezone)
        break

      default: {
        if (!formatString) {
          throw new Error(`Cannot parse without format string for type: ${formatType}`)
        }
        // `parse` produces a server-local wall clock; re-anchor it in the zone.
        const wallClock = parse(dateString, formatString, new Date())
        parsedDate = isValid(wallClock) ? fromZonedTime(wallClock, timezone) : wallClock
        break
      }
    }

    if (!isValid(parsedDate)) {
      throw new Error(`Invalid date result from parsing: "${dateString}"`)
    }

    return parsedDate
  }

  /**
   * Determine output type for format
   */
  private getFormatOutputType(type: DateFormatType): string {
    switch (type) {
      case DateFormatType.UNIX:
      case DateFormatType.UNIX_MS:
        return 'number'
      default:
        return 'string'
    }
  }

  /**
   * Check if operation uses only constant values
   */
  private isOperationConstant(config: DateTimeNodeConfig): boolean {
    switch (config.operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        // Variable-mode duration/unit are resolved during preprocessing, which runs
        // immediately before execution against the same context.
        return true

      case DateTimeOperation.FORMAT:
        return true // Format configuration is constant

      case DateTimeOperation.TIME_BETWEEN:
        return config.timeBetween?.isEndDateConstant ?? true

      case DateTimeOperation.ROUND:
        return true // Rounding configuration is constant

      case DateTimeOperation.PARSE_DATE:
        return true // Format configuration is constant

      default:
        return false
    }
  }

  /**
   * Perform the actual date operation. Every branch is evaluated in
   * `localizationConfig.timezone` — see the file header.
   */
  private performDateOperation(
    inputDate: Date | string,
    operation: DateTimeOperation,
    operationConfig: any,
    localizationConfig: LocalizationConfig
  ): any {
    const { timezone } = localizationConfig

    switch (operation) {
      case DateTimeOperation.ADD_SUBTRACT: {
        const { action, durationObject, unit } = operationConfig
        return this.formatResult(
          this.shiftDate(inputDate as Date, action, durationObject, unit, timezone),
          localizationConfig
        )
      }

      case DateTimeOperation.FORMAT: {
        const { type, formatString } = operationConfig
        const locale = resolveDateFnsLocale(localizationConfig.locale)
        const date = inputDate as Date

        // Epoch output is absolute — the zone cannot change it.
        if (type === DateFormatType.UNIX) return Math.floor(date.getTime() / 1000)
        if (type === DateFormatType.UNIX_MS) return date.getTime()

        // `formatRelative` compares two wall clocks, so both sides move together.
        if (type === DateFormatType.RELATIVE) {
          return formatRelative(toZonedTime(date, timezone), toZonedTime(new Date(), timezone), {
            locale,
          })
        }

        return formatInTimeZone(date, timezone, formatString, { locale })
      }

      case DateTimeOperation.TIME_BETWEEN: {
        const { parsedEndDate, unit } = operationConfig
        const diff = differenceInMilliseconds(parsedEndDate, inputDate as Date)
        return this.convertMillisecondsToUnit(Math.abs(diff), unit)
      }

      case DateTimeOperation.ROUND: {
        const { direction, unit } = operationConfig
        return this.formatResult(
          this.performRounding(inputDate as Date, direction, unit, timezone),
          localizationConfig
        )
      }

      case DateTimeOperation.PARSE_DATE: {
        const { formatType, formatString } = operationConfig
        return this.formatResult(
          this.parseWithFormat(inputDate as string, formatType, formatString, timezone),
          localizationConfig
        )
      }

      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }
  }

  /**
   * Add or subtract a duration, honouring the timezone for calendar units.
   *
   * "+1 day" means the same wall-clock time tomorrow — 23 or 25 real hours
   * across a DST boundary — while "+24 hours" is exactly 24 hours anywhere. So
   * calendar units round-trip through the zone's wall clock and exact units do
   * not.
   */
  private shiftDate(
    date: Date,
    action: 'add' | 'subtract',
    durationObject: Duration,
    unit: TimeUnit,
    timezone: string
  ): Date {
    const apply = (value: Date) =>
      action === 'add' ? add(value, durationObject) : sub(value, durationObject)

    if (!CALENDAR_UNITS.has(unit)) return apply(date)

    return fromZonedTime(apply(toZonedTime(date, timezone)), timezone)
  }

  /**
   * Render a date-producing operation's result.
   *
   * One shape for all three of them: an ISO 8601 string carrying the configured
   * zone's offset, or epoch milliseconds when the node asks for a timestamp.
   * `round` and `parse` used to hand back a raw `Date`, which serialised
   * differently from `add/subtract`'s string on the way into the variable store.
   */
  private formatResult(date: Date, localizationConfig: LocalizationConfig): string | number {
    if (localizationConfig.outputAsTimestamp) return date.getTime()

    return formatInTimeZone(date, localizationConfig.timezone, ISO_FORMAT)
  }

  /**
   * Estimate execution time for different operations
   */
  private estimateExecutionTime(operation: DateTimeOperation): number {
    switch (operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        return 5 // 5ms
      case DateTimeOperation.FORMAT:
        return 10 // 10ms
      case DateTimeOperation.TIME_BETWEEN:
        return 8 // 8ms
      case DateTimeOperation.ROUND:
        return 12 // 12ms
      default:
        return 10 // 10ms
    }
  }

  /**
   * Extract variables from operation-specific configuration
   */
  private extractOperationVariables(config: DateTimeNodeConfig, operationConfig: any): string[] {
    const variables: string[] = []

    if (
      config.operation === DateTimeOperation.TIME_BETWEEN &&
      config.timeBetween &&
      !config.timeBetween.isEndDateConstant
    ) {
      if (config.timeBetween.endDate) {
        variables.push(...this.extractVariableIds(config.timeBetween.endDate))
      }
    }

    return variables
  }

  /**
   * Determine date type from input value
   */
  private determineDateType(value: any): string {
    if (value instanceof Date) return 'date'
    if (typeof value === 'number') return 'timestamp'
    if (typeof value === 'string') {
      if (value.includes('T') && value.includes('Z')) return 'iso'
      if (value.includes('/')) return 'slash_format'
      if (value.includes('-')) return 'dash_format'
    }
    return 'unknown'
  }

  /**
   * Determine output format based on configuration
   */
  private determineOutputFormat(config: DateTimeNodeConfig): string {
    if (config.operation === DateTimeOperation.FORMAT && config.format) {
      return this.getFormatOutputType(config.format.type)
    }

    if (config.operation === DateTimeOperation.TIME_BETWEEN) return 'number'

    // The date-producing operations — the only ones `outputAsTimestamp` reaches.
    return config.outputAsTimestamp ? 'timestamp' : 'string'
  }

  /**
   * Round to a unit boundary **in the configured timezone**.
   *
   * "Start of day" is a wall-clock question, so the boundary is computed on the
   * zone's wall clock and converted back to an instant. Rounded down to the day
   * in `America/New_York`, `2024-01-15T02:30Z` is `2024-01-14T05:00Z` — the
   * previous local day — not the server's midnight.
   */
  private performRounding(date: Date, direction: string, unit: TimeUnit, timezone: string): Date {
    const funcs = ROUND_FUNCTIONS[unit]
    if (!funcs) {
      throw new Error(`Cannot round to unit: ${unit}`)
    }

    const wallClock = toZonedTime(date, timezone)
    const start = fromZonedTime(funcs.start(wallClock), timezone)

    if (direction === 'down') return start

    const end = fromZonedTime(funcs.end(wallClock), timezone)
    if (direction === 'up') return end

    if (direction === 'nearest') {
      const startDiff = Math.abs(date.getTime() - start.getTime())
      const endDiff = Math.abs(date.getTime() - end.getTime())
      return startDiff < endDiff ? start : end
    }

    throw new Error(`Unknown round direction: ${direction}`)
  }

  /**
   * Extract variables from input date and operation-specific fields
   */
  protected extractRequiredVariables(node: WorkflowNode): string[] {
    const config = node.data as unknown as DateTimeNodeConfig
    const variables = new Set<string>()

    // Extract from input date field
    if (config.inputDate && !config.isInputDateConstant) {
      this.extractVariableIds(config.inputDate).forEach((v) => variables.add(v))
    }

    // Extract from time between end date
    if (
      config.operation === DateTimeOperation.TIME_BETWEEN &&
      config.timeBetween?.endDate &&
      !config.timeBetween.isEndDateConstant
    ) {
      this.extractVariableIds(config.timeBetween.endDate).forEach((v) => variables.add(v))
    }

    return Array.from(variables)
  }

  async validate(node: WorkflowNode): Promise<ValidationResult> {
    const errors: string[] = []
    const warnings: string[] = []
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.operation) {
      errors.push('Operation is required')
    }

    if (!config.inputDate) {
      errors.push('Input date is required')
    }

    // A node imported or hand-authored outside the panel's timezone picker can
    // carry a zone `Intl` does not know — surface it here rather than at run time.
    if (config.timezone) {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: config.timezone })
      } catch {
        errors.push(`Invalid timezone: ${config.timezone}`)
      }
    }

    // Validate operation-specific config
    switch (config.operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        if (!config.addSubtract) {
          errors.push('Add/subtract configuration is required')
        } else {
          // A string duration may be a variable reference — only range-check real numbers.
          const { duration } = config.addSubtract
          const numericDuration = typeof duration === 'string' ? Number(duration) : duration
          if (
            numericDuration !== undefined &&
            !Number.isNaN(numericDuration) &&
            numericDuration < 0
          ) {
            errors.push('Duration must be positive')
          }
        }
        break

      case DateTimeOperation.FORMAT:
        if (!config.format) {
          errors.push('Format configuration is required')
        } else if (config.format.type === DateFormatType.CUSTOM && !config.format.customFormat) {
          errors.push('Custom format string is required when using custom format type')
        }
        break

      case DateTimeOperation.TIME_BETWEEN:
        if (!config.timeBetween) {
          errors.push('Time between configuration is required')
        } else if (!config.timeBetween.endDate) {
          errors.push('End date is required for time between operation')
        }
        break

      case DateTimeOperation.ROUND:
        if (!config.round) {
          errors.push('Round configuration is required')
        }
        break

      case DateTimeOperation.PARSE_DATE:
        if (!config.parseDate) {
          errors.push('Parse date configuration is required')
        } else if (
          config.parseDate.formatType === ParseDateFormatType.CUSTOM &&
          !config.parseDate.customFormat
        ) {
          errors.push('Custom format string is required when using custom format type')
        }
        break
    }

    return { valid: errors.length === 0, errors, warnings }
  }
}
