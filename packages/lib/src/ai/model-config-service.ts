// packages/lib/src/ai/model-config-service.ts

import type { ModelCapabilities } from './providers/types'

/**
 * Utility service for filtering parameters based on ModelCapabilities
 * This is a pure utility - no state, no registry, just functions
 */
export class ModelConfigService {
  private static readonly GPT5_CONDITIONAL_SAMPLING_PARAMS = [
    'temperature',
    'top_p',
    'logprobs',
    'top_logprobs',
  ]

  private static readonly GPT5_1_5_2_PATTERN = /^gpt-5\.(1|2)(?:$|-)/

  /**
   * Filter parameters based on model's parameterRestrictions
   * @param capabilities The model capabilities (provider already has this)
   * @param parameters The user-provided parameters
   * @param options Additional filtering options
   * @returns Filtered parameters safe for the model
   */
  static filterParameters(
    capabilities: ModelCapabilities | undefined,
    parameters: Record<string, any>,
    options?: {
      enforceRuleAllowlist?: boolean
    }
  ): Record<string, any> {
    if (!parameters) {
      return {}
    }

    // If no capabilities, return as-is (caller can choose fail-closed behavior)
    if (!capabilities) {
      return parameters || {}
    }

    let filtered = { ...parameters }
    const restrictions = capabilities.parameterRestrictions

    if (restrictions) {
      // 1. Apply parameter mapping (e.g., max_tokens -> max_completion_tokens)
      if (restrictions.parameterMapping) {
        for (const [oldParam, newParam] of Object.entries(restrictions.parameterMapping)) {
          if (filtered[oldParam] !== undefined) {
            filtered[newParam] = filtered[oldParam]
            delete filtered[oldParam]
          }
        }
      }

      // 2. Remove unsupported parameters
      if (restrictions.unsupportedParams) {
        for (const param of restrictions.unsupportedParams) {
          delete filtered[param]
        }
      }

      // 3. Force default-only parameters to their default values
      if (restrictions.defaultOnlyParams) {
        for (const [param, defaultValue] of Object.entries(restrictions.defaultOnlyParams)) {
          if (filtered[param] !== undefined && filtered[param] !== defaultValue) {
            // Remove the parameter if it's not the default value
            // The API will use its default
            delete filtered[param]
          }
        }
      }

      // 4. If supportedParams is defined, keep only those
      if (restrictions.supportedParams) {
        const supportedOnly: Record<string, any> = {}
        for (const param of restrictions.supportedParams) {
          if (filtered[param] !== undefined) {
            supportedOnly[param] = filtered[param]
          }
        }
        // Also keep any mapped parameters
        Object.keys(filtered).forEach((key) => {
          // If this key was created by mapping, keep it
          if (Object.values(restrictions.parameterMapping || {}).includes(key)) {
            supportedOnly[key] = filtered[key]
          }
        })
        filtered = supportedOnly
      }
    }

    // 5. GPT-5.1 / GPT-5.2 conditional compatibility logic.
    // temperature/top_p/logprobs are only supported for effort=none.
    if (ModelConfigService.requiresConditionalGpt5Compatibility(capabilities.modelId)) {
      const reasoningEffort = String(filtered.reasoning_effort || '').toLowerCase()
      const usesNoneReasoning = reasoningEffort === 'none'

      if (!usesNoneReasoning) {
        for (const param of ModelConfigService.GPT5_CONDITIONAL_SAMPLING_PARAMS) {
          delete filtered[param]
        }
      }

      // top_logprobs requires logprobs
      if (filtered.logprobs === undefined) {
        delete filtered.top_logprobs
      }
    }

    // 6. Enforce allowlist from parameter rules if requested.
    if (options?.enforceRuleAllowlist && capabilities.parameterRules) {
      const allowedParams = new Set(capabilities.parameterRules.map((rule) => rule.name))

      if (restrictions?.parameterMapping) {
        for (const mappedParam of Object.values(restrictions.parameterMapping)) {
          allowedParams.add(mappedParam)
        }
      }

      for (const key of Object.keys(filtered)) {
        if (!allowedParams.has(key)) {
          delete filtered[key]
        }
      }
    }

    // 7. Validate parameters with options
    if (capabilities.parameterRules) {
      for (const rule of capabilities.parameterRules) {
        // If parameter has options and a value is provided, validate it
        if (rule.options && filtered[rule.name] !== undefined) {
          const value = filtered[rule.name]
          if (!rule.options.includes(value)) {
            // If invalid value, use the default or first option
            filtered[rule.name] = rule.default || rule.options[0]
            console.warn(
              `Invalid value "${value}" for parameter "${rule.name}". Using "${filtered[rule.name]}" instead.`
            )
          }
        }
      }
    }

    return filtered
  }

  private static requiresConditionalGpt5Compatibility(modelId: string): boolean {
    return ModelConfigService.GPT5_1_5_2_PATTERN.test(modelId) || modelId === 'gpt-5.2-chat-latest'
  }

  /**
   * Apply default values for parameters that weren't provided
   * @param capabilities The model capabilities
   * @param parameters The user-provided parameters
   * @returns Parameters with defaults applied
   */
  static applyDefaults(
    capabilities: ModelCapabilities | undefined,
    parameters: Record<string, any>
  ): Record<string, any> {
    if (!capabilities?.parameterRules) {
      return parameters
    }

    const withDefaults = { ...parameters }

    // Apply defaults from parameter rules
    for (const rule of capabilities.parameterRules) {
      if (withDefaults[rule.name] === undefined && rule.default !== undefined) {
        withDefaults[rule.name] = rule.default
      }
    }

    return withDefaults
  }

  /**
   * Check if a model is a reasoning model
   */
  static isReasoningModel(capabilities: ModelCapabilities | undefined): boolean {
    return capabilities?.parameterRestrictions?.isReasoningModel === true
  }

  /**
   * Validate and sanitize parameters based on parameter rules
   * This ensures all parameters conform to their defined constraints
   * @param capabilities The model capabilities with parameter rules
   * @param parameters The user-provided parameters
   * @returns Validated and sanitized parameters
   */
  static validateParameters(
    capabilities: ModelCapabilities | undefined,
    parameters: Record<string, any>
  ): Record<string, any> {
    if (!capabilities?.parameterRules || !parameters) {
      return parameters || {}
    }

    const validated = { ...parameters }

    for (const rule of capabilities.parameterRules) {
      const value = validated[rule.name]

      // Skip if parameter not provided
      if (value === undefined) continue

      // Validate based on type
      switch (rule.type) {
        case 'int':
        case 'float': {
          const numValue = Number(value)

          // Ensure it's a valid number
          if (Number.isNaN(numValue)) {
            validated[rule.name] = rule.default || (rule.min ?? 0)
            console.warn(
              `Invalid number for "${rule.name}". Using default: ${validated[rule.name]}`
            )
            break
          }

          // Apply min/max constraints
          if (rule.min !== undefined && numValue < rule.min) {
            validated[rule.name] = rule.min
            console.warn(`Value ${numValue} for "${rule.name}" below minimum ${rule.min}`)
          } else if (rule.max !== undefined && numValue > rule.max) {
            validated[rule.name] = rule.max
            console.warn(`Value ${numValue} for "${rule.name}" above maximum ${rule.max}`)
          } else {
            validated[rule.name] = rule.type === 'int' ? Math.floor(numValue) : numValue
          }
          break
        }

        case 'string': {
          // Validate against options if present
          if (rule.options && !rule.options.includes(value)) {
            validated[rule.name] = rule.default || rule.options[0]
            console.warn(
              `Invalid option "${value}" for "${rule.name}". Using: ${validated[rule.name]}`
            )
          }
          break
        }

        case 'boolean': {
          // Ensure it's a boolean
          validated[rule.name] = Boolean(value)
          break
        }

        case 'tag': {
          // Ensure it's an array of strings
          if (!Array.isArray(value)) {
            validated[rule.name] = rule.default || []
            console.warn(`Invalid tag array for "${rule.name}". Using default.`)
          } else {
            validated[rule.name] = value.filter((v) => typeof v === 'string')
          }
          break
        }
      }
    }

    return validated
  }
}
