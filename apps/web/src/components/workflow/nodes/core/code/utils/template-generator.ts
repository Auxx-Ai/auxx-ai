// apps/web/src/components/workflow/nodes/core/code/utils/template-generator.ts

import type { CodeNodeInput, CodeNodeOutput } from '../types'

/**
 * Generates a dynamic code template based on input and output variables
 * @param inputs - Array of input variables
 * @param outputs - Array of output variables
 * @returns Generated code template
 */
export const generateCodeTemplate = (
  inputs: CodeNodeInput[],
  outputs: CodeNodeOutput[]
): string => {
  // Generate function parameters from inputs
  const inputParams = inputs.map((i) => i.name).join(', ')

  // Generate output object structure
  const outputObject: Record<string, string> = {}
  if (outputs.length > 0) {
    outputs.forEach((output) => {
      outputObject[output.name] = 'undefined'
    })
  } else {
    outputObject.output1 = 'undefined'
  }

  // Convert output object to formatted string
  const outputStr = JSON.stringify(outputObject, null, 4)
    .replace(/"/g, '')
    .replace(/^/gm, '    ') // Add 4 spaces indent
    .trim()

  return `const main = async (${inputParams}) => {
  return ${outputStr}
}`
}

/**
 * Finds the main function in the code and extracts its content
 * @param code - Code string to analyze
 * @returns Object with main function info or null if not found
 */
const findMainFunction = (
  code: string
): {
  start: number
  end: number
  bodyStart: number
  bodyEnd: number
  returnStart?: number
  returnEnd?: number
  paramsStart?: number
  paramsEnd?: number
} | null => {
  // Look for main function definition patterns (now accepting parameters)
  const patterns = [
    /const\s+main\s*=\s*async\s*\(([^)]*)\)\s*=>\s*\{/g,
    /const\s+main\s*=\s*\(([^)]*)\)\s*=>\s*\{/g,
    /function\s+main\s*\(([^)]*)\)\s*\{/g,
    /async\s+function\s+main\s*\(([^)]*)\)\s*\{/g,
  ]

  for (const pattern of patterns) {
    const match = pattern.exec(code)
    if (match) {
      const start = match.index
      const bodyStart = match.index + match[0].length

      // Extract parameter positions
      const paramsMatch = /\(([^)]*)\)/.exec(match[0])
      let paramsInfo
      if (paramsMatch) {
        const paramsStart = match.index + match[0].indexOf('(') + 1
        const paramsEnd = paramsStart + paramsMatch[1].length
        paramsInfo = { paramsStart, paramsEnd }
      }

      // Find the matching closing brace
      let braceCount = 1
      let i = bodyStart
      while (i < code.length && braceCount > 0) {
        if (code[i] === '{') braceCount++
        if (code[i] === '}') braceCount--
        i++
      }

      if (braceCount === 0) {
        const end = i
        const bodyEnd = i - 1

        // Find the last return statement in the function body
        const functionBody = code.substring(bodyStart, bodyEnd)
        const returnMatch = /return\s*\{[^}]*\}(?:\s*;?)$/m.exec(functionBody.trim())

        let returnInfo
        if (returnMatch) {
          const returnStart = bodyStart + functionBody.lastIndexOf(returnMatch[0])
          const returnEnd = returnStart + returnMatch[0].length
          returnInfo = { returnStart, returnEnd }
        }

        return { start, end, bodyStart, bodyEnd, ...returnInfo, ...paramsInfo }
      }
    }
  }

  return null
}

/**
 * Parses the existing return statement to extract variable mappings
 * @param returnStatement - The return statement string
 * @returns Object mapping output names to their current values
 */
const parseExistingReturnStatement = (returnStatement: string): Record<string, string> => {
  const mappings: Record<string, string> = {}

  // Remove 'return' keyword and trim
  const objectStr = returnStatement.replace(/^\s*return\s*/, '').trim()

  // Simple regex to extract key-value pairs from object literal
  // Handles: {key1: value1, key2: value2}
  const keyValueRegex = /(\w+)\s*:\s*([^,}]+)/g
  let match

  while ((match = keyValueRegex.exec(objectStr)) !== null) {
    const key = match[1].trim()
    const value = match[2].trim()
    mappings[key] = value
  }

  return mappings
}

/**
 * Updates both the function signature and return statement in the main function
 * @param code - Current code
 * @param inputs - Input variables
 * @param outputs - Output variables
 * @returns Updated code with new function signature and return statement
 */
const updateMainFunctionStatements = (
  code: string,
  inputs: CodeNodeInput[],
  outputs: CodeNodeOutput[]
): string => {
  const mainFunc = findMainFunction(code)
  if (!mainFunc || !mainFunc.returnStart || !mainFunc.returnEnd) {
    return code // Can't find return statement, leave code unchanged
  }

  let updatedCode = code

  // Update function parameters if paramsStart and paramsEnd are available
  if (mainFunc.paramsStart !== undefined && mainFunc.paramsEnd !== undefined) {
    const newParams = inputs.map((i) => i.name).join(', ')
    updatedCode =
      updatedCode.substring(0, mainFunc.paramsStart) +
      newParams +
      updatedCode.substring(mainFunc.paramsEnd)

    // Adjust return statement positions after parameter update
    const paramLengthDiff = newParams.length - (mainFunc.paramsEnd - mainFunc.paramsStart)
    mainFunc.returnStart += paramLengthDiff
    mainFunc.returnEnd += paramLengthDiff
  }

  // Parse existing return statement to preserve variable mappings
  const existingReturnStatement = updatedCode.substring(mainFunc.returnStart, mainFunc.returnEnd)
  const existingMappings = parseExistingReturnStatement(existingReturnStatement)

  // Get the current output names from existing mappings
  const existingOutputNames = Object.keys(existingMappings)

  // Generate new return object, preserving variable assignments where possible
  const outputObject: Record<string, string> = {}
  if (outputs.length > 0) {
    outputs.forEach((output, index) => {
      // Try to map the new output name to an existing output by position
      if (index < existingOutputNames.length) {
        const existingOutputName = existingOutputNames[index]
        const existingValue = existingMappings[existingOutputName]
        outputObject[output.name] = existingValue || 'undefined'
      } else {
        outputObject[output.name] = 'undefined'
      }
    })
  } else {
    outputObject.output1 = 'undefined'
  }

  // Format the return statement
  const outputStr = JSON.stringify(outputObject, null, 2)
    .replace(/"/g, '')
    .replace(/^/gm, '    ') // Add 4 spaces indent
    .trim()

  const newReturn = `return ${outputStr}`

  // Replace the return statement
  return (
    updatedCode.substring(0, mainFunc.returnStart) +
    newReturn +
    updatedCode.substring(mainFunc.returnEnd)
  )
}

/**
 * Checks if the current code has a main function
 * @param code - Current code string
 * @returns Boolean indicating if main function exists
 */
export const hasMainFunction = (code: string): boolean => {
  return findMainFunction(code) !== null
}

/**
 * Checks if the current code looks like a basic/default template
 * @param code - Current code string
 * @returns Boolean indicating if it's a basic template
 */
export const isBasicTemplate = (code: string): boolean => {
  const trimmedCode = code.trim()

  // Check if it matches the basic template structure (now with parameters)
  const hasMainFunction = /const\s+main\s*=\s*async\s*\([^)]*\)\s*=>\s*\{/.test(trimmedCode)
  const hasSimpleReturn = /return\s*\{\s*\w+:\s*undefined\s*\}/.test(trimmedCode)

  // Should be relatively short and not have complex logic
  const lineCount = trimmedCode.split('\n').length
  const hasComplexLogic =
    /(?:if|for|while|switch|try|catch|console\.log|fetch|await(?!\s+main))/.test(trimmedCode)

  // No longer checking for input comments since we removed them
  return hasMainFunction && hasSimpleReturn && lineCount < 10 && !hasComplexLogic
}

/**
 * Intelligently updates the main function to reflect new inputs and outputs
 * Updates both function signature and return statement, preserves all user logic and comments
 * @param currentCode - Current code in editor
 * @param inputs - New input variables
 * @param outputs - New output variables
 * @returns Updated code with smart modifications
 */
export const smartUpdateTemplate = (
  currentCode: string,
  inputs: CodeNodeInput[],
  outputs: CodeNodeOutput[]
): string => {
  // If no main function, generate complete template
  if (!hasMainFunction(currentCode)) {
    return generateCodeTemplate(inputs, outputs)
  }

  // If it's a basic template, replace entirely
  if (isBasicTemplate(currentCode)) {
    return generateCodeTemplate(inputs, outputs)
  }

  // For custom code with main function, update both function signature and return statement
  return updateMainFunctionStatements(currentCode, inputs, outputs)
}
