// packages/workflow-nodes/src/services/url-template.service.ts

import type { URLTransform } from '../types/oauth2'

/**
 * Service for applying URL transformations to template URLs
 * Handles dynamic URL building with configurable transformations
 */
export class URLTemplateService {
  /**
   * Apply URL transformations to a template URL
   *
   * @param templateUrl - URL with placeholders (e.g., 'https://{shop}.myshopify.com/oauth')
   * @param credentialData - Data from credential form (e.g., { shopDomain: 'mystore.myshopify.com' })
   * @param transforms - Array of transformation configurations
   * @returns Transformed URL with placeholders replaced
   *
   * @example
   * ```typescript
   * const url = URLTemplateService.replaceTemplate(
   *   'https://{shop}.myshopify.com/oauth',
   *   { shopDomain: 'mystore.myshopify.com' },
   *   [{
   *     type: 'extract',
   *     source: 'shopDomain',
   *     target: '{shop}',
   *     transform: (domain) => domain.replace('.myshopify.com', '')
   *   }]
   * )
   * // Returns: 'https://mystore.myshopify.com/oauth'
   * ```
   */
  static replaceTemplate(
    templateUrl: string,
    credentialData: Record<string, any>,
    transforms: URLTransform[]
  ): string {
    if (!transforms || transforms.length === 0) {
      return templateUrl
    }

    let result = templateUrl

    for (const transform of transforms) {
      try {
        const sourceValue = credentialData[transform.source]

        if (sourceValue === undefined || sourceValue === null) {
          // Skip transform if source value is missing
          continue
        }

        const stringValue = String(sourceValue)
        const transformedValue = URLTemplateService.applyTransform(transform, stringValue)

        // Replace the target placeholder with the transformed value
        result = result.replace(transform.target, transformedValue)
      } catch (error) {
        // Log error but continue with other transforms
        console.warn(`URL transform failed for ${transform.source} -> ${transform.target}:`, error)
      }
    }

    return result
  }

  /**
   * Apply a single transformation to a value
   *
   * @param transform - Transformation configuration
   * @param value - Source value to transform
   * @returns Transformed value
   */
  private static applyTransform(transform: URLTransform, value: string): string {
    switch (transform.type) {
      case 'replace':
        // Direct replacement - no additional processing
        return transform.transform ? transform.transform(value) : value

      case 'extract':
        // Extract part of the value (e.g., domain from email, shop from full domain)
        return transform.transform ? transform.transform(value) : value

      case 'format':
        // Custom formatting using provided transform function
        if (!transform.transform) {
          throw new Error(`Format transform requires a transform function for ${transform.source}`)
        }
        return transform.transform(value)

      default:
        throw new Error(`Unknown transform type: ${(transform as any).type}`)
    }
  }

  /**
   * Validate URL transforms configuration
   * Checks for common configuration errors
   *
   * @param transforms - Array of transforms to validate
   * @returns Validation result with any errors found
   */
  static validateTransforms(transforms: URLTransform[]): {
    valid: boolean
    errors: string[]
  } {
    const errors: string[] = []

    for (const transform of transforms) {
      // Check required fields
      if (!transform.source) {
        errors.push('Transform missing required "source" field')
      }

      if (!transform.target) {
        errors.push('Transform missing required "target" field')
      }

      if (!transform.type) {
        errors.push('Transform missing required "type" field')
      }

      // Check valid transform types
      if (transform.type && !['replace', 'extract', 'format'].includes(transform.type)) {
        errors.push(`Invalid transform type: ${transform.type}`)
      }

      // Check format type has transform function
      if (transform.type === 'format' && !transform.transform) {
        errors.push('Format transform requires a transform function')
      }

      // Check target placeholder format
      if (
        (transform.target && !transform.target.startsWith('{')) ||
        !transform.target.endsWith('}')
      ) {
        errors.push(
          `Transform target should be a placeholder like {value}, got: ${transform.target}`
        )
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get all placeholders used in a URL template
   * Useful for validation and documentation
   *
   * @param templateUrl - URL template to analyze
   * @returns Array of placeholder strings found in the template
   *
   * @example
   * ```typescript
   * const placeholders = URLTemplateService.getPlaceholders('https://{shop}.{domain}/oauth')
   * // Returns: ['{shop}', '{domain}']
   * ```
   */
  static getPlaceholders(templateUrl: string): string[] {
    const placeholderRegex = /\{[^}]+\}/g
    return templateUrl.match(placeholderRegex) || []
  }

  /**
   * Check if a URL template has been fully resolved (no remaining placeholders)
   *
   * @param url - URL to check
   * @returns True if URL has no remaining placeholders
   */
  static isFullyResolved(url: string): boolean {
    return URLTemplateService.getPlaceholders(url).length === 0
  }
}

/**
 * Common URL transform utilities
 * Pre-built transform functions for common use cases
 */
export class URLTransformUtils {
  /**
   * Extract shop name from Shopify domain
   * 'mystore.myshopify.com' -> 'mystore'
   */
  static extractShopifyShopName = (domain: string): string => {
    return domain.replace('.myshopify.com', '')
  }

  /**
   * Extract domain from email address
   * 'user@company.com' -> 'company.com'
   */
  static extractEmailDomain = (email: string): string => {
    const parts = email.split('@')
    return parts.length > 1 ? parts[1]! : email
  }

  /**
   * Extract subdomain from full domain
   * 'api.example.com' -> 'api'
   */
  static extractSubdomain = (domain: string): string => {
    const parts = domain.split('.')
    return parts.length > 2 ? parts[0]! : domain
  }

  /**
   * Convert to lowercase
   */
  static toLowerCase = (value: string): string => {
    return value.toLowerCase()
  }

  /**
   * Remove protocol from URL
   * 'https://example.com' -> 'example.com'
   */
  static removeProtocol = (url: string): string => {
    return url.replace(/^https?:\/\//, '')
  }
}
