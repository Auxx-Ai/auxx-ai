// packages/sdk/src/client/types.ts

import type * as React from 'react'
import type {
  TextBlockProps,
  ButtonProps,
  BadgeProps,
  BannerProps,
  AvatarProps,
  SeparatorProps,
  InputProps,
  LabelProps,
  TextareaProps,
  CheckboxProps,
  SwitchProps,
  SelectProps,
  SelectTriggerProps,
  SelectValueProps,
  SelectContentProps,
  SelectItemProps,
  CardProps,
  CardHeaderProps,
  CardTitleProps,
  CardDescriptionProps,
  CardContentProps,
  CardFooterProps,
} from './components/index.js'

/**
 * IMPORTANT: These types enforce that extensions can ONLY use approved SDK components.
 * This prevents 3rd party extensions from using custom HTML/CSS that doesn't match our design system.
 *
 * Security & Brand Consistency:
 * - Prevents XSS and CSS injection attacks
 * - Ensures all extension dialogs match Auxx's design system
 * - Provides compile-time and runtime enforcement
 */

/**
 * Valid SDK component types that can be used in dialogs.
 * Extensions CANNOT use raw HTML elements (div, p, button, etc.)
 *
 * IMPORTANT: Only add components here that:
 * 1. Are part of the official SDK
 * 2. Have been vetted for security
 * 3. Match Auxx's design system
 * 4. Are properly styled by the platform
 */
type ValidDialogChild =
  // Typography Components
  | React.ReactElement<TextBlockProps>

  // Interactive Components
  | React.ReactElement<ButtonProps>

  // Display Components
  | React.ReactElement<BadgeProps>
  | React.ReactElement<BannerProps>
  | React.ReactElement<AvatarProps>
  | React.ReactElement<SeparatorProps>

  // Form Components
  | React.ReactElement<InputProps>
  | React.ReactElement<LabelProps>
  | React.ReactElement<TextareaProps>
  | React.ReactElement<CheckboxProps>
  | React.ReactElement<SwitchProps>

  // Select Components
  | React.ReactElement<SelectProps>
  | React.ReactElement<SelectTriggerProps>
  | React.ReactElement<SelectValueProps>
  | React.ReactElement<SelectContentProps>
  | React.ReactElement<SelectItemProps>

  // Card Components
  | React.ReactElement<CardProps>
  | React.ReactElement<CardHeaderProps>
  | React.ReactElement<CardTitleProps>
  | React.ReactElement<CardDescriptionProps>
  | React.ReactElement<CardContentProps>
  | React.ReactElement<CardFooterProps>

  // Alert Components

  // React built-ins (safe to use)
  | React.ReactElement<React.ComponentProps<typeof React.Fragment>>
  | React.ReactElement<React.ComponentProps<typeof React.Suspense>>

  // Primitives
  | null
  | undefined
  | false
  | string // Allow text nodes
  | number // Allow number nodes

/**
 * Recursive type to allow arrays and nested SDK components
 */
export type DialogElement = ValidDialogChild | DialogElement[] | ReadonlyArray<DialogElement>

/**
 * Type-safe dialog component props
 */
export interface DialogComponentProps {
  /** Function to programmatically close the dialog */
  hideDialog: () => void
}

/**
 * Strongly typed Dialog component that only accepts approved SDK components.
 *
 * IMPORTANT: Extensions can ONLY use SDK components inside the Dialog function.
 * Using raw HTML elements (div, p, button, etc.) will cause TypeScript compilation errors.
 *
 * @example
 * ```typescript
 * // ✅ CORRECT - Uses SDK components
 * const MyDialog: DialogComponent = ({ hideDialog }) => (
 *   <>
 *     <TextBlock>Content</TextBlock>
 *     <Button label="Close" onClick={hideDialog} />
 *   </>
 * )
 *
 * // ❌ WRONG - Will cause TypeScript error!
 * const BadDialog: DialogComponent = ({ hideDialog }) => (
 *   <div>  {/* ❌ Error: 'div' is not an approved SDK component *\/}
 *     <p>Content</p>
 *   </div>
 * )
 * ```
 */
export type DialogComponent = (props: DialogComponentProps) => DialogElement
