// apps/web/src/components/workflow/nodes/core/ai/structured-output-example.ts

/**
 * Example implementation for structured_output support in AI node
 * This file demonstrates how the feature would be implemented when added to AiConfig
 */

import type { OutputVariable } from '../../../types'

// Example of extended AiConfig with structured_output
interface AiConfigWithStructuredOutput {
  // ... existing AiConfig fields ...
  structured_output?: {
    enabled: boolean
    schema?: {
      type: 'object'
      properties: Record<string, any>
      required?: string[]
      additionalProperties?: boolean
    }
  }
}

// Example implementation of outputVariables with structured_output support
export const getAiOutputVariablesWithStructured = (
  config: AiConfigWithStructuredOutput
): OutputVariable[] => {
  const outputs: OutputVariable[] = []

  // Always output the text response
  outputs.push({
    name: 'text',
    type: 'string',
    description: 'The AI-generated response text',
    required: true,
  })

  // Add structured_output if enabled
  if (config.structured_output?.enabled && config.structured_output.schema) {
    outputs.push({
      name: 'structured_output',
      type: 'object',
      description: 'Structured output based on the defined schema',
      schema: config.structured_output.schema,
      required: true,
    })
  }

  return outputs
}

// Example of how the AI node would expose variables for the provided schema
const exampleSchema = {
  type: 'object',
  properties: {
    joke: {
      type: 'string',
      description: 'Text of the joke.',
    },
    joke_text: {
      type: 'string',
      description: 'lalala',
    },
    status: {
      type: 'string',
      description: 'Enum type',
      enum: ['good', 'bad'],
    },
    age: {
      type: 'number',
      description: 'the age of the person',
    },
    obj: {
      type: 'object',
      properties: {
        color: {
          type: 'string',
          description: 'color of lala',
        },
      },
      required: [],
      additionalProperties: false,
    },
    ids: {
      type: 'array',
      items: { type: 'string' },
      description: 'ids',
    },
  },
  required: ['joke_text'],
  additionalProperties: false,
}

// Example: Variables that would be exposed by an AI node with the above schema
// When useAvailableVariables processes this node, it would generate:
// - nodeId.text (string)
// - nodeId.structured_output (object)
// - nodeId.structured_output.joke (string)
// - nodeId.structured_output.joke_text (string)
// - nodeId.structured_output.status (string)
// - nodeId.structured_output.age (number)
// - nodeId.structured_output.obj (object)
// - nodeId.structured_output.obj.color (string)
// - nodeId.structured_output.ids (array)
// - nodeId.structured_output.ids[0] (string)
// - nodeId.structured_output.ids.length (number)
