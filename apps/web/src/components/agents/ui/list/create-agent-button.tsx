// apps/web/src/components/agents/ui/list/create-agent-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export function CreateAgentButton() {
  return (
    <Button asChild size='sm'>
      <Link href='/app/agents/new'>
        <Plus />
        Create agent
      </Link>
    </Button>
  )
}
