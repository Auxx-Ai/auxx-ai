// packages/lib/src/workflow-engine/nodes/transform-nodes/date-time-processor.ts

import type { Duration } from 'date-fns'
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
import { enUS } from 'date-fns/locale'
import type { ExecutionContextManager } from '../../core/execution-context'
import type {
  NodeExecutionResult,
  PreprocessedNodeData,
  ValidationResult,
  WorkflowNode,
} from '../../core/types'
import { NodeRunningStatus, WorkflowNodeType } from '../../core/types'
import { BaseNodeProcessor } from '../base-node'

/**
 * Date time operation types
 */
enum DateTimeOperation {
  ADD_SUBTRACT = 'add_subtract',
  FORMAT = 'format',
  TIME_BETWEEN = 'time_between',
  ROUND = 'round',
  PARSE_DATE = 'parse_date',
}

/**
 * Time units supported
 */
enum TimeUnit {
  YEARS = 'years',
  QUARTERS = 'quarters',
  MONTHS = 'months',
  WEEKS = 'weeks',
  DAYS = 'days',
  HOURS = 'hours',
  MINUTES = 'minutes',
  SECONDS = 'seconds',
  MILLISECONDS = 'milliseconds',
}

/**
 * Date format types
 */
enum DateFormatType {
  CUSTOM = 'custom',
  ISO = 'iso',
  MM_DD_YYYY = 'mm_dd_yyyy',
  DD_MM_YYYY = 'dd_mm_yyyy',
  YYYY_MM_DD = 'yyyy_mm_dd',
  MM_DD_YYYY_DASH = 'mm-dd-yyyy',
  DD_MM_YYYY_DASH = 'dd-mm-yyyy',
  YYYY_MM_DD_DASH = 'yyyy-mm-dd',
  UNIX = 'unix',
  UNIX_MS = 'unix_ms',
  RELATIVE = 'relative',
  LONG = 'long',
  SHORT = 'short',
  TIME_ONLY = 'time_only',
  DATE_ONLY = 'date_only',
}

/**
 * Parse date format types for PARSE_DATE operation
 */
enum ParseDateFormatType {
  AUTO = 'auto',
  ISO = 'iso',
  MM_DD_YYYY = 'mm_dd_yyyy',
  DD_MM_YYYY = 'dd_mm_yyyy',
  YYYY_MM_DD = 'yyyy_mm_dd',
  MM_DD_YYYY_DASH = 'mm-dd-yyyy',
  DD_MM_YYYY_DASH = 'dd-mm-yyyy',
  YYYY_MM_DD_DASH = 'yyyy-mm-dd',
  UNIX = 'unix',
  UNIX_MS = 'unix_ms',
  CUSTOM = 'custom',
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
  timezone?: string
  locale?: string
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

    // 1. Process and validate input date
    // For PARSE_DATE, don't parse the input - keep it as a string
    const inputDateInfo = await this.processInputDate(
      config,
      contextManager,
      config.operation === DateTimeOperation.PARSE_DATE
    )

    // 2. Process operation-specific configuration
    let operationConfig: any = null

    switch (config.operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        operationConfig = await this.processAddSubtractOperation(config, contextManager)
        break

      case DateTimeOperation.FORMAT:
        operationConfig = await this.processFormatOperation(config, contextManager)
        break

      case DateTimeOperation.TIME_BETWEEN:
        operationConfig = await this.processTimeBetweenOperation(config, contextManager)
        break

      case DateTimeOperation.ROUND:
        operationConfig = await this.processRoundOperation(config, contextManager)
        break

      case DateTimeOperation.PARSE_DATE:
        operationConfig = await this.processParseDateOperation(config, contextManager)
        break

      default:
        throw new Error(`Unsupported operation: ${config.operation}`)
    }

    // 3. Process timezone and locale settings
    const localizationConfig = {
      timezone: config.timezone || 'UTC',
      locale: config.locale || 'en-US',
      outputAsTimestamp: config.outputAsTimestamp || false,
    }

    // 4. Validate timezone
    try {
      Intl.DateTimeFormat(localizationConfig.locale, { timeZone: localizationConfig.timezone })
    } catch (error) {
      throw new Error(`Invalid timezone: ${localizationConfig.timezone}`)
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

        preCalculatedResult = await this.performDateOperation(
          inputValue,
          config.operation,
          operationConfig,
          localizationConfig
        )
      } catch (error) {
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

  protected async executeNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager,
    preprocessedData?: PreprocessedNodeData
  ): Promise<Partial<NodeExecutionResult>> {
    // Use preprocessed data if available
    if (preprocessedData?.inputs) {
      const inputs = preprocessedData.inputs

      contextManager.log(
        'INFO',
        node.name,
        `Executing date-time operation with preprocessed data: ${inputs.operation}`,
        {
          operation: inputs.operation,
          hasPreCalculatedResult: inputs.canPreCalculate,
          timezone: inputs.localizationConfig.timezone,
          locale: inputs.localizationConfig.locale,
        }
      )

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
          // Perform calculation with preprocessed configuration
          result = await this.executeWithPreprocessedData(inputs, contextManager)
        }

        // Set output variable using preprocessed configuration
        contextManager.setVariable(inputs.outputVariable, result)
        contextManager.setNodeVariable(node.nodeId, 'result', result)

        contextManager.log(
          'INFO',
          node.name,
          'Date-time operation completed with preprocessed data',
          {
            operation: inputs.operation,
            result,
            usedPreCalculatedResult: inputs.canPreCalculate,
            outputVariable: inputs.outputVariable,
            usedPreprocessedData: true,
            preprocessingBenefit: 'Skip date parsing and operation configuration',
          }
        )

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
            executionTime: preprocessedData.metadata?.estimatedExecutionTime,
            usedPreprocessedData: true,
          },
          outputHandle: 'source',
        }
      } catch (error) {
        contextManager.log(
          'ERROR',
          node.name,
          'Date-time operation failed with preprocessed data',
          {
            error: error instanceof Error ? error.message : String(error),
            operation: inputs.operation,
            usedPreprocessedData: true,
          }
        )
        throw error
      }
    }

    // Fallback to original implementation
    return this.originalExecuteNode(node, contextManager)
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
        if (
          inputDateInfo.originalValue.includes('{{') &&
          inputDateInfo.originalValue.includes('}}')
        ) {
          inputValue = await this.interpolateVariables(inputDateInfo.originalValue, contextManager)
        } else {
          inputValue = await this.resolveVariablePath(inputDateInfo.originalValue, contextManager)
        }
      }

      // Execute parse operation with string value
      return await this.performDateOperation(
        inputValue,
        operation,
        operationConfig,
        localizationConfig
      )
    }

    // For other operations, use parsed date
    let inputDate = inputDateInfo.parsedDate

    if (!inputDateInfo.isConstant) {
      // Re-resolve the variable value at execution time
      let currentInputValue: any
      if (
        inputDateInfo.originalValue.includes('{{') &&
        inputDateInfo.originalValue.includes('}}')
      ) {
        currentInputValue = await this.interpolateVariables(
          inputDateInfo.originalValue,
          contextManager
        )
      } else {
        currentInputValue = await this.resolveVariablePath(
          inputDateInfo.originalValue,
          contextManager
        )
      }

      inputDate = this.parseDate(currentInputValue)
      if (!isValid(inputDate)) {
        throw new Error(`Invalid input date: ${currentInputValue}`)
      }
    }

    // Execute operation with preprocessed configuration
    return await this.performDateOperation(
      inputDate,
      operation,
      operationConfig,
      localizationConfig
    )
  }

  /**
   * Original executeNode implementation (fallback)
   */
  private async originalExecuteNode(
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Partial<NodeExecutionResult>> {
    try {
      const config = node.data as unknown as DateTimeNodeConfig

      contextManager.log('INFO', node.name, `Executing date-time operation: ${config.operation}`)

      // Get input date value
      const inputDateValue = await this.extractDateValue(
        config.inputDate,
        config.isInputDateConstant ?? true,
        contextManager
      )

      if (!inputDateValue) {
        throw new Error('Input date is required')
      }

      let result: any

      // Handle PARSE_DATE separately since it takes a string input
      if (config.operation === DateTimeOperation.PARSE_DATE) {
        result = await this.executeParseDateOperation(inputDateValue, node, contextManager)
      } else {
        // Parse the input date for other operations
        const inputDate = this.parseDate(inputDateValue)
        if (!isValid(inputDate)) {
          throw new Error(`Invalid input date: ${inputDateValue}`)
        }

        switch (config.operation) {
          case DateTimeOperation.ADD_SUBTRACT:
            result = await this.executeAddSubtract(inputDate, node, contextManager)
            break

          case DateTimeOperation.FORMAT:
            result = await this.executeFormat(inputDate, node)
            break

          case DateTimeOperation.TIME_BETWEEN:
            result = await this.executeTimeBetween(inputDate, node, contextManager)
            break

          case DateTimeOperation.ROUND:
            result = await this.executeRound(inputDate, node)
            break

          default:
            throw new Error(`Unknown operation: ${config.operation}`)
        }
      }

      // Set output variable
      contextManager.setNodeVariable(node.nodeId, 'result', result)

      return {
        status: NodeRunningStatus.Succeeded,
        output: { result, operation: config.operation },
        outputHandle: 'source', // Standard output for transform nodes
      }
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.name,
        `Error in date-time operation: ${error instanceof Error ? error.message : String(error)}`
      )
      throw error
    }
  }

  /**
   * Extract date value from field that might be a variable reference
   */
  private async extractDateValue(
    value: any,
    isConstant: boolean,
    contextManager: ExecutionContextManager
  ): Promise<any> {
    // If marked as constant, return the value directly
    if (isConstant || isConstant === undefined) {
      // Default to constant for backward compatibility
      return value
    }

    // If not constant, treat as variable reference
    if (value && typeof value === 'string') {
      // Value is the variable ID
      const varValue = await contextManager.getVariable(value)
      return varValue
    }

    return value
  }

  /**
   * Parse date from various formats
   */
  private parseDate(value: any): Date {
    if (value instanceof Date) return value
    if (typeof value === 'number') return new Date(value)
    if (typeof value === 'string') {
      // Try ISO format first
      let date = new Date(value)
      if (isValid(date)) return date

      // Try common formats
      const formats = ['yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MM-dd-yyyy', 'dd-MM-yyyy']

      for (const fmt of formats) {
        date = parse(value, fmt, new Date())
        if (isValid(date)) return date
      }
    }

    throw new Error(`Cannot parse date: ${value}`)
  }

  /**
   * Execute add/subtract operation
   */
  private async executeAddSubtract(
    date: Date,
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Date> {
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.addSubtract) {
      throw new Error('Add/subtract configuration is required')
    }

    // Resolve duration — may be a variable reference (string) or a constant (number)
    let resolvedDuration: number
    const isDurationConstant = config.fieldModes?.['duration'] ?? true
    if (!isDurationConstant && typeof config.addSubtract.duration === 'string') {
      const resolved = await this.resolveVariablePath(config.addSubtract.duration, contextManager)
      resolvedDuration = typeof resolved === 'number' ? resolved : parseInt(String(resolved), 10)
      if (Number.isNaN(resolvedDuration)) {
        throw new Error(`Invalid duration value resolved from variable: ${resolved}`)
      }
    } else {
      resolvedDuration =
        typeof config.addSubtract.duration === 'number' ? config.addSubtract.duration : 0
    }

    // Resolve unit — may be a variable reference (string) or a constant TimeUnit
    let resolvedUnit: TimeUnit
    const isUnitConstant = config.fieldModes?.['unit'] ?? true
    if (!isUnitConstant) {
      const resolved = await this.resolveVariablePath(config.addSubtract.unit, contextManager)
      resolvedUnit = String(resolved) as TimeUnit
    } else {
      resolvedUnit = config.addSubtract.unit as TimeUnit
    }

    const duration = this.convertDuration(resolvedDuration, resolvedUnit)

    if (config.addSubtract.action === 'add') {
      return add(date, duration)
    } else {
      return sub(date, duration)
    }
  }

  /**
   * Execute format operation
   */
  private async executeFormat(date: Date, node: WorkflowNode): Promise<string> {
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.format) {
      throw new Error('Format configuration is required')
    }

    const locale = config.locale ? { locale: enUS } : undefined

    switch (config.format.type) {
      case DateFormatType.ISO:
        return date.toISOString()

      case DateFormatType.MM_DD_YYYY:
        return format(date, 'MM/dd/yyyy', locale)

      case DateFormatType.DD_MM_YYYY:
        return format(date, 'dd/MM/yyyy', locale)

      case DateFormatType.YYYY_MM_DD:
        return format(date, 'yyyy/MM/dd', locale)

      case DateFormatType.MM_DD_YYYY_DASH:
        return format(date, 'MM-dd-yyyy', locale)

      case DateFormatType.DD_MM_YYYY_DASH:
        return format(date, 'dd-MM-yyyy', locale)

      case DateFormatType.YYYY_MM_DD_DASH:
        return format(date, 'yyyy-MM-dd', locale)

      case DateFormatType.UNIX:
        return String(Math.floor(date.getTime() / 1000))

      case DateFormatType.UNIX_MS:
        return String(date.getTime())

      case DateFormatType.RELATIVE:
        return formatRelative(date, new Date(), locale)

      case DateFormatType.LONG:
        return format(date, 'MMMM d, yyyy', locale)

      case DateFormatType.SHORT:
        return format(date, 'M/d/yy', locale)

      case DateFormatType.TIME_ONLY:
        return format(date, 'HH:mm:ss', locale)

      case DateFormatType.DATE_ONLY:
        return format(date, 'yyyy-MM-dd', locale)

      case DateFormatType.CUSTOM:
        if (!config.format.customFormat) {
          throw new Error('Custom format string is required')
        }
        return format(date, config.format.customFormat, locale)

      default:
        throw new Error(`Unknown format type: ${config.format.type}`)
    }
  }

  /**
   * Execute time between operation
   */
  private async executeTimeBetween(
    startDate: Date,
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<number> {
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.timeBetween) {
      throw new Error('Time between configuration is required')
    }

    // Get end date
    const endDateValue = await this.extractDateValue(
      config.timeBetween.endDate,
      config.timeBetween.isEndDateConstant ?? true,
      contextManager
    )

    if (!endDateValue) {
      throw new Error('End date is required for time between operation')
    }

    const endDate = this.parseDate(endDateValue)
    if (!isValid(endDate)) {
      throw new Error(`Invalid end date: ${endDateValue}`)
    }

    // Calculate difference in milliseconds
    const diffMs = differenceInMilliseconds(endDate, startDate)

    // Convert to requested unit
    return this.convertMillisecondsToUnit(diffMs, config.timeBetween.unit)
  }

  /**
   * Execute round operation
   */
  private async executeRound(date: Date, node: WorkflowNode): Promise<Date> {
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.round) {
      throw new Error('Round configuration is required')
    }

    const { direction, unit } = config.round

    // Map of unit to start/end functions
    const roundFunctions = {
      [TimeUnit.YEARS]: { start: startOfYear, end: endOfYear },
      [TimeUnit.MONTHS]: { start: startOfMonth, end: endOfMonth },
      [TimeUnit.WEEKS]: { start: startOfWeek, end: endOfWeek },
      [TimeUnit.DAYS]: { start: startOfDay, end: endOfDay },
      [TimeUnit.HOURS]: { start: startOfHour, end: endOfHour },
      [TimeUnit.MINUTES]: { start: startOfMinute, end: endOfMinute },
      [TimeUnit.SECONDS]: { start: startOfSecond, end: endOfSecond },
    } as any

    const funcs = roundFunctions[unit]
    if (!funcs) {
      throw new Error(`Cannot round to unit: ${unit}`)
    }

    switch (direction) {
      case 'down':
        return funcs.start(date)

      case 'up':
        return funcs.end(date)

      case 'nearest': {
        const start = funcs.start(date)
        const end = funcs.end(date)
        const startDiff = Math.abs(date.getTime() - start.getTime())
        const endDiff = Math.abs(date.getTime() - end.getTime())
        return startDiff < endDiff ? start : end
      }

      default:
        throw new Error(`Unknown round direction: ${direction}`)
    }
  }

  /**
   * Execute parse date operation
   */
  private async executeParseDateOperation(
    dateString: string,
    node: WorkflowNode,
    contextManager: ExecutionContextManager
  ): Promise<Date> {
    const config = node.data as unknown as DateTimeNodeConfig
    if (!config.parseDate) {
      throw new Error('Parse date configuration is required')
    }

    const { formatType, customFormat } = config.parseDate

    try {
      let parsedDate: Date

      switch (formatType) {
        case ParseDateFormatType.AUTO:
          // Auto-detect format using existing parseDate method
          parsedDate = this.parseDate(dateString)
          break

        case ParseDateFormatType.UNIX:
          // Unix timestamp in seconds
          parsedDate = new Date(Number(dateString) * 1000)
          break

        case ParseDateFormatType.UNIX_MS:
          // Unix timestamp in milliseconds
          parsedDate = new Date(Number(dateString))
          break

        case ParseDateFormatType.ISO:
          // ISO 8601 format
          parsedDate = new Date(dateString)
          break

        case ParseDateFormatType.CUSTOM:
          if (!customFormat) {
            throw new Error('Custom format string is required')
          }
          parsedDate = parse(dateString, customFormat, new Date())
          break

        default: {
          // Use predefined format
          const formatString = this.getParseFormatString(formatType)
          if (!formatString) {
            throw new Error(`Cannot determine format string for: ${formatType}`)
          }
          parsedDate = parse(dateString, formatString, new Date())
          break
        }
      }

      if (!isValid(parsedDate)) {
        throw new Error(`Failed to parse date string: "${dateString}" with format: ${formatType}`)
      }

      contextManager.log(
        'INFO',
        node.name,
        `Successfully parsed date: ${dateString} -> ${parsedDate.toISOString()}`,
        { formatType, customFormat }
      )

      return parsedDate
    } catch (error) {
      contextManager.log(
        'ERROR',
        node.name,
        `Failed to parse date string: ${error instanceof Error ? error.message : String(error)}`,
        { dateString, formatType, customFormat }
      )
      throw error
    }
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
    skipParsing = false
  ): Promise<any> {
    if (!config.inputDate) {
      throw new Error('Input date is required')
    }

    let inputDateValue: any
    const isConstant = config.isInputDateConstant ?? true

    if (isConstant) {
      // Constant date value
      inputDateValue = config.inputDate
    } else {
      // Variable date - resolve and interpolate
      if (config.inputDate.includes('{{') && config.inputDate.includes('}}')) {
        inputDateValue = await this.interpolateVariables(config.inputDate, contextManager)
      } else {
        inputDateValue = await this.resolveVariablePath(config.inputDate, contextManager)
      }
    }

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
    const parsedDate = this.parseDate(inputDateValue)

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

    const { action, duration, unit } = config.addSubtract

    if (!action || !['add', 'subtract'].includes(action)) {
      throw new Error('Action must be either "add" or "subtract"')
    }

    if (typeof duration !== 'number' || duration <= 0) {
      throw new Error('Duration must be a positive number')
    }

    if (!Object.values(TimeUnit).includes(unit)) {
      throw new Error(`Invalid time unit: ${unit}`)
    }

    return { action, duration, unit, durationObject: this.createDurationObject(duration, unit) }
  }

  /**
   * Process format operation configuration
   */
  private async processFormatOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<any> {
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
      } catch (error) {
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
    contextManager: ExecutionContextManager
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
    let endDateValue: any
    const endDateIsConstant = isEndDateConstant ?? true

    if (endDateIsConstant) {
      endDateValue = endDate
    } else {
      if (endDate.includes('{{') && endDate.includes('}}')) {
        endDateValue = await this.interpolateVariables(endDate, contextManager)
      } else {
        endDateValue = await this.resolveVariablePath(endDate, contextManager)
      }
    }

    // Parse and validate end date
    const parsedEndDate = this.parseDate(endDateValue)

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
  private async processRoundOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<any> {
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

    return { direction, unit, roundingFunction: this.getRoundingFunction(direction, unit) }
  }

  /**
   * Process parse date operation configuration
   */
  private async processParseDateOperation(
    config: DateTimeNodeConfig,
    contextManager: ExecutionContextManager
  ): Promise<any> {
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
      } catch (error) {
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
   * Create duration object for date-fns
   */
  private createDurationObject(duration: number, unit: TimeUnit): Duration {
    const durationObj: Duration = {}

    switch (unit) {
      case TimeUnit.YEARS:
        durationObj.years = duration
        break
      case TimeUnit.MONTHS:
        durationObj.months = duration
        break
      case TimeUnit.WEEKS:
        durationObj.weeks = duration
        break
      case TimeUnit.DAYS:
        durationObj.days = duration
        break
      case TimeUnit.HOURS:
        durationObj.hours = duration
        break
      case TimeUnit.MINUTES:
        durationObj.minutes = duration
        break
      case TimeUnit.SECONDS:
        durationObj.seconds = duration
        break
      default:
        durationObj.days = duration
        break
    }

    return durationObj
  }

  /**
   * Get format string for different format types
   */
  private getFormatString(type: DateFormatType, customFormat?: string): string {
    switch (type) {
      case DateFormatType.CUSTOM:
        return customFormat || ''
      case DateFormatType.ISO:
        return "yyyy-MM-dd'T'HH:mm:ss.SSSxxx"
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
    formatString: string | null
  ): Date {
    let parsedDate: Date

    switch (formatType) {
      case ParseDateFormatType.AUTO:
        parsedDate = this.parseDate(dateString)
        break

      case ParseDateFormatType.UNIX:
        parsedDate = new Date(Number(dateString) * 1000)
        break

      case ParseDateFormatType.UNIX_MS:
        parsedDate = new Date(Number(dateString))
        break

      case ParseDateFormatType.ISO:
        parsedDate = new Date(dateString)
        break

      default:
        if (!formatString) {
          throw new Error(`Cannot parse without format string for type: ${formatType}`)
        }
        parsedDate = parse(dateString, formatString, new Date())
        break
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
        return true // Duration and unit are constants

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
   * Perform the actual date operation (for pre-calculation)
   */
  private async performDateOperation(
    inputDate: Date | string,
    operation: DateTimeOperation,
    operationConfig: any,
    localizationConfig: any
  ): Promise<any> {
    switch (operation) {
      case DateTimeOperation.ADD_SUBTRACT: {
        const { action, durationObject } = operationConfig
        const result =
          action === 'add'
            ? add(inputDate as Date, durationObject)
            : sub(inputDate as Date, durationObject)
        return this.formatResult(result, localizationConfig)
      }

      case DateTimeOperation.FORMAT: {
        const { type, formatString } = operationConfig

        if (type === DateFormatType.RELATIVE) {
          return formatRelative(inputDate as Date, new Date(), { locale: enUS })
        } else if (type === DateFormatType.UNIX) {
          return Math.floor((inputDate as Date).getTime() / 1000)
        } else if (type === DateFormatType.UNIX_MS) {
          return (inputDate as Date).getTime()
        } else {
          return format(inputDate as Date, formatString)
        }
      }

      case DateTimeOperation.TIME_BETWEEN: {
        const { parsedEndDate, unit } = operationConfig
        const diff = differenceInMilliseconds(parsedEndDate, inputDate as Date)
        return this.convertMillisecondsToUnit(Math.abs(diff), unit)
      }

      case DateTimeOperation.ROUND: {
        const { direction, unit } = operationConfig
        return this.performRounding(inputDate as Date, direction, unit, localizationConfig)
      }

      case DateTimeOperation.PARSE_DATE: {
        const { formatType, formatString } = operationConfig
        return this.parseWithFormat(inputDate as string, formatType, formatString)
      }

      default:
        throw new Error(`Unsupported operation: ${operation}`)
    }
  }

  /**
   * Format result based on localization configuration
   */
  private formatResult(date: Date, localizationConfig: any): any {
    if (localizationConfig.outputAsTimestamp) {
      return date.getTime()
    }

    return date.toISOString()
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
   * Extract variable IDs from a string
   */
  // private extractVariableIds(value: string): string[] {
  //   const variables: string[] = [];
  //   const variablePattern = /\{\{([^}]+)\}\}/g;
  //   let match;

  //   while ((match = variablePattern.exec(value)) !== null) {
  //     variables.push(match[1].trim());
  //   }

  //   return variables;
  // }

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
    if (config.outputAsTimestamp) return 'timestamp'

    if (config.operation === DateTimeOperation.FORMAT && config.format) {
      return this.getFormatOutputType(config.format.type)
    }

    return 'string'
  }

  /**
   * Get rounding function for direction and unit
   */
  private getRoundingFunction(direction: string, unit: TimeUnit): any {
    // This would contain the actual rounding logic
    return { direction, unit }
  }

  /**
   * Perform rounding operation
   */
  private performRounding(
    date: Date,
    direction: string,
    unit: TimeUnit,
    localizationConfig: any
  ): Date {
    // Map of unit to start/end functions
    const roundFunctions = {
      [TimeUnit.YEARS]: { start: startOfYear, end: endOfYear },
      [TimeUnit.MONTHS]: { start: startOfMonth, end: endOfMonth },
      [TimeUnit.WEEKS]: { start: startOfWeek, end: endOfWeek },
      [TimeUnit.DAYS]: { start: startOfDay, end: endOfDay },
      [TimeUnit.HOURS]: { start: startOfHour, end: endOfHour },
      [TimeUnit.MINUTES]: { start: startOfMinute, end: endOfMinute },
      [TimeUnit.SECONDS]: { start: startOfSecond, end: endOfSecond },
    } as any

    const funcs = roundFunctions[unit]
    if (!funcs) {
      throw new Error(`Cannot round to unit: ${unit}`)
    }

    switch (direction) {
      case 'down':
        return funcs.start(date)

      case 'up':
        return funcs.end(date)

      case 'nearest': {
        const start = funcs.start(date)
        const end = funcs.end(date)
        const startDiff = Math.abs(date.getTime() - start.getTime())
        const endDiff = Math.abs(date.getTime() - end.getTime())
        return startDiff < endDiff ? start : end
      }

      default:
        throw new Error(`Unknown round direction: ${direction}`)
    }
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

    // Validate operation-specific config
    switch (config.operation) {
      case DateTimeOperation.ADD_SUBTRACT:
        if (!config.addSubtract) {
          errors.push('Add/subtract configuration is required')
        } else {
          if (config.addSubtract.duration < 0) {
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
