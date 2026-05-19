// apps/web/src/components/apps/ui/secret-connection-form.tsx

'use client'

import { Button } from '@auxx/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@auxx/ui/components/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@auxx/ui/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { Kbd, KbdSubmit } from '@auxx/ui/components/kbd'
import { toastError } from '@auxx/ui/components/toast'
import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

interface SecretConnectionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionLabel: string
  connectionType: 'user' | 'organization'
  pending: boolean
  onSubmit: (secret: string) => void
}

/**
 * Dialog form for API-key (secret) connections. Submitted value is handed
 * back to the caller; the form does not own the mutation.
 * See plans/kopilot/apps/app-settings-dialog-refactor.md §5.4.
 */
export function SecretConnectionForm({
  open,
  onOpenChange,
  connectionLabel,
  connectionType,
  pending,
  onSubmit,
}: SecretConnectionFormProps) {
  const [secret, setSecret] = useState('')
  const [showSecret, setShowSecret] = useState(false)

  const handleClose = () => {
    onOpenChange(false)
    setSecret('')
    setShowSecret(false)
  }

  const handleSave = () => {
    if (!secret.trim()) {
      toastError({ title: 'Validation Error', description: 'Please enter an API key.' })
      return
    }
    onSubmit(secret.trim())
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose()
        else onOpenChange(true)
      }}>
      <DialogContent size='sm' position='tc'>
        <DialogHeader>
          <DialogTitle>Connect {connectionLabel}</DialogTitle>
          <DialogDescription>
            Enter your API key to connect this {connectionType} connection.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='secret'>API Key</FieldLabel>
            <InputGroup>
              <InputGroupInput
                id='secret'
                type={showSecret ? 'text' : 'password'}
                placeholder='Enter your API key'
                value={secret}
                autoComplete='off'
                onChange={(e) => setSecret(e.target.value)}
              />
              <InputGroupAddon align='inline-end'>
                <InputGroupButton
                  aria-label={showSecret ? 'Hide API key' : 'Show API key'}
                  title={showSecret ? 'Hide API key' : 'Show API key'}
                  size='icon-xs'
                  onClick={() => setShowSecret(!showSecret)}>
                  {showSecret ? <EyeOff /> : <Eye />}
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              Your API key will be encrypted and stored securely. It will be used to authenticate
              requests to {connectionLabel}.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant='ghost' size='sm' onClick={handleClose} disabled={pending}>
            Cancel <Kbd shortcut='esc' variant='ghost' size='sm' />
          </Button>
          <Button
            variant='outline'
            size='sm'
            onClick={handleSave}
            loading={pending}
            loadingText='Saving...'
            data-dialog-submit>
            Save Connection <KbdSubmit variant='outline' size='sm' />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
