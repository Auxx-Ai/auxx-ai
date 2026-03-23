// apps/web/src/components/mail/email-editor/floating-compose-root.tsx
'use client'

import { useComposeStore } from '../store/compose-store'
import { FloatingCompose } from './floating-compose'

/**
 * Root-level renderer for all floating compose instances.
 * Mount this once at the app layout level so editors persist across navigation.
 */
export function FloatingComposeRoot() {
  const instances = useComposeStore((s) => s.instances)

  console.log(
    '[FloatingComposeRoot] render, instances:',
    instances.length,
    instances.map((i) => `${i.id}:${i.displayMode}`)
  )

  if (instances.length === 0) return null

  return (
    <>
      {instances.map((instance) => (
        <FloatingCompose key={instance.id} instance={instance} />
      ))}
    </>
  )
}
