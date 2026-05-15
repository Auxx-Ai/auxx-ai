// apps/web/src/components/agents/ui/list/create-agent-button.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'

/**
 * Creates a draft agent immediately and routes into setup mode. No dialog —
 * name + description are set by the builder chat. The agent row gets
 * `slug = id` and `User.name = null` server-side.
 */
export function CreateAgentButton() {
  const router = useRouter()
  const { createAgent, isCreating } = useAgentMutations()
  const [isRedirecting, setIsRedirecting] = useState(false)

  const handleClick = useCallback(async () => {
    setIsRedirecting(true)
    const created = await createAgent()
    if (!created) {
      setIsRedirecting(false)
      return
    }
    router.push(`/app/agents/${created.slug}`)
    // Keep isRedirecting true — the unmount when the new page replaces
    // this one tears down the state. Clearing it now would flash the
    // button back to idle while the next route bootstraps.
  }, [createAgent, router])

  return (
    <Button
      size='sm'
      onClick={handleClick}
      loading={isCreating || isRedirecting}
      loadingText='Creating…'>
      <Plus />
      Create agent
    </Button>
  )
}
