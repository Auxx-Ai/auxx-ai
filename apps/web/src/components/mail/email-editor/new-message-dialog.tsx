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
  trigger: React.ReactNode
  onSendSuccess?: () => void
  /** Optional preset values to initialize the editor with */
  presetValues?: EditorPresetValues
}

const NewMessageDialog: React.FC<NewMessageDialogProps> = ({
  trigger,
  onSendSuccess,
  presetValues,
}) => {
  const [open, setOpen] = React.useState(false)

  const handleClose = () => {
    setOpen(false)
  }

  const handleSendSuccess = () => {
    setOpen(false)
    onSendSuccess?.()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        position="tc"
        size="xxl"
        showClose={false}
        className="border-none shadow-none bg-transparent p-0">
        <DialogHeader className="sr-only">
          <DialogTitle className="text-2xl font-bold">Compose</DialogTitle>
        </DialogHeader>
        <ReplyComposeEditor
          mode="new"
          onClose={handleClose}
          onSendSuccess={handleSendSuccess}
          presetValues={presetValues}
        />
      </DialogContent>
    </Dialog>
  )
}

export default NewMessageDialog
