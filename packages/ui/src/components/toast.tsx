// packages/ui/src/components/toast.tsx

'use client'

import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { toast as sonnerToast, type ExternalToast } from 'sonner'
import { Button } from './button'

/**
 * Button configuration object for toast actions
 */
export interface ToastActionButton {
  label: string
  onClick: (dismiss: () => void) => void
  className?: string
  variant?: 'default' | 'destructive' | 'destructive-hover' | 'info' | 'outline' | 'secondary' | 'ghost' | 'link' | 'input'
  size?: 'default' | 'xs' | 'sm' | 'lg' | 'icon' | 'icon-xs' | 'icon-sm'
}

/**
 * Actions can be:
 * - A single React component
 * - An array of React components
 * - A single button config object
 * - An array of button config objects
 */
export type ToastActions =
  | React.ReactNode
  | ToastActionButton
  | (React.ReactNode | ToastActionButton)[]

/**
 * Props for the custom Toast component
 */
interface ToastProps {
  id: string | number
  title?: string
  description?: string
  icon?: React.ReactNode
  button?: {
    label: string
    onClick: () => void
  }
  actions?: ToastActions
}

/**
 * Custom toast options = content props + Sonner's ExternalToast options
 */
type CustomToastOptions = Omit<ToastProps, 'id'> & ExternalToast

/**
 * Helper to check if value is a ToastActionButton config object
 */
function isActionButton(value: any): value is ToastActionButton {
  return (
    value &&
    typeof value === 'object' &&
    'label' in value &&
    'onClick' in value &&
    typeof value.label === 'string' &&
    typeof value.onClick === 'function'
  )
}

/**
 * Helper to render actions from various formats
 */
function renderActions(actions: ToastActions | undefined, dismiss: () => void): React.ReactNode {
  if (!actions) return null

  // Convert to array for uniform handling
  const actionsArray = Array.isArray(actions) ? actions : [actions]

  return actionsArray.map((action, index) => {
    // If it's a button config object, render as Button
    if (isActionButton(action)) {
      return (
        <Button
          key={index}
          variant={action.variant || 'outline'}
          size={action.size || 'sm'}
          className={action.className}
          onClick={() => action.onClick(dismiss)}>
          {action.label}
        </Button>
      )
    }

    // Otherwise, render as React node
    return <div key={index}>{action as React.ReactNode}</div>
  })
}

/**
 * Helper to create custom toast with proper type separation
 */
function toast(options: CustomToastOptions) {
  const { title, description, icon, button, actions, ...toastOptions } = options

  return sonnerToast.custom(
    (id) => (
      <Toast
        id={id}
        title={title}
        description={description}
        button={button}
        icon={icon}
        actions={actions}
      />
    ),
    toastOptions
  )
}

/**
 * A fully custom toast that still maintains the animations and interactions.
 */
function Toast(props: ToastProps) {
  const { title, description, button, id, icon, actions } = props
  const [isShow, setIsShow] = useState(false)
  const showMore = useCallback(() => {
    setIsShow((bool) => !bool)
  }, [])

  const dismiss = useCallback(() => {
    sonnerToast.dismiss(id)
  }, [id])

  return (
    <div className="flex rounded-2xl bg-white dark:bg-primary-400 shadow-lg shadow-black/10 ring-1 ring-black/5 w-full md:max-w-[350px] min-w-[300px] items-start ps-2 p-1.5 gap-2">
      <div className="mt-[2px]">{icon}</div>
      <div className="flex flex-1 items-start flex-col gap-2">
        <div className="w-full flex items-center justify-start gap-2 mt-[2px]">
          <p className="text-[14px]  mb-0 font-medium text-primary-600 dark:text-primary-800">
            {title}
          </p>
          {description && (
            <button
              onClick={showMore}
              className="size-4.5 bg-black/5 rounded-md flex items-center justify-center shrink-0">
              {isShow ? (
                <ChevronDown className="size-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )}
            </button>
          )}
        </div>
        {isShow && <div className=" text-sm text-primary-600">{description}</div>}
        {actions && (
          <div className="flex gap-2 w-full flex-wrap">
            {renderActions(actions, dismiss)}
          </div>
        )}
      </div>
      <div>
        <button
          onClick={() => {
            button?.onClick()
            dismiss()
          }}
          className="shrink-0 flex items-center justify-center size-6 rounded-full hover:bg-black/5 dark:hover:bg-black/10">
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}

/**
 * Display a success toast notification
 */
export function toastSuccess(options: {
  title?: string
  description?: string
  actions?: ToastActions
}) {
  return toast({
    title: options.title ?? 'Success',
    icon: <Check className="size-5 text-good-500" />,
    description: options.description,
    actions: options.actions,
    position: 'top-right',
  })
}

/**
 * Display an error toast notification
 */
export function toastError(options: {
  title?: string
  description?: string
  actions?: ToastActions
  action?: React.ReactNode
  onDismiss?: () => void
  duration?: number
}) {
  return toast({
    title: options.title || 'Error',
    icon: <X className="size-5 text-red-500" />,
    description: options.description,
    actions: options.actions,
    position: 'top-right',
    duration: options.duration ?? 10_000,
    action: options.action,
    onDismiss: options.onDismiss,
  })
}

/**
 * Display an info toast notification
 */
export function toastInfo(options: {
  title: string
  description?: string
  duration?: number
  actions?: ToastActions
}) {
  return toast({
    title: options.title,
    description: options.description,
    actions: options.actions,
    position: 'top-right',
    duration: options.duration,
  })
}
