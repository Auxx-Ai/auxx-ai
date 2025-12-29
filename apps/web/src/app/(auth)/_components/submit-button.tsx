'use client'
import React, { type ReactNode, useState } from 'react'
// import { useFormStatus } from "react-dom";
import { Heart, Loader2 } from 'lucide-react'
import { Button } from '@auxx/ui/components/button'

interface GeneralSubmitButtonProps {
  text: string
  variant?: 'default' | 'destructive' | 'secondary' | 'ghost' | 'link' | 'outline'
  width?: string
  icon?: ReactNode
  onClick?: () => void
}

export function GeneralSubmitButton({
  text,
  variant,
  width,
  icon,
  onClick,
}: GeneralSubmitButtonProps) {
  // const { pending } = useFormStatus();
  const [isPending, _setIsPending] = useState(false)
  return (
    <Button
      type="button"
      variant={variant}
      className={width}
      disabled={isPending}
      onClick={onClick}
      loading={isPending}
      loadingText="Submitting...">
      <>
        {icon && <div>{icon}</div>}
        <span>{text}</span>
      </>
    </Button>
  )
}

export function SaveJobButton({ savedJob }: { savedJob: boolean }) {
  // const { pending } = useFormStatus();
  const [isPending, _setIsPending2] = useState(false)

  return (
    <Button
      variant="outline"
      loading={isPending}
      loadingText="Saving..."
      type="button"
      className="flex items-center gap-2">
      <Heart
        className={`size-4 transition-colors ${savedJob ? 'fill-current text-red-500' : ''}`}
      />
      {savedJob ? 'Saved' : 'Save Job'}
    </Button>
  )
}
