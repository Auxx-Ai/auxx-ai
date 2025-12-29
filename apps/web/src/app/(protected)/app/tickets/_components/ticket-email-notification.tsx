// src/components/TicketEmailNotification.tsx
import React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@auxx/ui/components/alert'
import { Mail } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@auxx/ui/components/tooltip'
import { Button } from '@auxx/ui/components/button'

import { env } from '@auxx/config/client'
interface TicketEmailNotificationProps {
  ticketId: number
}

const TicketEmailNotification: React.FC<TicketEmailNotificationProps> = ({ ticketId }) => {
  // Generate the email address for this ticket
  const supportDomain = env.NEXT_PUBLIC_SUPPORT_DOMAIN || 'yourdomain.com'
  const ticketEmail = `${ticketId}.support@${supportDomain}`

  // Function to copy email to clipboard
  const copyEmailToClipboard = () => {
    navigator.clipboard.writeText(ticketEmail)
  }

  return (
    <Alert className="mb-6 bg-slate-50">
      <Mail className="mt-1 h-4 w-4" />
      <AlertTitle className="text-sm font-medium">Direct Reply Available</AlertTitle>
      <AlertDescription className="mt-1 flex flex-col gap-2 text-sm sm:flex-row sm:items-center">
        <span>
          You can reply directly to this ticket by emailing:
          <span className="ml-1 font-mono">{ticketEmail}</span>
        </span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" className="w-fit" onClick={copyEmailToClipboard}>
                Copy
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Copy email address to clipboard</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </AlertDescription>
    </Alert>
  )
}

export default TicketEmailNotification
