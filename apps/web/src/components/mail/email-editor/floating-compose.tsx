// apps/web/src/components/mail/email-editor/floating-compose.tsx
'use client'

import { Button } from '@auxx/ui/components/button'
import { cn } from '@auxx/ui/lib/utils'
import { Loader2, Minus, X } from 'lucide-react'
import { motion, useDragControls, useMotionValue } from 'motion/react'
import type React from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/**
 * Capture what the browser is about to throw away, and return the undo.
 *
 * Re-parenting the host is `remove` + `insert`, and a removed node loses focus
 * and takes the caret with it — so popping out mid-sentence would drop the user
 * out of the field they were typing in. Everything captured here (the focused
 * node, an input's selection range, a contenteditable's DOM Range) references
 * nodes that the move preserves, so restoring is just re-pointing at them.
 *
 * Only ever fires for focus INSIDE the host: a move must not steal focus from
 * whatever else the user happened to be in.
 */
function preserveFocusAcrossMove(host: HTMLElement): () => void {
  const active = document.activeElement as HTMLElement | null
  if (!active || !host.contains(active)) return () => {}

  const input =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null
  const start = input?.selectionStart ?? null
  const end = input?.selectionEnd ?? null
  // Tiptap's body is a contenteditable, so its caret is a DOM Range, not an
  // input selection. Cloned because the live Range is collapsed by the removal.
  const selection = window.getSelection()
  const range =
    !input && selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null

  return () => {
    // preventScroll — the composer is 480px of fixed-position UI, and scrolling
    // the thread underneath to "reveal" it is never what the user asked for.
    active.focus({ preventScroll: true })
    if (input && start !== null && end !== null) {
      input.setSelectionRange(start, end)
      return
    }
    if (range) {
      const next = window.getSelection()
      next?.removeAllRanges()
      next?.addRange(range)
    }
  }
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

  /**
   * ONE portal container for this instance's whole life, moved between parents
   * rather than swapped out — the fix for pop-out and dock-back clearing the
   * composer.
   *
   * `createPortal` keys off the container's *identity*, not its position in the
   * document, so moving this node is invisible to React and nothing unmounts.
   * `appendChild` MOVES existing DOM rather than recreating it, so Tiptap's
   * document and undo history, in-flight uploads, and every `useState` in the
   * composer (recipients above all — they are mirrored nowhere) come along.
   *
   * 🔴 Do not go back to `createPortal(el, target)` in one branch and a
   * `<motion.div>` in another. Those are different element types at the same
   * tree position, so React tears the composer down and re-derives it from the
   * store instance's props — which never learned anything the user typed.
   */
  const hostRef = useRef<HTMLDivElement | null>(null)
  if (hostRef.current === null && typeof document !== 'undefined') {
    hostRef.current = document.createElement('div')
  }
  const host = hostRef.current

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

  // Read during render, exactly as the old portal branch did: by the time an
  // inline instance exists, thread-details has already committed the target div
  // (it opens the instance from an effect, after that render), and dock-back only
  // fires for a target `canDockBack` just saw. A miss therefore means the target
  // is GONE — navigated away — and the composer presents as floating, which is
  // the same fallback as before, now a className swap instead of a remount.
  const inlineTarget =
    instance.displayMode === 'inline' && instance.portalTargetId
      ? document.getElementById(instance.portalTargetId)
      : null

  useLayoutEffect(() => {
    if (!host) return
    const parent = inlineTarget ?? document.body
    if (host.parentElement === parent) return
    const restoreFocus = preserveFocusAcrossMove(host)
    parent.appendChild(host)
    restoreFocus()
  }, [host, inlineTarget])

  // The host is ours, so it is ours to take with us.
  useEffect(() => () => host?.remove(), [host])

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

  // MINIMIZED MODE — the bar renders *beside* the editor, never instead of it.
  //
  // Swapping the tree for the bar unmounted the composer and took all of its
  // local state with it: recipients above all, which live only in
  // ReplyComposeEditor's `useState` and are mirrored nowhere. Nothing could
  // restore them on maximize either — autosave refuses the first save until the
  // body is non-empty, and even after a save the new draft id lands in the
  // editor's own state, not on the store instance the remount reads from. So a
  // minimize was a silent "clear the To field".
  //
  // Keeping it mounted under `display: none` preserves the body, attachments,
  // Cc/Bcc disclosure and the Tiptap selection with it, and costs nothing:
  // a hidden subtree lays out nothing and takes no pointer events.
  const isMinimized = instance.displayMode === 'minimized'
  const minimizedBar = isMinimized ? (
    <MinimizedBar
      instance={instance}
      stackIndex={instances
        .filter((i) => i.displayMode === 'minimized')
        .findIndex((i) => i.id === instance.id)}
      onMaximize={() => maximize(instance.id)}
      onClose={handleClose}
    />
  ) : null

  // Docked, the composer is a plain block in the thread's flow; undocked it is a
  // fixed, draggable panel. Same element either way — only the class changes.
  const floatingWidthClass = isChat
    ? 'fixed w-[min(380px,calc(100vw-32px))]'
    : 'fixed w-[min(480px,calc(100vw-32px))]'
  const isDocked = !!inlineTarget

  if (!host) return null

  return createPortal(
    <>
      {minimizedBar}
      <motion.div
        className={cn(!isDocked && floatingWidthClass, isMinimized && 'hidden')}
        style={{
          bottom: `calc(16px + ${instance.position.y}px)`,
          right: `calc(16px + ${instance.position.x}px)`,
          zIndex: instance.zIndex,
          x: dragX,
          y: dragY,
        }}
        // Docked, this element is inside the thread's scroll container, and motion
        // stamps `touch-action: none` on anything draggable — which would eat
        // touch scrolling over the composer. It has no drag handle when docked
        // anyway (`dragHandleProps` is floating-only).
        drag={!isDocked}
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
        // Stacking order is a floating-window concern; a docked composer has no
        // siblings to be behind, and raising it on every click is a store write.
        onPointerDown={isDocked ? undefined : () => bringToFront(instance.id)}>
        {editorElement}
      </motion.div>
    </>,
    host
  )
}
