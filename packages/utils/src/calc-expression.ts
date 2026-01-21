// packages/utils/src/calc-expression.ts

import type { TypedFieldValue } from '@auxx/types/field-value'

/**
 * Function definition for the expression evaluator
 */
export interface CalcFunction {
  name: string
  fn: (...args: unknown[]) => unknown
  minArgs?: number
  maxArgs?: number
}

/**
 * Registry of available calculation functions.
 * All functions are safe (no eval) and handle null/undefined gracefully.
 */
export const CALC_FUNCTIONS: Record<string, CalcFunction> = {
  // ─────────────────────────────────────────────────────────────
  // String functions
  // ─────────────────────────────────────────────────────────────
  concat: {
    name: 'concat',
    fn: (...args: unknown[]) => args.map((a) => String(a ?? '')).join(''),
  },
  upper: {
    name: 'upper',
    fn: (str: unknown) => String(str ?? '').toUpperCase(),
    minArgs: 1,
    maxArgs: 1,
  },
  lower: {
    name: 'lower',
    fn: (str: unknown) => String(str ?? '').toLowerCase(),
    minArgs: 1,
    maxArgs: 1,
  },
  trim: {
    name: 'trim',
    fn: (str: unknown) => String(str ?? '').trim(),
    minArgs: 1,
    maxArgs: 1,
  },
  length: {
    name: 'length',
    fn: (str: unknown) => String(str ?? '').length,
    minArgs: 1,
    maxArgs: 1,
  },

  // ─────────────────────────────────────────────────────────────
  // Math functions
  // ─────────────────────────────────────────────────────────────
  add: {
    name: 'add',
    fn: (...args: unknown[]) => args.reduce<number>((sum, n) => sum + (Number(n) || 0), 0),
  },
  subtract: {
    name: 'subtract',
    fn: (a: unknown, b: unknown) => (Number(a) || 0) - (Number(b) || 0),
    minArgs: 2,
    maxArgs: 2,
  },
  multiply: {
    name: 'multiply',
    fn: (...args: unknown[]) => args.reduce<number>((prod, n) => prod * (Number(n) || 0), 1),
  },
  divide: {
    name: 'divide',
    fn: (a: unknown, b: unknown) => {
      const divisor = Number(b) || 0
      if (divisor === 0) return null // Avoid division by zero
      return (Number(a) || 0) / divisor
    },
    minArgs: 2,
    maxArgs: 2,
  },
  round: {
    name: 'round',
    fn: (n: unknown, decimals: unknown = 0) => {
      const num = Number(n) || 0
      const dec = Math.max(0, Math.min(10, Number(decimals) || 0))
      const factor = Math.pow(10, dec)
      return Math.round(num * factor) / factor
    },
    minArgs: 1,
    maxArgs: 2,
  },
  floor: {
    name: 'floor',
    fn: (n: unknown) => Math.floor(Number(n) || 0),
    minArgs: 1,
    maxArgs: 1,
  },
  ceil: {
    name: 'ceil',
    fn: (n: unknown) => Math.ceil(Number(n) || 0),
    minArgs: 1,
    maxArgs: 1,
  },
  abs: {
    name: 'abs',
    fn: (n: unknown) => Math.abs(Number(n) || 0),
    minArgs: 1,
    maxArgs: 1,
  },
  min: {
    name: 'min',
    fn: (...args: unknown[]) => Math.min(...args.map((n) => Number(n) || 0)),
    minArgs: 1,
  },
  max: {
    name: 'max',
    fn: (...args: unknown[]) => Math.max(...args.map((n) => Number(n) || 0)),
    minArgs: 1,
  },

  // ─────────────────────────────────────────────────────────────
  // Logic functions
  // ─────────────────────────────────────────────────────────────
  if: {
    name: 'if',
    fn: (cond: unknown, thenVal: unknown, elseVal: unknown) => (Boolean(cond) ? thenVal : elseVal),
    minArgs: 3,
    maxArgs: 3,
  },
  coalesce: {
    name: 'coalesce',
    fn: (...args: unknown[]) => args.find((a) => a != null && a !== '') ?? null,
    minArgs: 1,
  },
}

/**
 * Parsed expression AST node
 */
export interface ParsedExpression {
  type: 'function' | 'literal' | 'field'
  value: string | number | boolean
  args?: ParsedExpression[]
}

/**
 * Tokenize expression string into tokens.
 * Handles: function names, parentheses, commas, string literals, numbers, field references {{...}}
 */
function tokenize(expression: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''
  let braceDepth = 0

  for (let i = 0; i < expression.length; i++) {
    const char = expression[i]

    if (inString) {
      if (char === stringChar && expression[i - 1] !== '\\') {
        tokens.push(current + char)
        current = ''
        inString = false
      } else {
        current += char
      }
    } else if (char === '{' && expression[i + 1] === '{') {
      // Start of field reference {{
      if (current.trim()) tokens.push(current.trim())
      current = '{{'
      i++ // Skip next {
      braceDepth = 2
    } else if (braceDepth > 0) {
      current += char
      if (char === '}' && expression[i + 1] === '}') {
        current += '}'
        i++ // Skip next }
        tokens.push(current)
        current = ''
        braceDepth = 0
      }
    } else if (char === '"' || char === "'") {
      if (current.trim()) tokens.push(current.trim())
      current = char
      inString = true
      stringChar = char
    } else if (char === '(' || char === ')' || char === ',') {
      if (current.trim()) tokens.push(current.trim())
      tokens.push(char)
      current = ''
    } else if (char === ' ' || char === '\t' || char === '\n') {
      if (current.trim()) tokens.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  if (current.trim()) tokens.push(current.trim())
  return tokens
}

/**
 * Parse tokens into expression tree
 */
function parseTokens(tokens: string[], index: { value: number }): ParsedExpression {
  const token = tokens[index.value]

  // Field reference {{fieldKey}}
  if (token.startsWith('{{') && token.endsWith('}}')) {
    index.value++
    const fieldKey = token.slice(2, -2).trim()
    return { type: 'field', value: fieldKey }
  }

  // String literal
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    index.value++
    return { type: 'literal', value: token.slice(1, -1) }
  }

  // Number literal
  if (/^-?\d+\.?\d*$/.test(token)) {
    index.value++
    return { type: 'literal', value: Number(token) }
  }

  // Boolean literal
  if (token === 'true' || token === 'false') {
    index.value++
    return { type: 'literal', value: token === 'true' }
  }

  // Function call or field reference
  if (tokens[index.value + 1] === '(') {
    // Function call
    const funcName = token.toLowerCase()
    index.value += 2 // Skip function name and '('

    const args: ParsedExpression[] = []
    while (tokens[index.value] !== ')') {
      if (tokens[index.value] === ',') {
        index.value++
        continue
      }
      args.push(parseTokens(tokens, index))
    }
    index.value++ // Skip ')'

    return { type: 'function', value: funcName, args }
  }

  // Bare field reference (legacy support without braces)
  index.value++
  return { type: 'field', value: token }
}

/**
 * Parse expression string into AST
 */
function parseExpression(expression: string): ParsedExpression {
  const tokens = tokenize(expression)
  if (tokens.length === 0) {
    throw new Error('Empty expression')
  }
  return parseTokens(tokens, { value: 0 })
}

/**
 * Extract raw value from TypedFieldValue or unknown input.
 * Handles both TypedFieldValue objects and raw primitive values.
 */
function extractValue(fieldValue: TypedFieldValue | unknown): unknown {
  if (!fieldValue || typeof fieldValue !== 'object') return fieldValue

  const typed = fieldValue as TypedFieldValue
  switch (typed.type) {
    case 'text':
      return typed.value
    case 'number':
      return typed.value
    case 'boolean':
      return typed.value
    case 'date':
      return typed.value // ISO string
    case 'option':
      return typed.label ?? typed.optionId ?? null
    case 'json':
      return typed.value
    case 'relationship':
      return typed.displayName ?? typed.recordId ?? null
    default:
      // Handle raw values that might have a value property
      if ('value' in (fieldValue as { value?: unknown })) {
        return (fieldValue as { value: unknown }).value
      }
      return null
  }
}

/**
 * Evaluate parsed expression with field values context
 */
function evaluateExpression(expr: ParsedExpression, fieldValues: Record<string, unknown>): unknown {
  switch (expr.type) {
    case 'literal':
      return expr.value

    case 'field': {
      const fieldKey = String(expr.value)
      const raw = fieldValues[fieldKey]
      return extractValue(raw)
    }

    case 'function': {
      const funcDef = CALC_FUNCTIONS[String(expr.value)]
      if (!funcDef) {
        throw new Error(`Unknown function: ${expr.value}`)
      }

      // Evaluate arguments
      const args = (expr.args || []).map((arg) => evaluateExpression(arg, fieldValues))

      // Validate argument count
      if (funcDef.minArgs && args.length < funcDef.minArgs) {
        throw new Error(`${funcDef.name} requires at least ${funcDef.minArgs} arguments`)
      }
      if (funcDef.maxArgs && args.length > funcDef.maxArgs) {
        throw new Error(`${funcDef.name} accepts at most ${funcDef.maxArgs} arguments`)
      }

      return funcDef.fn(...args)
    }

    default:
      return null
  }
}

/**
 * Evaluate a calculation expression with field values.
 *
 * @param expression - The expression string, e.g., 'multiply({{quantity}}, {{unitPrice}})'
 * @param fieldValues - Map of field key to TypedFieldValue or raw value
 * @returns The computed result, or null if evaluation fails
 */
export function evaluateCalcExpression(expression: string, fieldValues: Record<string, unknown>): unknown {
  try {
    const parsed = parseExpression(expression)
    return evaluateExpression(parsed, fieldValues)
  } catch (error) {
    console.warn('[evaluateCalcExpression] Evaluation failed:', error)
    return null
  }
}

/**
 * Validate an expression and extract source fields.
 * Used during field creation/update to ensure expression is valid.
 *
 * @param expression - The expression to validate
 * @returns Object with isValid, extractedFields, and optional error
 */
export function validateCalcExpression(expression: string): {
  isValid: boolean
  extractedFields: string[]
  error?: string
} {
  try {
    const parsed = parseExpression(expression)
    const fields = new Set<string>()

    function collectFields(expr: ParsedExpression) {
      if (expr.type === 'field') {
        fields.add(String(expr.value))
      }
      if (expr.args) {
        expr.args.forEach(collectFields)
      }
    }

    collectFields(parsed)

    // Validate all function names exist
    function validateFunctions(expr: ParsedExpression): string | null {
      if (expr.type === 'function' && !CALC_FUNCTIONS[String(expr.value)]) {
        return `Unknown function: ${expr.value}`
      }
      if (expr.args) {
        for (const arg of expr.args) {
          const err = validateFunctions(arg)
          if (err) return err
        }
      }
      return null
    }

    const funcError = validateFunctions(parsed)
    if (funcError) {
      return { isValid: false, extractedFields: [], error: funcError }
    }

    return { isValid: true, extractedFields: Array.from(fields) }
  } catch (error) {
    return {
      isValid: false,
      extractedFields: [],
      error: error instanceof Error ? error.message : 'Invalid expression',
    }
  }
}

/**
 * Get list of available calculation functions for UI display.
 * Returns function metadata including name, description, signature, and example.
 */
export function getAvailableFunctions(): Array<{
  name: string
  description: string
  signature: string
  example: string
}> {
  return [
    {
      name: 'concat',
      description: 'Join strings together',
      signature: 'concat(...values)',
      example: 'concat({{firstName}}, " ", {{lastName}})',
    },
    { name: 'upper', description: 'Convert to uppercase', signature: 'upper(text)', example: 'upper({{name}})' },
    { name: 'lower', description: 'Convert to lowercase', signature: 'lower(text)', example: 'lower({{email}})' },
    { name: 'trim', description: 'Remove whitespace', signature: 'trim(text)', example: 'trim({{notes}})' },
    {
      name: 'length',
      description: 'Get string length',
      signature: 'length(text)',
      example: 'length({{description}})',
    },
    {
      name: 'add',
      description: 'Add numbers',
      signature: 'add(...numbers)',
      example: 'add({{price}}, {{tax}}, {{shipping}})',
    },
    {
      name: 'subtract',
      description: 'Subtract b from a',
      signature: 'subtract(a, b)',
      example: 'subtract({{total}}, {{discount}})',
    },
    {
      name: 'multiply',
      description: 'Multiply numbers',
      signature: 'multiply(...numbers)',
      example: 'multiply({{qty}}, {{price}})',
    },
    { name: 'divide', description: 'Divide a by b', signature: 'divide(a, b)', example: 'divide({{total}}, {{count}})' },
    {
      name: 'round',
      description: 'Round to decimals',
      signature: 'round(number, decimals?)',
      example: 'round({{price}}, 2)',
    },
    { name: 'floor', description: 'Round down', signature: 'floor(number)', example: 'floor({{price}})' },
    { name: 'ceil', description: 'Round up', signature: 'ceil(number)', example: 'ceil({{price}})' },
    { name: 'abs', description: 'Absolute value', signature: 'abs(number)', example: 'abs({{difference}})' },
    {
      name: 'min',
      description: 'Minimum value',
      signature: 'min(...numbers)',
      example: 'min({{a}}, {{b}}, {{c}})',
    },
    {
      name: 'max',
      description: 'Maximum value',
      signature: 'max(...numbers)',
      example: 'max({{a}}, {{b}}, {{c}})',
    },
    {
      name: 'if',
      description: 'Conditional',
      signature: 'if(condition, then, else)',
      example: 'if({{isActive}}, "Yes", "No")',
    },
    {
      name: 'coalesce',
      description: 'First non-null value',
      signature: 'coalesce(...values)',
      example: 'coalesce({{nickname}}, {{firstName}})',
    },
  ]
}
