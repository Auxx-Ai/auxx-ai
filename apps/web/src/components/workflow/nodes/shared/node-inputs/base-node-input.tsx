// apps/web/src/components/workflow/nodes/shared/node-inputs/base-node-input.tsx

import React from 'react'
import { Alert, AlertDescription } from '@auxx/ui/components/alert'
import { AlertCircle } from 'lucide-react'

/**
 * Props interface for node input components
 */
export interface NodeInputProps {
  /** Current input values */
  inputs: Record<string, any>
  /** Current validation errors */
  errors: Record<string, string>
  /** Handler for input changes */
  onChange: (name: string, value: any) => void
  /** Handler for validation errors - set error message or null to clear */
  onError: (name: string, error: string | null) => void
  /** Loading state */
  isLoading?: boolean
  /** Optional: For hierarchical inputs, the path prefix */
  pathPrefix?: string
  /** Optional: Schema name for the input */
  schemaName?: string
}

/**
 * Base component for node inputs with common functionality
 */
export abstract class BaseNodeInput extends React.Component<NodeInputProps> {
  /**
   * Render error messages if any
   */
  protected renderErrors(): React.ReactNode {
    const { errors } = this.props
    const errorMessages = Object.values(errors).filter(Boolean)

    if (errorMessages.length === 0) {
      return null
    }

    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertDescription>
          {errorMessages.length === 1 ? (
            errorMessages[0]
          ) : (
            <ul className="list-disc list-inside">
              {errorMessages.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  /**
   * Handle input change with error clearing
   */
  protected handleChange = (name: string, value: any): void => {
    const { onChange, pathPrefix } = this.props
    const fullPath = pathPrefix ? `${pathPrefix}.${name}` : name
    onChange(fullPath, value)
  }

  /**
   * Get the value for a specific field
   */
  protected getValue = (name: string): any => {
    const { inputs, pathPrefix } = this.props
    const fullPath = pathPrefix ? `${pathPrefix}.${name}` : name
    return this.getNestedValue(inputs, fullPath)
  }

  /**
   * Get nested value from object using dot notation
   */
  private getNestedValue = (obj: any, path: string): any => {
    return path.split('.').reduce((current, key) => current?.[key], obj)
  }
}

/**
 * Helper function to create a functional node input component
 */
export function createNodeInput<T extends NodeInputProps>(
  render: (props: T) => React.ReactNode
): React.FC<T> {
  return function NodeInput(props: T) {
    return <>{render(props)}</>
  }
}
