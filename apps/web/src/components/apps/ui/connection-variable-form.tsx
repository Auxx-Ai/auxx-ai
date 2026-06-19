// apps/web/src/components/apps/ui/connection-variable-form.tsx

'use client'

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldDescription, FieldLabel } from '@auxx/ui/components/field'
import { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import { Switch } from '@auxx/ui/components/switch'
import { Textarea } from '@auxx/ui/components/textarea'
import { toastError } from '@auxx/ui/components/toast'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'

interface ConnectionVariableFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appTitle: string
  /** Definition description shown under the title; falls back to a generic line. */
  description?: string
  variables: ConnectionVariable[]
  /** Values to prefill (reconnect) — plain variables only, secrets are re-entered. */
  prefill?: Record<string, string>
  /** Disables the submit button while a save mutation is in flight. */
  pending?: boolean
  onSubmit: (values: Record<string, string>) => void
}

/** A masked field — masking is the orthogonal `secret` flag, independent of the field type. */
function isSecretVariable(v: ConnectionVariable): boolean {
  return v.secret === true
}

/**
 * Conditional visibility (§2.3 `displayOptions.show`): the field shows only when every
 * referenced key currently holds one of its allowed values. Values are compared as strings
 * since the form stores everything as strings (booleans as `'true'`/`'false'`).
 */
function isFieldVisible(v: ConnectionVariable, values: Record<string, string>): boolean {
  const show = v.displayOptions?.show
  if (!show) return true
  for (const [key, allowed] of Object.entries(show)) {
    if (!allowed.map(String).includes(values[key] ?? '')) return false
  }
  return true
}

/** Seed a field from its reconnect prefill, else its declared default, else empty. */
function seedValue(v: ConnectionVariable, prefill?: Record<string, string>): string {
  const pre = prefill?.[v.key]
  if (pre !== undefined) return pre
  if (v.default !== undefined) return String(v.default)
  // Booleans always need a concrete value so the Switch renders and `required` passes.
  return v.type === FieldType.CHECKBOX ? 'false' : ''
}

/** Validate a single value against §2.3 rules. Returns an error message, or null when valid. */
function validateValue(v: ConnectionVariable, value: string): string | null {
  if (v.required !== false && !value.trim()) {
    return `Please provide a value for "${v.label}".`
  }
  if (!value) return null

  const rules = v.validation
  if (!rules) return null

  if (rules.minLength !== undefined && value.length < rules.minLength) {
    return `${v.label} must be at least ${rules.minLength} characters`
  }
  if (rules.maxLength !== undefined && value.length > rules.maxLength) {
    return `${v.label} must be no more than ${rules.maxLength} characters`
  }
  const num = Number(value)
  if (rules.min !== undefined && num < rules.min) {
    return `${v.label} must be at least ${rules.min}`
  }
  if (rules.max !== undefined && num > rules.max) {
    return `${v.label} must be no more than ${rules.max}`
  }
  if (rules.port && (!Number.isInteger(num) || num < 1 || num > 65535)) {
    return `${v.label} must be a valid port number (1-65535)`
  }
  return null
}

/**
 * Dialog form for per-connection variable input. Renders the full §2.3 field model —
 * string/password (masked), number, boolean, options (dropdown), and textarea — with declared
 * defaults, conditional `displayOptions.show` visibility, and field validation. Covers both the
 * pre-OAuth step (Shopify-style shop domain) and multi-field secret connects (FedEx, Postgres).
 * Returns the gathered values to the caller; does not navigate or mutate.
 */
export function ConnectionVariableForm({
  open,
  onOpenChange,
  appTitle,
  description,
  variables,
  prefill,
  pending,
  onSubmit,
}: ConnectionVariableFormProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  // Seed the form each time the dialog opens (reconnect prefills plain values; defaults fill rest).
  useEffect(() => {
    if (open) {
      const seeded: Record<string, string> = {}
      for (const v of variables) seeded[v.key] = seedValue(v, prefill)
      setValues(seeded)
      setRevealed({})
    }
  }, [open, prefill, variables])

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }))

  const handleClose = () => {
    onOpenChange(false)
    setValues({})
    setRevealed({})
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Only the currently-visible fields are validated and submitted — a hidden conditional
    // block (e.g. an inactive SSH tunnel) neither blocks the submit nor leaks stale values.
    const visible = variables.filter((v) => isFieldVisible(v, values))
    const submitted: Record<string, string> = {}
    for (const v of visible) {
      const value = values[v.key] ?? ''
      const error = validateValue(v, value)
      if (error) {
        toastError({ title: 'Invalid field', description: error })
        return
      }
      submitted[v.key] = value
    }
    onSubmit(submitted)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
        else onOpenChange(true)
      }}>
      <DialogContent position='tc' size='sm'>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Connect {appTitle}</DialogTitle>
            <DialogDescription>
              {description || `Provide the following details to connect ${appTitle}.`}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-4'>
            {variables
              .filter((v) => isFieldVisible(v, values))
              .map((v) => {
                const value = values[v.key] ?? ''
                const isVisible = revealed[v.key] ?? false
                return (
                  <Field key={v.key}>
                    <FieldLabel>
                      {v.label}
                      {v.required !== false && <span className='text-destructive ml-1'>*</span>}
                    </FieldLabel>
                    {renderControl(v, value, isVisible, setValue, (key) =>
                      setRevealed((prev) => ({ ...prev, [key]: !prev[key] }))
                    )}
                    {v.description && <FieldDescription>{v.description}</FieldDescription>}
                  </Field>
                )
              })}
          </div>
          <DialogFooter>
            <Button type='button' variant='ghost' size='sm' onClick={handleClose}>
              Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
            </Button>
            <Button type='submit' variant='outline' size='sm' loading={pending}>
              Connect <KbdSubmit variant='outline' size='sm' />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** Render the input control for one variable, switched on its platform `FieldType`. */
function renderControl(
  v: ConnectionVariable,
  value: string,
  reveal: boolean,
  setValue: (key: string, value: string) => void,
  toggleReveal: (key: string) => void
) {
  switch (v.type) {
    case FieldType.CHECKBOX:
      return (
        <Switch
          checked={value === 'true'}
          onCheckedChange={(checked) => setValue(v.key, String(checked))}
        />
      )
    case FieldType.SINGLE_SELECT:
      return (
        <Select value={value} onValueChange={(next) => setValue(v.key, next)}>
          <SelectTrigger>
            <SelectValue placeholder={v.placeholder ?? 'Select an option'} />
          </SelectTrigger>
          <SelectContent>
            {(v.options ?? []).map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case FieldType.NUMBER:
      return (
        <Input
          type='number'
          placeholder={v.placeholder}
          value={value}
          onChange={(e) => setValue(v.key, e.target.value)}
        />
      )
    default:
      // TEXT — multiline hint renders a textarea (e.g. an SSH key); otherwise a
      // single-line input. Masked (`secret`) inputs get a reveal toggle.
      if (v.multiline) {
        return (
          <Textarea
            rows={v.rows ?? 4}
            placeholder={v.placeholder}
            value={value}
            onChange={(e) => setValue(v.key, e.target.value)}
          />
        )
      }
      if (isSecretVariable(v)) {
        return (
          <InputGroup>
            <InputGroupInput
              type={reveal ? 'text' : 'password'}
              placeholder={v.placeholder}
              value={value}
              onChange={(e) => setValue(v.key, e.target.value)}
            />
            <InputGroupAddon align='inline-end'>
              <InputGroupButton
                type='button'
                aria-label={reveal ? 'Hide value' : 'Show value'}
                aria-pressed={reveal}
                size='icon-xs'
                onClick={() => toggleReveal(v.key)}>
                {reveal ? (
                  <EyeOffIcon size={16} aria-hidden='true' />
                ) : (
                  <EyeIcon size={16} aria-hidden='true' />
                )}
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        )
      }
      return (
        <Input
          type='text'
          placeholder={v.placeholder}
          value={value}
          onChange={(e) => setValue(v.key, e.target.value)}
        />
      )
  }
}
