// packages/sdk/src/client/workflow/hooks/use-workflow.ts

'use client'

import { createElement, type ReactElement, useCallback, useEffect, useMemo, useRef } from 'react'
import type { InferWorkflowInput, WorkflowSchema } from '../../../root/workflow/types.js'
import { BooleanInput, type BooleanInputProps } from '../components/inputs/boolean-input.js'
import { NumberInput, type NumberInputProps } from '../components/inputs/number-input.js'
import { SelectInput, type SelectInputProps } from '../components/inputs/select-input.js'
// Import JSX components (these create custom elements)
import { StringInput, type StringInputProps } from '../components/inputs/string-input.js'
import { InputGroup, type InputGroupProps } from '../components/layout/input-group.js'
import { Section, type SectionProps } from '../components/layout/section.js'
import {
  ConditionalRenderInternal,
  type ConditionalRenderProps,
} from '../components/utility/conditional-render.js'
import type { PathToField } from '../types/path-helpers.js'
import { useWorkflowContext } from './use-workflow-context.js'

/**
 * Helper to get nested value from object using dot notation
 */
function get(obj: any, path: string): any {
  const keys = path.split('.')
  let result = obj
  for (const key of keys) {
    result = result?.[key]
  }
  return result
}

/**
 * Helper to set nested value in object using dot notation
 */
function set(obj: any, path: string, value: any): any {
  const keys = path.split('.')
  const lastKey = keys.pop()!
  let current = obj

  // Navigate to the parent object
  for (const key of keys) {
    if (!(key in current)) {
      current[key] = {}
    }
    current = current[key]
  }

  // Set the value
  current[lastKey] = value
  return { ...obj }
}

/**
 * Props for workflow string input component.
 * Uses Omit to reuse base StringInputProps and adds type-safe name field.
 */
export interface WorkflowStringInputProps<TSchema extends WorkflowSchema>
  extends Omit<StringInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to string field in schema */
  name: PathToField<TSchema['inputs'], 'string'>
}

/**
 * Props for workflow number input component.
 * Uses Omit to reuse base NumberInputProps and adds type-safe name field.
 */
export interface WorkflowNumberInputProps<TSchema extends WorkflowSchema>
  extends Omit<NumberInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to number field in schema */
  name: PathToField<TSchema['inputs'], 'number'>
}

/**
 * Props for workflow boolean input component.
 * Uses Omit to reuse base BooleanInputProps and adds type-safe name field.
 */
export interface WorkflowBooleanInputProps<TSchema extends WorkflowSchema>
  extends Omit<BooleanInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to boolean field in schema */
  name: PathToField<TSchema['inputs'], 'boolean'>
}

/**
 * Props for workflow select input component.
 * Uses Omit to reuse base SelectInputProps and adds type-safe name field.
 */
export interface WorkflowSelectInputProps<TSchema extends WorkflowSchema>
  extends Omit<SelectInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to select field in schema */
  name: PathToField<TSchema['inputs'], 'select'>
}

/**
 * Props for conditional render component.
 * Omits data since it's provided automatically by useWorkflow.
 */
export interface WorkflowConditionalRenderProps<TSchema extends WorkflowSchema>
  extends Omit<ConditionalRenderProps, 'data'> {
  /** Condition function with typed data */
  when: (data: InferWorkflowInput<TSchema>) => boolean
}

/**
 * API returned by useWorkflow hook.
 *
 * Provides pre-bound components that automatically connect to WorkflowContext
 * and apply schema metadata.
 */
export interface UseWorkflowApi<TSchema extends WorkflowSchema> {
  /**
   * String input field with automatic data binding.
   *
   * Automatically gets/sets value from WorkflowContext and applies
   * label, description, and placeholder from schema metadata.
   */
  StringInput: (props: WorkflowStringInputProps<TSchema>) => ReactElement

  /**
   * Number input field with automatic data binding.
   *
   * Automatically gets/sets value from WorkflowContext and applies
   * label, description, placeholder, min, max, step from schema metadata.
   */
  NumberInput: (props: WorkflowNumberInputProps<TSchema>) => ReactElement

  /**
   * Boolean input field (checkbox/switch) with automatic data binding.
   *
   * Automatically gets/sets value from WorkflowContext and applies
   * label and description from schema metadata.
   */
  BooleanInput: (props: WorkflowBooleanInputProps<TSchema>) => ReactElement

  /**
   * Select/dropdown input field with automatic data binding.
   *
   * Automatically gets/sets value from WorkflowContext and applies
   * label, description, placeholder, and options from schema metadata.
   */
  SelectInput: (props: WorkflowSelectInputProps<TSchema>) => ReactElement

  /**
   * Section container for grouping inputs visually.
   *
   * Renders a titled section with optional description.
   */
  Section: (props: SectionProps) => ReactElement

  /**
   * Input group for horizontal layout of inputs.
   *
   * Automatically arranges inputs in a responsive grid.
   */
  InputGroup: (props: InputGroupProps) => ReactElement

  /**
   * Conditional rendering based on data values.
   *
   * Evaluates condition function and renders children only if true.
   */
  ConditionalRender: (props: WorkflowConditionalRenderProps<TSchema>) => ReactElement
}

/**
 * Hook for creating pre-bound workflow panel components.
 *
 * This hook provides convenient wrappers around workflow input components that:
 * - Automatically get/set values from WorkflowContext
 * - Apply metadata from schema (labels, descriptions, etc.)
 * - Handle nested field access via dot notation
 * - Work correctly with the Tag-based reconciler system
 *
 * @example
 * ```typescript
 * function SendEmailPanel() {
 *   const { StringInput, BooleanInput, Section } = useWorkflow(sendEmailSchema)
 *
 *   return (
 *     <WorkflowPanel>
 *       <Section title="Email Details">
 *         <StringInput name="to" />
 *         <StringInput name="subject" />
 *         <StringInput name="body" multiline rows={6} />
 *       </Section>
 *       <Section title="Options">
 *         <BooleanInput name="sendImmediately" />
 *       </Section>
 *     </WorkflowPanel>
 *   )
 * }
 * ```
 *
 * @param schema - The full workflow schema definition
 * @returns Object with pre-bound component factories
 */
export function useWorkflow<TSchema extends WorkflowSchema>(
  schema: TSchema
): UseWorkflowApi<TSchema> {
  // Get data and updateData from WorkflowContext (source of truth)
  const { data, updateData } = useWorkflowContext<InferWorkflowInput<TSchema>>()

  // Extract input schema for metadata lookups
  const inputSchema = schema.inputs

  // Serialize input schema to make _metadata accessible
  // Node instances store options in private _options, but _metadata is only available in toJSON() output
  // biome-ignore lint/correctness/useExhaustiveDependencies: inputSchema is stable during component lifecycle
  const serializedInputSchema = useMemo(() => {
    const result: Record<string, any> = {}
    for (const [key, node] of Object.entries(inputSchema)) {
      result[key] = node.toJSON()
    }
    return result
  }, [])

  // ✓ Store updateData in ref to avoid recreating callbacks
  const updateDataRef = useRef(updateData)
  useEffect(() => {
    updateDataRef.current = updateData
  }, [updateData])

  // ✓ Create stable onChange factory
  const createOnChange = useCallback((fieldName: string) => {
    return (value: any) => {
      updateDataRef.current(set({}, fieldName, value) as Partial<InferWorkflowInput<TSchema>>)
    }
  }, []) // ✓ No dependencies - stable reference

  // StringInput: Workflow string input component
  const WorkflowStringInput = useCallback(
    (props: WorkflowStringInputProps<TSchema>): ReactElement => {
      // Get field metadata from schema
      const metadata = get(serializedInputSchema, props.name as string)?._metadata || {}

      console.log('[useWorkflow] Creating StringInput:', {
        name: props.name,
        metadata,
        currentValue: get(data, props.name as string),
        allData: data,
      })

      // Create element using JSX component (which creates custom element)
      return createElement(StringInput, {
        ...metadata, // Schema defaults (label, description, placeholder)
        ...props, // User overrides
        name: props.name as string,
        value: get(data, props.name as string) || '',
        onChange: createOnChange(props.name as string), // ✓ Stable reference
      })
    },
    [data, serializedInputSchema, createOnChange]
  )

  // NumberInput: Workflow number input component
  const WorkflowNumberInput = useCallback(
    (props: WorkflowNumberInputProps<TSchema>): ReactElement => {
      const metadata = get(serializedInputSchema, props.name as string)?._metadata || {}

      return createElement(NumberInput, {
        ...metadata, // Schema defaults (label, description, min, max, step)
        ...props, // User overrides
        name: props.name as string,
        value: get(data, props.name as string) ?? undefined,
        onChange: createOnChange(props.name as string), // ✓ Stable reference
      })
    },
    [data, serializedInputSchema, createOnChange]
  )

  // BooleanInput: Workflow boolean input component
  const WorkflowBooleanInput = useCallback(
    (props: WorkflowBooleanInputProps<TSchema>): ReactElement => {
      const metadata = get(serializedInputSchema, props.name as string)?._metadata || {}

      return createElement(BooleanInput, {
        ...metadata, // Schema defaults (label, description)
        ...props, // User overrides
        name: props.name as string,
        value: get(data, props.name as string) ?? false,
        onChange: createOnChange(props.name as string), // ✓ Stable reference
      })
    },
    [data, serializedInputSchema, createOnChange]
  )

  // SelectInput: Workflow select input component
  const WorkflowSelectInput = useCallback(
    (props: WorkflowSelectInputProps<TSchema>): ReactElement => {
      const metadata = get(serializedInputSchema, props.name as string)?._metadata || {}

      return createElement(SelectInput, {
        ...metadata, // Schema defaults (label, description, options)
        ...props, // User overrides
        name: props.name as string,
        value: get(data, props.name as string) || '',
        onChange: createOnChange(props.name as string), // ✓ Stable reference
      })
    },
    [data, serializedInputSchema, createOnChange]
  )

  // Section: Layout component (no data binding needed)
  const WorkflowSection = useCallback((props: SectionProps): ReactElement => {
    return createElement(Section, props)
  }, [])

  // InputGroup: Layout component (no data binding needed)
  const WorkflowInputGroup = useCallback((props: InputGroupProps): ReactElement => {
    return createElement(InputGroup, props)
  }, [])

  // ConditionalRender: Conditional component (needs data for evaluation)
  const WorkflowConditionalRender = useCallback(
    (props: WorkflowConditionalRenderProps<TSchema>): ReactElement => {
      return createElement(ConditionalRenderInternal, {
        when: props.when as (data: any) => boolean,
        children: props.children,
        data: data,
      })
    },
    [data]
  )

  return {
    StringInput: WorkflowStringInput,
    NumberInput: WorkflowNumberInput,
    BooleanInput: WorkflowBooleanInput,
    SelectInput: WorkflowSelectInput,
    Section: WorkflowSection,
    InputGroup: WorkflowInputGroup,
    ConditionalRender: WorkflowConditionalRender,
  }
}
