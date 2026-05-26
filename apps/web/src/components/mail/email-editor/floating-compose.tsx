// apps/web/src/components/mail/email-editor/floating-compose.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Minus, X } from 'lucide-react'
import { motion, useDragControls, useMotionValue } from 'motion/react'
import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useChannel } from '~/components/channels/hooks/use-channels'
import ChatComposer from '../chat-composer'
import { ChatPanel } from '../chat-panel'
import type { ComposeInstance } from '../store/compose-store'
import { useComposeStore } from '../store/compose-store'
import { useDraft } from './hooks/use-draft'
import ReplyComposeEditor from './index'

/** Minimized bar shown when an editor is minimized */
function MinimizedBar({
  instance,
  stackIndex,
  onMaximize,
  onClose,
}: {
  instance: ComposeInstance
  stackIndex: number
  onMaximize: () => void
  onClose: () => void
}) {
  const right = 16 + stackIndex * 260

  return (
    <div
      className='fixed bottom-0 flex h-9 w-[250px] cursor-pointer items-center justify-between rounded-t-lg bg-gray-300 px-3 shadow-lg dark:bg-gray-800'
      style={{ right, zIndex: 100 }}
      onClick={onMaximize}>
      <span className='truncate text-sm font-medium'>{instance.subject || 'New Message'}</span>
      <div className='flex items-center gap-0.5'>
        <Button
          size='icon-sm'
          variant='ghost'
          className='size-6 rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}>
          <X className='size-3.5' />
        </Button>
      </div>
    </div>
  )
}

/** Per-instance floating compose wrapper — handles portal vs fixed positioning, drag, minimize */
export function FloatingCompose({ instance }: { instance: ComposeInstance }) {
  const close = useComposeStore((s) => s.close)
  const minimize = useComposeStore((s) => s.minimize)
  const maximize = useComposeStore((s) => s.maximize)
  const bringToFront = useComposeStore((s) => s.bringToFront)
  const updatePosition = useComposeStore((s) => s.updatePosition)
  const updateSubject = useComposeStore((s) => s.updateSubject)
  const undock = useComposeStore((s) => s.undock)
  const dock = useComposeStore((s) => s.dock)
  const instances = useComposeStore((s) => s.instances)

  const dragControls = useDragControls()
  const dragX = useMotionValue(0)
  const dragY = useMotionValue(0)

  // Deferred editor mount for floating/minimized (same pattern as NewMessageDialog)
  const [editorMounted, setEditorMounted] = useState(instance.displayMode === 'inline')

  useEffect(() => {
    if (instance.displayMode !== 'inline' && !editorMounted) {
      const timer = setTimeout(() => setEditorMounted(true), 200)
      return () => clearTimeout(timer)
    }
    if (instance.displayMode === 'inline') {
      setEditorMounted(true)
    }
  }, [instance.displayMode, editorMounted])

  // Fetch draft if mode is 'draft' and we have a draft ID but no full draft data
  const { draft: fetchedDraft, isLoading: isDraftLoading } = useDraft({
    draftId: instance.mode === 'draft' ? instance.draft?.id : null,
    enabled: instance.mode === 'draft' && !!instance.draft?.id,
  })

  const resolvedDraft = fetchedDraft ?? instance.draft

  const handleClose = useCallback(() => close(instance.id), [close, instance.id])
  const handleMinimize = useCallback(() => minimize(instance.id), [minimize, instance.id])
  const handlePopOut = useCallback(() => undock(instance.id), [undock, instance.id])
  const handleSubjectChange = useCallback(
    (subject: string) => updateSubject(instance.id, subject),
    [updateSubject, instance.id]
  )

  // Check if this instance's thread has a portal target in the DOM (thread is currently viewed)
  const portalTargetId = instance.thread?.id ? `reply-portal-${instance.thread.id}` : null
  const [canDockBack, setCanDockBack] = useState(false)

  useEffect(() => {
    if (instance.displayMode !== 'floating' || !portalTargetId) {
      setCanDockBack(false)
      return
    }
    // Check immediately and on an interval (portal target may appear/disappear with navigation)
    const check = () => setCanDockBack(!!document.getElementById(portalTargetId))
    check()
    const interval = setInterval(check, 500)
    return () => clearInterval(interval)
  }, [instance.displayMode, portalTargetId])

  const handleDockBack = useCallback(() => {
    if (portalTargetId) {
      dock(instance.id, portalTargetId)
    }
  }, [dock, instance.id, portalTargetId])

  const showLoading =
    !editorMounted || (instance.mode === 'draft' && instance.draft?.id && isDraftLoading)

  // Resolve the integration's provider to decide which composer to mount.
  // Chat threads use the dedicated ChatComposer; everything else (email +
  // FB/IG/SMS for now) flows through ReplyComposeEditor.
  const threadChannel = useChannel(instance.thread?.integrationId)
  const isChat = threadChannel?.provider === 'chat'

  // Only attach drag in floating mode; inline/minimized aren't draggable.
  const dragHandleProps =
    instance.displayMode === 'floating'
      ? { onPointerDown: (e: React.PointerEvent) => dragControls.start(e) }
      : undefined

  const editorElement = showLoading ? (
    <div className='flex items-center justify-center rounded-[20px] bg-background p-8'>
      <Loader2 className='size-6 animate-spin text-muted-foreground' />
    </div>
  ) : isChat && instance.thread && instance.displayMode !== 'inline' ? (
    <ChatPanel
      thread={instance.thread}
      isDialogMode={true}
      onClose={handleClose}
      onSendSuccess={() => {}}
      onMinimize={instance.displayMode === 'floating' ? handleMinimize : undefined}
      onDockBack={canDockBack ? handleDockBack : undefined}
      instanceId={instance.id}
      dragHandleProps={dragHandleProps}
    />
  ) : isChat && instance.thread ? (
    <ChatComposer
      thread={instance.thread}
      isDialogMode={false}
      onClose={handleClose}
      onSendSuccess={() => {}}
      onPopOut={handlePopOut}
      instanceId={instance.id}
    />
  ) : (
    <ReplyComposeEditor
      thread={instance.thread}
      sourceMessage={instance.sourceMessage}
      draft={resolvedDraft}
      mode={instance.mode}
      presetValues={instance.presetValues}
      isDialogMode={instance.displayMode !== 'inline'}
      onClose={handleClose}
      onSendSuccess={handleClose}
      onPopOut={instance.displayMode === 'inline' ? handlePopOut : undefined}
      onMinimize={instance.displayMode === 'floating' ? handleMinimize : undefined}
      onDockBack={canDockBack ? handleDockBack : undefined}
      onSubjectChange={handleSubjectChange}
      instanceId={instance.id}
      dragHandleProps={dragHandleProps}
    />
  )

  // INLINE MODE — portal into the target DOM node
  if (instance.displayMode === 'inline' && instance.portalTargetId) {
    const target = document.getElementById(instance.portalTargetId)
    if (target) {
      return createPortal(editorElement, target)
    }
    // Target not found (navigated away?) — fall through to floating
  }

  // MINIMIZED MODE
  if (instance.displayMode === 'minimized') {
    const minimizedInstances = instances.filter((i) => i.displayMode === 'minimized')
    const stackIndex = minimizedInstances.findIndex((i) => i.id === instance.id)
    return (
      <MinimizedBar
        instance={instance}
        stackIndex={stackIndex}
        onMaximize={() => maximize(instance.id)}
        onClose={handleClose}
      />
    )
  }

  // FLOATING MODE — fixed position, draggable
  const floatingWidthClass = isChat
    ? 'fixed w-[min(380px,calc(100vw-32px))]'
    : 'fixed w-[min(480px,calc(100vw-32px))]'
  return (
    <motion.div
      className={floatingWidthClass}
      style={{
        bottom: `calc(16px + ${instance.position.y}px)`,
        right: `calc(16px + ${instance.position.x}px)`,
        zIndex: instance.zIndex,
        x: dragX,
        y: dragY,
      }}
      drag
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={() => {
        // Bake drag offset into stored position, then reset motion transform
        const dx = dragX.get()
        const dy = dragY.get()
        dragX.jump(0)
        dragY.jump(0)
        updatePosition(instance.id, {
          x: instance.position.x - dx,
          y: instance.position.y - dy,
        })
      }}
      onPointerDown={() => bringToFront(instance.id)}>
      {editorElement}
    </motion.div>
  )
}
