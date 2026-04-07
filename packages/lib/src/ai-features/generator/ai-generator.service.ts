// packages/lib/src/ai-features/generator/ai-generator.service.ts

import type { Database } from '@auxx/database'
import type { Message } from '../../ai/clients/base/types'
import { LLMOrchestrator } from '../../ai/orchestrator/llm-orchestrator'
import type { LLMInvocationRequest } from '../../ai/orchestrator/types'
import { UsageTrackingService } from '../../ai/usage/usage-tracking-service'
import { createScopedLogger } from '../../logger'
import type {
  AIGeneratorRequest,
  AIGeneratorResponse,
  CodeGeneratorInput,
  CodeGeneratorOutput,
  GenerationType,
} from './types'

const logger = createScopedLogger('ai-generator-service')

/**
 * Prompt template for generating workflow prompt templates
 */
const PROMPT_GENERATE_TEMPLATE = `
Here is a task description for which I would like you to create a high-quality prompt template for:
<task_description>
{{TASK_DESCRIPTION}}
</task_description>

{{CURRENT_CONTENT_SECTION}}

{{IDEAL_OUTPUT_SECTION}}

Based on task description, please create a well-structured prompt template that another AI could use to consistently complete the task. The prompt template should include:
- Do not include <input> or <output> section and variables in the prompt, assume user will add them at their own will.
- Clear instructions for the AI that will be using this prompt, demarcated with <instruction> tags. The instructions should provide step-by-step directions on how to complete the task using the input variables. Also Specifies in the instructions that the output should not contain any xml tag.
- Relevant examples if needed to clarify the task further, demarcated with <example> tags. Do not include variables in the prompt. Give three pairs of input and output examples.
- Include other relevant sections demarcated with appropriate XML tags like <examples>, <instruction>.
- Use the same language as task description.
- Output in \`\`\` xml \`\`\` and start with <instruction>
Please generate the full prompt template with at least 300 words and output only the prompt template.
`

/**
 * Prompt template for generating code
 * Includes structured placeholders for function signature and input/output variables
 */
const CODE_GENERATE_TEMPLATE = `
You are an expert programmer. Generate {{LANGUAGE}} code based on the following task description.

<task_description>
{{TASK_DESCRIPTION}}
</task_description>

{{CURRENT_CONTENT_SECTION}}

{{IDEAL_OUTPUT_SECTION}}

<function_signature>
You MUST generate code that follows this exact structure:

\`\`\`javascript
const main = async ({{INPUT_PARAMS}}) => {
  // Your implementation here

  return {
{{OUTPUT_RETURN_STRUCTURE}}
  }
}
\`\`\`
</function_signature>

{{INPUT_VARIABLES_SECTION}}

{{OUTPUT_VARIABLES_SECTION}}

Requirements:
- The function MUST be named \`main\` and be an async arrow function
- The function parameters MUST match exactly: {{INPUT_PARAMS_LIST}}
- The return object MUST include these keys with appropriate values: {{OUTPUT_KEYS_LIST}}
- Write clean, readable code with comments where helpful
- Include proper error handling where appropriate
- Do not include any explanations outside the code
- Output only the code, without markdown code block wrappers
- Do not modify the function signature or return object structure

Generate the {{LANGUAGE}} code now.
`

/**
 * Configuration for AI Generator Service
 */
interface AIGeneratorConfig {
  defaultModel?: string
  defaultProvider?: string
}

/**
 * AI Generator Service for creating prompt templates and code
 * Uses LLM to generate well-structured content from task descriptions
 */
export class AIGeneratorService {
  private llmOrchestrator: LLMOrchestrator
  private usageService: UsageTrackingService
  private config: Required<AIGeneratorConfig>

  constructor(
    private db: Database,
    config?: Partial<AIGeneratorConfig>
  ) {
    this.config = {
      defaultModel: 'gpt-5.4-nano',
      defaultProvider: 'openai',
      ...config,
    }

    this.usageService = new UsageTrackingService(db)
    this.llmOrchestrator = new LLMOrchestrator(
      this.usageService,
      db,
      {
        enableUsageTracking: true,
        defaultProvider: this.config.defaultProvider,
        defaultModel: this.config.defaultModel,
      },
      logger
    )
  }

  /**
   * Generate content (prompt or code) from task description
   */
  async generateContent(
    request: AIGeneratorRequest,
    organizationId: string,
    userId: string
  ): Promise<AIGeneratorResponse> {
    const startTime = Date.now()

    try {
      logger.info('Processing content generation request', {
        organizationId,
        userId,
        generationType: request.generationType,
        language: request.language,
        hasCurrentContent: !!request.currentContent,
      })

      // Build messages for LLM
      const messages = this.buildMessages(request)

      // Parse model ID if provided (format: "provider:model")
      let provider = this.config.defaultProvider
      let model = this.config.defaultModel

      if (request.modelId) {
        const [parsedProvider, parsedModel] = request.modelId.split(':')
        if (parsedProvider && parsedModel) {
          provider = parsedProvider
          model = parsedModel
        }
      }

      // Create LLM invocation request
      const invocationRequest: LLMInvocationRequest = {
        model,
        provider,
        messages,
        parameters: {
          max_tokens: request.generationType === 'code' ? 1500 : 2000,
          temperature: request.generationType === 'code' ? 0.3 : 0.7,
        },
        organizationId,
        userId,
        context: {
          source: 'content-generator',
          operation: 'generate',
          generationType: request.generationType,
        },
      }

      // Invoke LLM
      const response = await this.llmOrchestrator.invoke(invocationRequest)

      // Extract the content from the response
      const content = this.extractContent(response.content, request.generationType)

      const processingTime = Date.now() - startTime

      logger.info('Content generation completed', {
        generationType: request.generationType,
        processingTime,
        tokensUsed: response.usage?.total_tokens,
      })

      return {
        content,
        metadata: {
          tokensUsed: response.usage?.total_tokens,
          model: response.model,
          processingTime,
        },
      }
    } catch (error) {
      logger.error('Content generation failed', {
        generationType: request.generationType,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Build input variables documentation section
   */
  private buildInputVariablesSection(inputs?: CodeGeneratorInput[]): string {
    if (!inputs || inputs.length === 0) {
      return ''
    }

    const inputDocs = inputs
      .map((input) => `  - \`${input.name}\`: ${input.description || 'Input variable'}`)
      .join('\n')

    return `<input_variables>
The following input variables are available as function parameters:
${inputDocs}
</input_variables>`
  }

  /**
   * Build output variables documentation section
   */
  private buildOutputVariablesSection(outputs?: CodeGeneratorOutput[]): string {
    if (!outputs || outputs.length === 0) {
      return ''
    }

    const outputDocs = outputs
      .map(
        (output) =>
          `  - \`${output.name}\` (${output.type}): ${output.description || 'Output value'}`
      )
      .join('\n')

    return `<output_variables>
The return object must include these output variables:
${outputDocs}
</output_variables>`
  }

  /**
   * Build input parameters string for function signature
   */
  private buildInputParams(inputs?: CodeGeneratorInput[]): string {
    if (!inputs || inputs.length === 0) {
      return ''
    }
    return inputs.map((i) => i.name).join(', ')
  }

  /**
   * Build output return structure for function body
   */
  private buildOutputReturnStructure(outputs?: CodeGeneratorOutput[]): string {
    if (!outputs || outputs.length === 0) {
      return '    output1: undefined'
    }
    return outputs.map((o) => `    ${o.name}: undefined`).join(',\n')
  }

  /**
   * Build messages array for LLM based on generation type
   */
  private buildMessages(request: AIGeneratorRequest): Message[] {
    const isCodeGeneration = request.generationType === 'code'
    const contentType = isCodeGeneration ? 'code' : 'prompt'

    // Build the current content section if provided
    const currentContentSection = request.currentContent
      ? `Here is the current ${contentType} that the user wants to modify or improve:
<current_content>
${request.currentContent}
</current_content>`
      : ''

    // Build the ideal output section if provided
    const idealOutputSection = request.idealOutput
      ? `Here is an example of the ideal output:
<ideal_output>
${request.idealOutput}
</ideal_output>`
      : ''

    // Select and populate template based on generation type
    const template = isCodeGeneration ? CODE_GENERATE_TEMPLATE : PROMPT_GENERATE_TEMPLATE

    // For code generation, build the input/output sections
    let userPrompt: string
    if (isCodeGeneration) {
      const inputParams = this.buildInputParams(request.codeInputs)
      const outputReturnStructure = this.buildOutputReturnStructure(request.codeOutputs)
      const inputVariablesSection = this.buildInputVariablesSection(request.codeInputs)
      const outputVariablesSection = this.buildOutputVariablesSection(request.codeOutputs)

      // Build human-readable lists for requirements
      const inputParamsList =
        request.codeInputs && request.codeInputs.length > 0
          ? request.codeInputs.map((i) => `\`${i.name}\``).join(', ')
          : '(no parameters)'
      const outputKeysList =
        request.codeOutputs && request.codeOutputs.length > 0
          ? request.codeOutputs.map((o) => `\`${o.name}\``).join(', ')
          : '`output1`'

      userPrompt = template
        .replace('{{TASK_DESCRIPTION}}', request.instruction)
        .replace('{{CURRENT_CONTENT_SECTION}}', currentContentSection)
        .replace('{{IDEAL_OUTPUT_SECTION}}', idealOutputSection)
        .replace(/{{LANGUAGE}}/g, request.language || 'javascript')
        .replace('{{INPUT_PARAMS}}', inputParams)
        .replace('{{OUTPUT_RETURN_STRUCTURE}}', outputReturnStructure)
        .replace('{{INPUT_VARIABLES_SECTION}}', inputVariablesSection)
        .replace('{{OUTPUT_VARIABLES_SECTION}}', outputVariablesSection)
        .replace('{{INPUT_PARAMS_LIST}}', inputParamsList)
        .replace('{{OUTPUT_KEYS_LIST}}', outputKeysList)
    } else {
      userPrompt = template
        .replace('{{TASK_DESCRIPTION}}', request.instruction)
        .replace('{{CURRENT_CONTENT_SECTION}}', currentContentSection)
        .replace('{{IDEAL_OUTPUT_SECTION}}', idealOutputSection)
        .replace(/{{LANGUAGE}}/g, request.language || 'javascript')
    }

    // Build system message based on type
    const systemMessage = isCodeGeneration
      ? `You are an expert programmer specializing in ${request.language || 'javascript'}. Generate clean, efficient, and well-documented code based on the user's requirements. Follow best practices and include proper error handling. You must follow the exact function signature and return object structure specified.`
      : `You are an expert prompt engineer. Your task is to create high-quality, well-structured prompt templates that other AI models can use to consistently complete tasks. Follow the user's instructions carefully and generate prompts that are clear, specific, and include relevant examples.`

    return [
      {
        role: 'system',
        content: systemMessage,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ]
  }

  /**
   * Extract content from LLM response based on generation type
   */
  private extractContent(content: string, generationType: GenerationType): string {
    let cleaned = content.trim()

    if (generationType === 'prompt') {
      // Handle ```xml ... ``` format for prompts
      const xmlBlockMatch = cleaned.match(/```xml\s*([\s\S]*?)\s*```/)
      if (xmlBlockMatch) {
        cleaned = xmlBlockMatch[1].trim()
      }

      // Handle plain ``` ... ``` format
      const plainBlockMatch = cleaned.match(/```\s*([\s\S]*?)\s*```/)
      if (plainBlockMatch && !xmlBlockMatch) {
        cleaned = plainBlockMatch[1].trim()
      }
    } else {
      // Handle code blocks for code generation
      // Remove ```javascript, ```json, or plain ``` wrappers
      const codeBlockMatch = cleaned.match(/```(?:javascript|json|js)?\s*([\s\S]*?)\s*```/)
      if (codeBlockMatch) {
        cleaned = codeBlockMatch[1].trim()
      }
    }

    return cleaned
  }
}

// Singleton instance
let serviceInstance: AIGeneratorService | null = null

/**
 * Get or create AI Generator Service instance
 */
export function getAIGeneratorService(
  db: Database,
  config?: Partial<AIGeneratorConfig>
): AIGeneratorService {
  if (!serviceInstance) {
    serviceInstance = new AIGeneratorService(db, config)
  }
  return serviceInstance
}
