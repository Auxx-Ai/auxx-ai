// apps/web/src/lib/extensions/component-registry.ts

import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@auxx/ui/components/avatar'
import { Badge } from '@auxx/ui/components/badge'
import { Button as ShadcnButton } from '@auxx/ui/components/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@auxx/ui/components/card'
import { Checkbox } from '@auxx/ui/components/checkbox'
import { Dialog } from '@auxx/ui/components/dialog'
import { Input } from '@auxx/ui/components/input'
import { Label } from '@auxx/ui/components/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Separator as ShadcnSeparator } from '@auxx/ui/components/separator'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import type React from 'react'
// Workflow components
import {
  WorkflowNode,
  WorkflowNodeHandle,
  WorkflowNodeRow,
  WorkflowNodeText,
  WorkflowPanel,
} from './components/workflow'
import { WorkflowVarField } from './components/workflow/fields/var-field'
import { WorkflowVarFieldGroup } from './components/workflow/fields/var-field-group'
// Note: Old input components (StringInput, NumberInput, etc.) are still available from
// './components/workflow/inputs' for settings panels where VarEditor isn't needed.
import { VarInputInternal } from './components/workflow/inputs/var-input'
import {
  InputGroup,
  Section,
  Separator as WorkflowSeparatorComponent,
} from './components/workflow/layout'
import { WorkflowAlert } from './components/workflow/utility/alert'
import { WorkflowBadge } from './components/workflow/utility/badge'
import { ConditionalRender } from './components/workflow/utility/conditional-render'
import { InputEditor } from './components/workflow/variables/input-editor'
import { VariableInput } from './components/workflow/variables/variable-input'
import { Form as FormComponent } from './forms/form-reconstructor'

/**
 * FormField placeholder component.
 * This is reconstructed by reconstructReactTree but the actual rendering
 * is handled internally by FormReconstructor.
 * The component never renders - it just carries metadata.
 */
const FormField = (_props: any) => {
  return null
}

/**
 * FormSubmit placeholder component.
 * This is reconstructed by reconstructReactTree but the actual rendering
 * is handled internally by FormReconstructor.
 * The component never renders - it just carries metadata.
 */
const FormSubmit = (_props: any) => {
  return null
}

/**
 * Button wrapper that handles event handlers from iframe.
 * Calls event handlers via MessageClient using event names.
 */
const Button = ({ __instanceId, __onCallHandler, __hasOnClick, label, onClick, ...props }: any) => {
  // If there's an __onCallHandler and the button has an onClick handler, wire it up
  const handleClick =
    __onCallHandler && __instanceId && __hasOnClick
      ? async () => {
          console.log('[Button] Calling onClick on instance:', __instanceId)
          // Call with event name instead of handler ID
          await __onCallHandler(__instanceId, 'onClick')
        }
      : onClick // Fallback to direct onClick if no handler system

  return <ShadcnButton onClick={handleClick}>{label}</ShadcnButton>
}

/**
 * Separator wrapper with mandatory margin styles.
 */
const Separator = ({ __instanceId, __onCallHandler, ...props }: any) => {
  return <ShadcnSeparator className='my-3' {...props} />
}

/**
 * Registry of React components available to extensions.
 * Maps component names to actual components for serialized rendering.
 *
 * Per Plan 7: Extensions use these component names in their React code,
 * the reconciler serializes them to JSON, and this registry maps them back
 * to real components on the platform side.
 *
 * Only safe, UI-focused components are exposed to extensions.
 */
export const componentRegistry = {
  // === Form Components ===
  Form: FormComponent,
  FormField,
  FormSubmit,
  Dialog,
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Checkbox,
  Textarea,
  Switch,

  // === Layout Components ===
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Separator,

  // === Display Components ===
  Badge,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Alert,
  AlertDescription,
  AlertTitle,

  // === Custom Extension Components ===
  /** Simple text block component for displaying formatted text */
  TextBlock: ({
    children,
    align,
    className,
    style,
  }: {
    children?: React.ReactNode
    align?: 'left' | 'center' | 'right'
    className?: string
    style?: React.CSSProperties
  }) => {
    const alignClass = align ? `text-${align}` : ''
    return (
      <div className={className || `text-sm text-foreground ${alignClass}`} style={style}>
        {children}
      </div>
    )
  },

  /** Banner component for important messages */
  Banner: ({
    variant = 'info',
    children,
    className,
    style,
  }: {
    variant?: 'info' | 'warning' | 'error' | 'success'
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => {
    const variantStyles = {
      info: 'bg-blue-50 border-blue-200 text-blue-900',
      warning: 'bg-yellow-50 border-yellow-200 text-yellow-900',
      error: 'bg-red-50 border-red-200 text-red-900',
      success: 'bg-green-50 border-green-200 text-green-900',
    }

    return (
      <div
        className={`rounded-lg border p-4 ${variantStyles[variant]} ${className || ''}`}
        style={style}>
        {children}
      </div>
    )
  },

  /** Typography component for titles/headings */
  Typography: ({
    variant = 'standard',
    children,
    className,
    style,
  }: {
    variant?: 'extraLarge' | 'large' | 'standard' | 'medium' | 'small' | 'extraSmall'
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => {
    const variantStyles = {
      extraLarge: 'text-4xl font-bold',
      large: 'text-3xl font-bold',
      standard: 'text-xl font-semibold',
      medium: 'text-lg font-medium',
      small: 'text-base font-medium',
      extraSmall: 'text-sm font-medium',
    }

    return (
      <div className={`${variantStyles[variant]} ${className || ''}`} style={style}>
        {children}
      </div>
    )
  },

  /** Typography.Body component for body text */
  TypographyBody: ({
    variant = 'standard',
    children,
    className,
    style,
  }: {
    variant?: 'standard' | 'large' | 'strong' | 'interactive'
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => {
    const variantStyles = {
      standard: 'text-sm',
      large: 'text-base',
      strong: 'text-sm font-semibold',
      interactive: 'text-sm text-blue-600 hover:underline cursor-pointer',
    }

    return (
      <div className={`${variantStyles[variant]} ${className || ''}`} style={style}>
        {children}
      </div>
    )
  },

  /** Typography.Caption component for caption text */
  TypographyCaption: ({
    children,
    className,
    style,
  }: {
    children?: React.ReactNode
    className?: string
    style?: React.CSSProperties
  }) => (
    <div className={`text-xs text-muted-foreground ${className || ''}`} style={style}>
      {children}
    </div>
  ),

  // === Workflow SDK Components ===
  WorkflowNode: WorkflowNode,
  WorkflowNodeRow: WorkflowNodeRow,
  WorkflowNodeText: WorkflowNodeText,
  WorkflowNodeHandle: WorkflowNodeHandle,
  WorkflowPanel: WorkflowPanel,
  // VarEditor-backed input components (v2 — all point to VarInputInternal)
  VarInputInternal: VarInputInternal,
  StringInputInternal: VarInputInternal,
  NumberInputInternal: VarInputInternal,
  BooleanInputInternal: VarInputInternal,
  OptionsInputInternal: VarInputInternal,
  SelectInputInternal: VarInputInternal, // Backward compat alias
  // VarField wrappers
  WorkflowVarField: WorkflowVarField,
  WorkflowVarFieldGroup: WorkflowVarFieldGroup,
  WorkflowSection: Section,
  WorkflowInputGroup: InputGroup,
  WorkflowSeparator: WorkflowSeparatorComponent,
  WorkflowAlert: WorkflowAlert,
  WorkflowBadge: WorkflowBadge,
  ConditionalRenderInternal: ConditionalRender,
  VariableInputInternal: VariableInput,
  InputEditorInternal: InputEditor,
}

/**
 * Type-safe component name (for TypeScript)
 */
export type ComponentName = keyof typeof componentRegistry

/**
 * Get a component from the registry by name.
 * Returns undefined if component not found.
 */
export function getComponent(name: string): React.ComponentType<any> | undefined {
  return componentRegistry[name as ComponentName]
}

/**
 * Check if a component exists in the registry.
 */
export function hasComponent(name: string): boolean {
  return name in componentRegistry
}

/**
 * Get all registered component names.
 */
export function getAllComponentNames(): string[] {
  return Object.keys(componentRegistry)
}
