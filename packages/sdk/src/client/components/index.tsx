// packages/sdk/src/client/components/index.tsx

/**
 * UI Components for building extension interfaces
 *
 * These components use custom elements (e.g., auxxbutton, auxxtextblock) that are
 * processed by the React reconciler and rendered by the platform's component registry.
 *
 * Implemented components use the reconciler pattern and work across the postMessage boundary.
 * Unimplemented components are stubs that throw errors if used before implementation.
 */

import type React from 'react'

export { Avatar, type AvatarProps } from './avatar.js'
export { Badge, type BadgeProps } from './badge.js'
export { Banner, type BannerProps } from './banner.js'
export { Button, type ButtonProps } from './button.js'
export { Separator, type SeparatorProps } from './separator.js'
export { TextBlock, type TextBlockProps } from './text-block.js'
export {
  Typography,
  type TypographyBodyProps,
  type TypographyCaptionProps,
  type TypographyProps,
} from './typography.js'

// === Form Components ===

export { Form, type FormProps, type FormRef, type FormValidationMode } from './form.js'
export { FormField, type FormFieldProps } from './form-field.js'
export { FormSubmit, type FormSubmitProps } from './form-submit.js'

/** Input component props */
export interface InputProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void
  className?: string
  name?: string
  [key: string]: any
}

/** Input component */
export const Input: React.FC<InputProps> = () => {
  throw new Error('[auxx/client] Input component not available - must be provided by runtime')
}

/** Label component props */
export interface LabelProps {
  children: React.ReactNode
  htmlFor?: string
  className?: string
  [key: string]: any
}

/** Label component */
export const Label: React.FC<LabelProps> = () => {
  throw new Error('[auxx/client] Label component not available - must be provided by runtime')
}

/** Textarea component props */
export interface TextareaProps {
  value?: string
  placeholder?: string
  disabled?: boolean
  onChange?: (event: React.ChangeEvent<HTMLTextAreaElement>) => void
  className?: string
  name?: string
  rows?: number
  [key: string]: any
}

/** Textarea component */
export const Textarea: React.FC<TextareaProps> = () => {
  throw new Error('[auxx/client] Textarea component not available - must be provided by runtime')
}

/** Checkbox component props */
export interface CheckboxProps {
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  className?: string
  [key: string]: any
}

/** Checkbox component */
export const Checkbox: React.FC<CheckboxProps> = () => {
  throw new Error('[auxx/client] Checkbox component not available - must be provided by runtime')
}

/** Switch component props */
export interface SwitchProps {
  checked?: boolean
  disabled?: boolean
  onChange?: (checked: boolean) => void
  className?: string
  [key: string]: any
}

/** Switch component */
export const Switch: React.FC<SwitchProps> = () => {
  throw new Error('[auxx/client] Switch component not available - must be provided by runtime')
}

// === Select Components ===

/** Select component props */
export interface SelectProps {
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
  [key: string]: any
}

/** Select component */
export const Select: React.FC<SelectProps> = () => {
  throw new Error('[auxx/client] Select component not available - must be provided by runtime')
}

/** SelectTrigger component props */
export interface SelectTriggerProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** SelectTrigger component */
export const SelectTrigger: React.FC<SelectTriggerProps> = () => {
  throw new Error(
    '[auxx/client] SelectTrigger component not available - must be provided by runtime'
  )
}

/** SelectValue component props */
export interface SelectValueProps {
  placeholder?: string
  [key: string]: any
}

/** SelectValue component */
export const SelectValue: React.FC<SelectValueProps> = () => {
  throw new Error('[auxx/client] SelectValue component not available - must be provided by runtime')
}

/** SelectContent component props */
export interface SelectContentProps {
  children: React.ReactNode
  [key: string]: any
}

/** SelectContent component */
export const SelectContent: React.FC<SelectContentProps> = () => {
  throw new Error(
    '[auxx/client] SelectContent component not available - must be provided by runtime'
  )
}

/** SelectItem component props */
export interface SelectItemProps {
  value: string
  children: React.ReactNode
  [key: string]: any
}

/** SelectItem component */
export const SelectItem: React.FC<SelectItemProps> = () => {
  throw new Error('[auxx/client] SelectItem component not available - must be provided by runtime')
}

// === Card Components ===

/** Card component props */
export interface CardProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** Card component */
export const Card: React.FC<CardProps> = () => {
  throw new Error('[auxx/client] Card component not available - must be provided by runtime')
}

/** CardHeader component props */
export interface CardHeaderProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** CardHeader component */
export const CardHeader: React.FC<CardHeaderProps> = () => {
  throw new Error('[auxx/client] CardHeader component not available - must be provided by runtime')
}

/** CardTitle component props */
export interface CardTitleProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** CardTitle component */
export const CardTitle: React.FC<CardTitleProps> = () => {
  throw new Error('[auxx/client] CardTitle component not available - must be provided by runtime')
}

/** CardDescription component props */
export interface CardDescriptionProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** CardDescription component */
export const CardDescription: React.FC<CardDescriptionProps> = () => {
  throw new Error(
    '[auxx/client] CardDescription component not available - must be provided by runtime'
  )
}

/** CardContent component props */
export interface CardContentProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** CardContent component */
export const CardContent: React.FC<CardContentProps> = () => {
  throw new Error('[auxx/client] CardContent component not available - must be provided by runtime')
}

/** CardFooter component props */
export interface CardFooterProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** CardFooter component */
export const CardFooter: React.FC<CardFooterProps> = () => {
  throw new Error('[auxx/client] CardFooter component not available - must be provided by runtime')
}

// === Display Components ===

// === Alert Components ===

// === Dialog Components ===

/** Dialog component props */
export interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
  [key: string]: any
}

/** Dialog component */
export const Dialog: React.FC<DialogProps> = () => {
  throw new Error('[auxx/client] Dialog component not available - must be provided by runtime')
}

/** DialogContent component props */
export interface DialogContentProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** DialogContent component */
export const DialogContent: React.FC<DialogContentProps> = () => {
  throw new Error(
    '[auxx/client] DialogContent component not available - must be provided by runtime'
  )
}

/** DialogHeader component props */
export interface DialogHeaderProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** DialogHeader component */
export const DialogHeader: React.FC<DialogHeaderProps> = () => {
  throw new Error(
    '[auxx/client] DialogHeader component not available - must be provided by runtime'
  )
}

/** DialogTitle component props */
export interface DialogTitleProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** DialogTitle component */
export const DialogTitle: React.FC<DialogTitleProps> = () => {
  throw new Error('[auxx/client] DialogTitle component not available - must be provided by runtime')
}

/** DialogDescription component props */
export interface DialogDescriptionProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** DialogDescription component */
export const DialogDescription: React.FC<DialogDescriptionProps> = () => {
  throw new Error(
    '[auxx/client] DialogDescription component not available - must be provided by runtime'
  )
}

/** DialogFooter component props */
export interface DialogFooterProps {
  children: React.ReactNode
  className?: string
  [key: string]: any
}

/** DialogFooter component */
export const DialogFooter: React.FC<DialogFooterProps> = () => {
  throw new Error(
    '[auxx/client] DialogFooter component not available - must be provided by runtime'
  )
}
