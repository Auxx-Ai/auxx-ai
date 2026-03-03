// packages/sdk/src/client/workflow/hooks/use-workflow.ts

'use client'

import { createElement, type ReactElement, useCallback, useMemo } from 'react'
import type { InferWorkflowInput, WorkflowSchema } from '../../../root/workflow/types.js'
import { FieldDivider } from '../components/fields/field-divider.js'
import { FieldRow, type FieldRowProps } from '../components/fields/field-row.js'
import { VarField, type VarFieldProps } from '../components/fields/var-field.js'
import { VarFieldGroup, type VarFieldGroupProps } from '../components/fields/var-field-group.js'
import { VarInput } from '../components/fields/var-input.js'
import type { BooleanInputProps } from '../components/inputs/boolean-input.js'
import type { NumberInputProps } from '../components/inputs/number-input.js'
import type { SelectInputProps } from '../components/inputs/select-input.js'
import type { StringInputProps } from '../components/inputs/string-input.js'
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
 * Props for workflow string input component.
 * Uses Omit to reuse base StringInputProps and adds type-safe name field.
 */
export interface WorkflowStringInputProps<TSchema extends WorkflowSchema>
  extends Omit<StringInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to string field in schema */
  name: PathToField<TSchema['inputs'], 'string'>
  /** Whether field accepts variable references (overrides schema setting) */
  acceptsVariables?: boolean
  /** Allowed variable types (overrides schema setting) */
  variableTypes?: string[]
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
}

/**
 * Props for workflow number input component.
 * Uses Omit to reuse base NumberInputProps and adds type-safe name field.
 */
export interface WorkflowNumberInputProps<TSchema extends WorkflowSchema>
  extends Omit<NumberInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to number field in schema */
  name: PathToField<TSchema['inputs'], 'number'>
  /** Whether field accepts variable references (overrides schema setting) */
  acceptsVariables?: boolean
  /** Allowed variable types (overrides schema setting) */
  variableTypes?: string[]
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
}

/**
 * Props for workflow boolean input component.
 * Uses Omit to reuse base BooleanInputProps and adds type-safe name field.
 */
export interface WorkflowBooleanInputProps<TSchema extends WorkflowSchema>
  extends Omit<BooleanInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to boolean field in schema */
  name: PathToField<TSchema['inputs'], 'boolean'>
  /** Whether field accepts variable references (overrides schema setting) */
  acceptsVariables?: boolean
  /** Allowed variable types (overrides schema setting) */
  variableTypes?: string[]
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
}

/**
 * Props for workflow select input component.
 * Uses Omit to reuse base SelectInputProps and adds type-safe name field.
 */
export interface WorkflowSelectInputProps<TSchema extends WorkflowSchema>
  extends Omit<SelectInputProps, 'name' | 'value' | 'onChange'> {
  /** Type-safe path to select field in schema */
  name: PathToField<TSchema['inputs'], 'select'>
  /** Whether field accepts variable references (overrides schema setting) */
  acceptsVariables?: boolean
  /** Allowed variable types (overrides schema setting) */
  variableTypes?: string[]
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
}

/**
 * Props for workflow options input component (VarEditor-backed select).
 * Same type-safe name as SelectInput but renders through VarEditor.
 */
export interface WorkflowOptionsInputProps<TSchema extends WorkflowSchema> {
  /** Type-safe path to select field in schema */
  name: PathToField<TSchema['inputs'], 'select'>
  /** Dynamic options override (overrides schema options) */
  options?: readonly (string | { label: string; value: string })[]
  /** Placeholder text */
  placeholder?: string
  /** Whether field accepts variable references (overrides schema setting) */
  acceptsVariables?: boolean
  /** Allowed variable types (overrides schema setting) */
  variableTypes?: string[]
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
  /** Select trigger style: 'transparent' (default) or 'outline' */
  variant?: 'transparent' | 'outline'
}

/**
 * Props for VarInput component exposed by useWorkflow.
 */
export interface WorkflowVarInputProps {
  /** Field name */
  name: string
  /** Field type: 'string' | 'number' | 'boolean' | 'select' */
  type: string
  /** Placeholder text */
  placeholder?: string
  /** Whether field accepts variable references */
  acceptsVariables?: boolean
  /** Allowed variable types */
  variableTypes?: string[]
  /** Format hint */
  format?: string
  /** Options for select fields */
  options?: readonly (string | { label: string; value: string })[]
  /** Multiline mode for string type */
  multiline?: boolean
  /** Expand to fill remaining space in a VarFieldGroup layout="row" */
  expand?: boolean
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
  /** Current node data (read-only snapshot from WorkflowContext). */
  data: InferWorkflowInput<TSchema>

  /** Update node data (merges with existing data). Use for programmatic field changes like auto-resetting. */
  updateData: (updates: Partial<InferWorkflowInput<TSchema>>) => void

  /** Base VarEditor component — renders any type based on `type` prop. */
  VarInput: (props: WorkflowVarInputProps) => ReactElement

  /** String input — convenience wrapper for VarInput type="string". */
  StringInput: (props: WorkflowStringInputProps<TSchema>) => ReactElement

  /** Number input — convenience wrapper for VarInput type="number". */
  NumberInput: (props: WorkflowNumberInputProps<TSchema>) => ReactElement

  /** Boolean input — convenience wrapper for VarInput type="boolean". */
  BooleanInput: (props: WorkflowBooleanInputProps<TSchema>) => ReactElement

  /** Select input — convenience wrapper for VarInput type="select". */
  SelectInput: (props: WorkflowSelectInputProps<TSchema>) => ReactElement

  /** Options input — VarEditor-backed select with dynamic options support. */
  OptionsInput: (props: WorkflowOptionsInputProps<TSchema>) => ReactElement

  /** VarField — VarEditorFieldRow wrapper (title, description, type icon, clear button). */
  VarField: (props: VarFieldProps) => ReactElement

  /** VarFieldGroup — VarEditorField container (rounded border, background). */
  VarFieldGroup: (props: VarFieldGroupProps) => ReactElement

  /** FieldRow — horizontal layout container for placing inputs side-by-side within VarFieldGroup. */
  FieldRow: (props: FieldRowProps) => ReactElement

  /** Section container for grouping inputs visually. */
  Section: (props: SectionProps) => ReactElement

  /** Input group for horizontal layout of inputs. */
  InputGroup: (props: InputGroupProps) => ReactElement

  /** Conditional rendering based on data values. */
  ConditionalRender: (props: WorkflowConditionalRenderProps<TSchema>) => ReactElement

  /** FieldDivider — vertical separator for use between inputs in VarFieldGroup layout="row". */
  FieldDivider: () => ReactElement
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

  // VarInput: Base component for all VarEditor-backed inputs
  const WorkflowVarInput = useCallback(
    (props: WorkflowVarInputProps): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name)
      const metadata = fieldJson?._metadata || {}

      return createElement(VarInput, {
        name: props.name,
        type: props.type,
        placeholder: props.placeholder ?? metadata.placeholder,
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        format: props.format ?? metadata.format,
        options: props.options ?? metadata.options,
        multiline: props.multiline,
        expand: props.expand,
      })
    },
    [serializedInputSchema]
  )

  // StringInput: VarInput type="string" convenience wrapper
  const WorkflowStringInput = useCallback(
    (props: WorkflowStringInputProps<TSchema>): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name as string)
      const metadata = fieldJson?._metadata || {}

      return createElement(VarInput, {
        name: props.name as string,
        type: 'string',
        placeholder: props.placeholder ?? metadata.placeholder,
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        format: metadata.format,
        multiline: props.multiline,
        expand: props.expand,
      })
    },
    [serializedInputSchema]
  )

  // NumberInput: VarInput type="number" convenience wrapper
  const WorkflowNumberInput = useCallback(
    (props: WorkflowNumberInputProps<TSchema>): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name as string)
      const metadata = fieldJson?._metadata || {}

      return createElement(VarInput, {
        name: props.name as string,
        type: 'number',
        placeholder: metadata.placeholder,
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        expand: props.expand,
      })
    },
    [serializedInputSchema]
  )

  // BooleanInput: VarInput type="boolean" convenience wrapper
  const WorkflowBooleanInput = useCallback(
    (props: WorkflowBooleanInputProps<TSchema>): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name as string)

      return createElement(VarInput, {
        name: props.name as string,
        type: 'boolean',
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        expand: props.expand,
      })
    },
    [serializedInputSchema]
  )

  // SelectInput: VarInput type="select" convenience wrapper (legacy name)
  const WorkflowSelectInput = useCallback(
    (props: WorkflowSelectInputProps<TSchema>): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name as string)
      const metadata = fieldJson?._metadata || {}

      return createElement(VarInput, {
        name: props.name as string,
        type: 'select',
        placeholder: metadata.placeholder,
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        options: props.options ?? metadata.options,
        expand: props.expand,
      })
    },
    [serializedInputSchema]
  )

  // OptionsInput: VarInput type="select" with explicit dynamic options
  const WorkflowOptionsInput = useCallback(
    (props: WorkflowOptionsInputProps<TSchema>): ReactElement => {
      const fieldJson = get(serializedInputSchema, props.name as string)
      const metadata = fieldJson?._metadata || {}

      return createElement(VarInput, {
        name: props.name as string,
        type: 'select',
        placeholder: props.placeholder ?? metadata.placeholder,
        acceptsVariables: props.acceptsVariables ?? fieldJson?.acceptsVariables,
        variableTypes: props.variableTypes ?? fieldJson?.variableTypes,
        options: props.options ?? metadata.options,
        expand: props.expand,
        variant: props.variant,
      })
    },
    [serializedInputSchema]
  )

  // FieldDivider: Visual separator for row layout (no data binding)
  const WorkflowFieldDivider = useCallback((): ReactElement => {
    return createElement(FieldDivider, {})
  }, [])

  // FieldRow: Horizontal layout container (no data binding)
  const WorkflowFieldRowComponent = useCallback((props: FieldRowProps): ReactElement => {
    return createElement(FieldRow, props)
  }, [])

  // VarField: Wrapper component (no data binding)
  const WorkflowVarField = useCallback((props: VarFieldProps): ReactElement => {
    return createElement(VarField, props)
  }, [])

  // VarFieldGroup: Container component (no data binding)
  const WorkflowVarFieldGroup = useCallback((props: VarFieldGroupProps): ReactElement => {
    return createElement(VarFieldGroup, props)
  }, [])

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
    data,
    updateData,
    VarInput: WorkflowVarInput,
    StringInput: WorkflowStringInput,
    NumberInput: WorkflowNumberInput,
    BooleanInput: WorkflowBooleanInput,
    SelectInput: WorkflowSelectInput,
    OptionsInput: WorkflowOptionsInput,
    FieldRow: WorkflowFieldRowComponent,
    VarField: WorkflowVarField,
    VarFieldGroup: WorkflowVarFieldGroup,
    Section: WorkflowSection,
    InputGroup: WorkflowInputGroup,
    ConditionalRender: WorkflowConditionalRender,
    FieldDivider: WorkflowFieldDivider,
  }
}
