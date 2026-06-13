// apps/web/src/components/apps/ui/connection-variable-form.tsx

'use client'

import type { ConnectionVariable } from '@auxx/database'
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

/**
 * Dialog form for per-connection variable input: the pre-OAuth step (Shopify-style
 * shop domain) and the multi-field secret connect form (FedEx-style API credentials).
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

  // Seed the form each time the dialog opens (reconnect prefills plain values).
  useEffect(() => {
    if (open) {
      setValues(prefill ?? {})
      setRevealed({})
    }
  }, [open, prefill])

  const handleClose = () => {
    onOpenChange(false)
    setValues({})
    setRevealed({})
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    for (const v of variables) {
      if (v.required !== false && !values[v.key]?.trim()) {
        toastError({
          title: 'Missing required field',
          description: `Please provide a value for "${v.label}".`,
        })
        return
      }
    }
    onSubmit(values)
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
            {variables.map((v) => {
              const isVisible = revealed[v.key] ?? false
              return (
                <Field key={v.key}>
                  <FieldLabel>
                    {v.label}
                    {v.required !== false && <span className='text-destructive ml-1'>*</span>}
                  </FieldLabel>
                  {v.secret ? (
                    <InputGroup>
                      <InputGroupInput
                        type={isVisible ? 'text' : 'password'}
                        placeholder={v.placeholder}
                        value={values[v.key] ?? ''}
                        onChange={(e) =>
                          setValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                        }
                      />
                      <InputGroupAddon align='inline-end'>
                        <InputGroupButton
                          type='button'
                          aria-label={isVisible ? 'Hide value' : 'Show value'}
                          aria-pressed={isVisible}
                          size='icon-xs'
                          onClick={() =>
                            setRevealed((prev) => ({ ...prev, [v.key]: !prev[v.key] }))
                          }>
                          {isVisible ? (
                            <EyeOffIcon size={16} aria-hidden='true' />
                          ) : (
                            <EyeIcon size={16} aria-hidden='true' />
                          )}
                        </InputGroupButton>
                      </InputGroupAddon>
                    </InputGroup>
                  ) : (
                    <Input
                      type='text'
                      placeholder={v.placeholder}
                      value={values[v.key] ?? ''}
                      onChange={(e) => setValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                    />
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
