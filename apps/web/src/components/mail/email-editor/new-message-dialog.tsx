// src/components/mail/new-message-dialog/index.tsx
'use client'
import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@auxx/ui/components/dialog'
import ReplyComposeEditor from '~/components/mail/email-editor'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'

interface NewMessageDialogProps {
  /** Trigger element for uncontrolled mode */
  trigger?: React.ReactNode
  /** Called when a message is sent successfully */
  onSendSuccess?: () => void
  /** Optional preset values to initialize the editor with */
  presetValues?: EditorPresetValues
  /** Controlled open state */
  open?: boolean
  /** Called when open state changes (for controlled mode) */
  onOpenChange?: (open: boolean) => void
  /** Draft ID to load (for editing existing drafts) */
  draftId?: string
  /** Editor mode: 'new' for new messages, 'draft' for editing drafts */
  mode?: 'new' | 'draft'
}

/**
 * Dialog for composing new messages or editing drafts.
 * Supports both controlled and uncontrolled modes.
 */
const NewMessageDialog: React.FC<NewMessageDialogProps> = ({
  trigger,
  onSendSuccess,
  presetValues,
  open: controlledOpen,
  onOpenChange,
  draftId,
  mode = 'new',
}) => {
  // Uncontrolled internal state (used when trigger is provided)
  const [internalOpen, setInternalOpen] = React.useState(false)

  // Use controlled or uncontrolled state
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (onOpenChange ?? (() => {})) : setInternalOpen

  const handleClose = () => {
    setOpen(false)
  }

  const handleSendSuccess = () => {
    setOpen(false)
    onSendSuccess?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        position="tc"
        size="xxl"
        showClose={false}
        className="border-none shadow-none bg-transparent p-0"
        innerClassName="p-0 ">
        <DialogHeader className="sr-only">
          <DialogTitle className="text-2xl font-bold">
            {mode === 'draft' ? 'Edit Draft' : 'Compose'}
          </DialogTitle>
        </DialogHeader>
        <ReplyComposeEditor
          mode={mode === 'draft' ? 'draft' : 'new'}
          draftId={draftId}
          onClose={handleClose}
          onSendSuccess={handleSendSuccess}
          presetValues={presetValues}
        />
      </DialogContent>
    </Dialog>
  )
}

export { NewMessageDialog }
export default NewMessageDialog
