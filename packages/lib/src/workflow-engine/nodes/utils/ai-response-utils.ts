// packages/lib/src/workflow-engine/nodes/utils/ai-response-utils.ts

import { createScopedLogger } from '@auxx/logger'

const logger = createScopedLogger('ai-response-utils')

/**
 * Classification result interface
 */
export interface ClassificationResult {
  category: string
  confidence: number
  reasoning: string
}

/**
 * Category definition interface
 */
export interface Category {
  id: string
  name: string
  description?: string
}

/**
 * Tool execution result interface
 */
export interface ToolExecutionResult {
  toolCallId: string
  toolName: string
  success: boolean
  output: Record<string, any>
  error?: string
  executionTime?: number
}

/**
 * Usage metrics interface
 */
export interface UsageMetrics {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  input_tokens?: number
  output_tokens?: number
}

/**
 * Parse structured output from AI response
 * Pure function - attempts to parse JSON from string
 *
 * @param content - The AI response content
 * @param schema - Optional schema for validation
 * @returns Parsed object or undefined if parsing fails
 */
export function parseStructuredOutput<T = Record<string, any>>(
  content: string,
  schema?: any
): T | undefined {
  try {
    const parsed = JSON.parse(content)

    // If schema provided, could add validation here
    // For now, just return the parsed object
    return parsed as T
  } catch (error) {
    logger.error('Failed to parse structured output', { content, error })
    return undefined
  }
}

/**
 * Parse classification result from AI response
 * Pure function - extracts classification data with fallback defaults
 *
 * @param content - The AI response content (expected JSON)
 * @param categories - Available categories for validation
 * @returns ClassificationResult with category, confidence, and reasoning
 */
export function parseClassificationResult(
  content: string,
  categories: Category[]
): ClassificationResult {
  try {
    const parsed = JSON.parse(content)

    // Validate the response structure
    if (!parsed.category || typeof parsed.confidence !== 'number' || !parsed.reasoning) {
      throw new Error('Invalid classification response format')
    }

    // Validate that the category exists
    const categoryExists = categories.some((cat) => cat.name === parsed.category)
    if (!categoryExists) {
      logger.warn('AI returned unknown category', { category: parsed.category })
      // Default to first category if invalid
      return {
        category: categories[0]?.name || 'unknown',
        confidence: 0.5,
        reasoning: 'Category not found, defaulting to first category',
      }
    }

    return {
      category: parsed.category,
      confidence: Math.max(0, Math.min(1, parsed.confidence)), // Clamp between 0-1
      reasoning: parsed.reasoning,
    }
  } catch (error) {
    logger.error('Failed to parse classification result', { content, error })
    // Return a default result
    return {
      category: categories[0]?.name || 'unknown',
      confidence: 0,
      reasoning: 'Failed to parse AI response',
    }
  }
}

/**
 * Find output handle for a classified category
 * Pure function - maps category to output handle ID
 *
 * @param categories - Available categories
 * @param classifiedCategory - The category returned by AI
 * @returns Output handle ID (category ID or 'unmatched')
 */
export function getOutputHandleForCategory(
  categories: Category[],
  classifiedCategory: string
): string {
  const matchedCategory = categories.find((cat) => cat.name === classifiedCategory)
  return matchedCategory ? matchedCategory.id : 'unmatched'
}

/**
 * Format tool execution results for output
 * Pure function - transforms tool results to simple format
 *
 * @param toolResults - Array of tool execution results
 * @returns Record mapping tool names to outputs
 */
export function formatToolResults(toolResults: ToolExecutionResult[]): Record<string, any> {
  const formatted: Record<string, any> = {}

  toolResults.forEach((result, index) => {
    // Store by index
    formatted[`tool_${index}`] = result.output
    // Store by name
    formatted[`tool_${result.toolName}`] = result.output
  })

  return formatted
}

/**
 * Format usage metrics to standardized format
 * Pure function - normalizes different provider formats
 *
 * @param usage - Usage metrics from AI provider
 * @returns Normalized usage metrics
 */
export function formatUsageMetrics(usage?: UsageMetrics): {
  promptTokens: number
  completionTokens: number
  totalTokens: number
} {
  if (!usage) {
    return {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
  }

  // Handle OpenAI format (prompt_tokens, completion_tokens, total_tokens)
  if (usage.prompt_tokens !== undefined) {
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens || 0,
      totalTokens: usage.total_tokens || 0,
    }
  }

  // Handle Anthropic format (input_tokens, output_tokens)
  if (usage.input_tokens !== undefined) {
    const inputTokens = usage.input_tokens
    const outputTokens = usage.output_tokens || 0
    return {
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    }
  }

  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
}

/**
 * Convert tool calls from orchestrator format to node output format
 * Pure function - transforms tool call structure
 *
 * @param toolCalls - Tool calls from orchestrator
 * @returns Tool calls in node output format
 */
export function formatToolCalls(
  toolCalls?: Array<{
    id: string
    function: { name: string; arguments: string | Record<string, any> }
  }>
): Array<{ id: string; name: string; arguments: Record<string, any> }> {
  if (!toolCalls || toolCalls.length === 0) {
    return []
  }

  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments:
      typeof tc.function.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function.arguments,
  }))
}

/**
 * Convert tool results from orchestrator format to node output format
 * Pure function - transforms tool result structure
 *
 * @param toolResults - Tool results from orchestrator
 * @returns Tool results in node output format
 */
export function formatToolResultsArray(
  toolResults?: Array<{
    toolCallId: string
    toolName: string
    success: boolean
    output: Record<string, any>
    error?: string
    executionTime?: number
  }>
): ToolExecutionResult[] {
  if (!toolResults || toolResults.length === 0) {
    return []
  }

  return toolResults.map((tr) => ({
    toolCallId: tr.toolCallId,
    toolName: tr.toolName,
    success: tr.success,
    output: tr.output,
    error: tr.error,
    executionTime: tr.executionTime,
  }))
}

/**
 * Extract text content from AI response
 * Pure function - handles different response formats
 *
 * @param response - The AI response
 * @returns Text content or empty string
 */
export function extractTextContent(response: any): string {
  if (typeof response === 'string') {
    return response
  }

  if (response?.content) {
    if (typeof response.content === 'string') {
      return response.content
    }
    if (Array.isArray(response.content) && response.content.length > 0) {
      // Handle Anthropic format
      const textBlock = response.content.find((block: any) => block.type === 'text')
      return textBlock?.text || ''
    }
  }

  return ''
}

/**
 * Validate classification response structure
 * Pure function - checks if response has required fields
 *
 * @param parsed - Parsed JSON response
 * @returns Boolean indicating if structure is valid
 */
export function isValidClassificationResponse(parsed: any): boolean {
  return (
    parsed &&
    typeof parsed === 'object' &&
    typeof parsed.category === 'string' &&
    typeof parsed.confidence === 'number' &&
    typeof parsed.reasoning === 'string'
  )
}

/**
 * Build classification prompt system message
 * Pure function - creates standard system prompt for classification
 *
 * @param customInstructions - Optional additional instructions
 * @returns System prompt text
 */
export function buildClassificationSystemPrompt(customInstructions?: string): string {
  let systemPrompt = `You are a text classification assistant. Your task is to classify the given text into one of the predefined categories based on their descriptions.

Analyze the text carefully and select the most appropriate category. Provide your response in the following JSON format:
{
  "category": "category_name",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of why this category was chosen"
}

Be precise and consider all aspects of the text when making your classification.`

  if (customInstructions) {
    systemPrompt += `\n\nAdditional Instructions: ${customInstructions}`
  }

  return systemPrompt
}

/**
 * Build classification prompt user message
 * Pure function - creates user prompt with categories and text
 *
 * @param categories - Available categories with descriptions
 * @param textToClassify - The text to classify
 * @returns User prompt text
 */
export function buildClassificationUserPrompt(
  categories: Category[],
  textToClassify: string
): string {
  let userContent = 'Categories:\n\n'

  for (const category of categories) {
    if (category.description) {
      userContent += `**${category.name}**: ${category.description}\n\n`
    } else {
      userContent += `**${category.name}**\n\n`
    }
  }

  userContent += `\nText to classify:\n${textToClassify}`

  return userContent
}
