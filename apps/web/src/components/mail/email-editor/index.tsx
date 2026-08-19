// apps/web/src/components/mail/email-editor/index.tsx
'use client'
import type { IdentifierType } from '@auxx/database/types'
import { PLATFORM_CAPABILITIES, type PlatformCapabilities } from '@auxx/lib/channels/client'
import type { DraftActionPayload } from '@auxx/lib/quick-actions/client'
import { type ParticipantRole, toParticipantId } from '@auxx/types'
import { toRecordId } from '@auxx/types/resource'
import { Badge } from '@auxx/ui/components/badge'
import { Button } from '@auxx/ui/components/button'
import { Separator } from '@auxx/ui/components/separator'
import { toastError, toastSuccess } from '@auxx/ui/components/toast'
import { cn } from '@auxx/ui/lib/utils'
import { generateId } from '@auxx/utils'
import { stableStringify } from '@auxx/utils/json'
import type { JSONContent } from '@tiptap/core'
import {
  ArrowDownLeft,
  ArrowUpRight,
  Loader2,
  Mail,
  MessageSquare,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { channelLabel } from '~/components/channels/channel-label'
import { useChannel, useChannels } from '~/components/channels/hooks/use-channels'
import { useDefaultChannelId } from '~/components/channels/hooks/use-default-channel'
import { EditorToolbar } from '~/components/editor/editor-button'
import { EditorProvider, useEditorContext } from '~/components/editor/editor-context'
import { type ContentApplier, makeContentApplier } from '~/components/editor/inline-picker'
import { useCountUpdates } from '~/components/mail/hooks'
import { useSuppressionCheck } from '~/components/mail/hooks/use-suppression-check'
import { useComposeStore } from '~/components/mail/store/compose-store'
import { ChannelPicker } from '~/components/pickers/channel-picker'
import { SignatureAddButton, SignaturePanel } from '~/components/signatures/ui'
import {
  appendOptimisticMessage,
  toAttachmentMeta,
} from '~/components/threads/hooks/append-optimistic-message'
import { useThreadEnvelopeCounterparty } from '~/components/threads/hooks/use-thread-envelope-counterparty'
import type { MessageMeta } from '~/components/threads/store/message-store'
import { useParticipantStore } from '~/components/threads/store/participant-store'
import { getThreadStoreState } from '~/components/threads/store/thread-store'
import { useAnalytics } from '~/hooks/use-analytics'
import { useConfirm } from '~/hooks/use-confirm'
import { useDebouncedCallback } from '~/hooks/use-debounced-value'
// Local imports
import { api } from '~/trpc/react'
import {
  AttachmentStrip,
  ComposerBody,
  INTERACTIVE_ELEMENT_SELECTORS,
  isAiToneType,
  isContentEmpty,
  useComposerAITools,
  useComposerAttachments,
} from '../composer-shared'
import { AddAttachmentButton } from './add-attachment-button'
import { AIStatus } from './ai-status'
import { deriveInitialState, type InitState } from './derive-initial'
import {
  EditorActiveStateProvider,
  useEditorActiveStateContext,
} from './editor-active-state-context'
import { useDraftMutations } from './hooks'
import { getIdentifierModel, regionFromIdentifier } from './identifier-model'
import type { MailReferenceConfig } from './mail-slash-content'
import { smsLength } from './message-length'
import PrevMessage from './prev-message'
import { AddActionButton, QuickActionPanel } from './quick-action-panel'
import { type RecipientField, RecipientInput, type RecipientInputHandle } from './recipient-input'
import { formatDroppedList, reconcileDraftForChannel } from './reconcile-channel-switch'
import { switchRecipientIdentifier } from './switch-recipient-identifier'
import type {
  ParticipantInputData,
  RecipientState,
  Recipients,
  ReplyComposeEditorProps,
} from './types'
import { useDraftAutosave } from './use-draft-autosave'

/**
 * Convert recipients array to mutation payload format
 */
const toPayload = (recipients: RecipientState[]): ParticipantInputData[] =>
  recipients.map((r) => ({
    identifier: r.identifier,
    identifierType: r.identifierType,
    name: r.name || undefined,
  }))

function htmlToSnippet(html: string, maxLen = 140): string {
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text
}

function ReplyComposeEditorComponent({
  thread,
  sourceMessage,
  draft: initialDraft,
  mode,
  onClose,
  onSendSuccess,
  presetValues,
  isDialogMode = false,
  onPopOut,
  onMinimize,
  onDockBack,
  onSubjectChange,
  instanceId,
  dragHandleProps,
}: ReplyComposeEditorProps) {
  // Z-index override for popovers when editor is in floating mode (above compose at z-101+)
  const popoverZIndex = isDialogMode ? 'z-[200]' : undefined

  const utils = api.useUtils()
  const { editor } = useEditorContext()
  const activeState = useEditorActiveStateContext()
  const pendingFocus = useComposeStore((s) =>
    instanceId ? (s.instances.find((i) => i.id === instanceId)?.pendingFocus ?? false) : false
  )
  const clearPendingFocus = useComposeStore((s) => s.clearPendingFocus)
  const recordSavedDraft = useComposeStore((s) => s.recordSavedDraft)

  // Auto-focus editor when opened via reply action (not draft auto-open)
  useEffect(() => {
    if (pendingFocus && editor && !editor.isDestroyed && instanceId) {
      editor.commands.focus('end')
      clearPendingFocus(instanceId)
    }
  }, [pendingFocus, editor, instanceId, clearPendingFocus])

  const [confirm, ConfirmDialog] = useConfirm()
  const posthog = useAnalytics()
  const { onSendDraft } = useCountUpdates()

  // Query integrations when needed
  const { data: integrations } = api.channel.list.useQuery(undefined, {
    enabled: mode === 'new',
  })
  // 'addressable' — the composer can address email OR phone, so a starred SMS
  // channel has to be honoured as the default. Falls back to email when the
  // user has never picked one (see the hook).
  const defaultIntegrationId = useDefaultChannelId('addressable')
  // Initialize state with pure function + lazy evaluation
  const [state, setState] = useState<InitState>(() => {
    const derived = deriveInitialState({
      mode,
      thread,
      sourceMessage,
      draft: initialDraft,
      defaultIntegrationId,
      presetValues,
    })
    return derived
  })
  // Unified recipients state
  const [recipients, setRecipients] = useState<Recipients>(() => ({
    TO: state.to,
    CC: state.cc,
    BCC: state.bcc,
  }))
  // Recipient input refs for pre-send commit
  const toInputRef = useRef<RecipientInputHandle>(null)
  const ccInputRef = useRef<RecipientInputHandle>(null)
  const bccInputRef = useRef<RecipientInputHandle>(null)

  // Suppression check (follow-ups plan decision 9) — informational only, does not block send:
  // server-side enforcement only blocks automated sends, so a human 1:1 send still goes through.
  const suppressedToRecipients = useSuppressionCheck(recipients.TO)
  const suppressionWarningText = useMemo(() => {
    const [first, ...rest] = suppressedToRecipients
    if (!first) return null
    const reasonCopy =
      first.reason === 'bounce'
        ? `${first.email} previously bounced — automated sends are blocked; this send will still go through`
        : `${first.email} has unsubscribed — automated sends are blocked; this send will still go through`
    return rest.length > 0 ? `${reasonCopy} (+${rest.length} more)` : reasonCopy
  }, [suppressedToRecipients])

  // Resolve PlatformCapabilities for the currently-selected integration. The
  // composer renders the same Tiptap surface for every channel; capability
  // flags decide which header fields and quoted-reply UI to show.
  const selectedChannel = useChannel(state.integrationId)
  const selectedChannelFromList = useMemo(() => {
    if (selectedChannel || !integrations?.channels || !state.integrationId) return undefined
    return integrations.channels.find((c) => c.id === state.integrationId)
  }, [selectedChannel, integrations, state.integrationId])
  const providerKey = (selectedChannel?.provider ?? selectedChannelFromList?.provider) as
    | keyof typeof PLATFORM_CAPABILITIES
    | undefined
  const platformCaps: PlatformCapabilities | undefined = providerKey
    ? PLATFORM_CAPABILITIES[providerKey]
    : undefined
  const isEmailChannel = platformCaps ? platformCaps.channel === 'email' : true
  const showSubjectField = platformCaps ? platformCaps.subject : true
  const showCcBccToggle = platformCaps ? platformCaps.ccBcc : true
  const showRecipientField = platformCaps
    ? platformCaps.recipientModel !== 'thread_only' &&
      platformCaps.recipientModel !== 'platform_user'
    : true
  const showQuotedReply = isEmailChannel
  // Region for parsing typed phone numbers, taken from the number we are sending
  // FROM. More correct than an org-level setting: an org holding a German and a
  // US number should read `030 901820` differently depending on which one is
  // selected. Falls back to US when the channel has no parseable E.164 number
  // (every email channel, which never reaches the phone spec anyway).
  const phoneRegion = useMemo(
    () => regionFromIdentifier(selectedChannel?.identifier ?? selectedChannelFromList?.identifier),
    [selectedChannel, selectedChannelFromList]
  )
  // Every flag below defaults TRUE with no resolved channel — the composer is
  // an email composer until a capability map says otherwise.
  const supportsRichText = platformCaps ? platformCaps.richText : true
  const supportsSignature = platformCaps ? platformCaps.signature : true
  const supportsAttachments = platformCaps ? platformCaps.attachments : true
  const maxMessageLength = platformCaps?.maxMessageLength

  // Whether the From channel can be changed at all.
  //
  // A thread is a conversation on ONE channel. Its participants are identifiers
  // in that channel's address space, so switching an SMS thread to an email
  // channel does not produce an email to the same person — it produces a send
  // with no valid recipient. The reply is pinned to the channel the thread
  // arrived on.
  //
  // Email is the exception, and only within email: a mail thread can legitimately
  // be answered from a different mailbox or alias (reply from support@ rather
  // than the alias it landed on), so email threads keep a picker scoped to
  // `'email'` — a different mailbox, never a different channel class.
  //
  // New compose is the only place a channel class is genuinely open, and it is
  // the only caller that reaches `reconcileDraftForChannel`. An earlier draft of
  // this design assumed reply mode was already pinned; it was not — the picker
  // was live in every mode with `disabled={isSending}` as its only gate.
  const isNewCompose = mode === 'new'
  const canSwitchChannel = isNewCompose || isEmailChannel

  // A conversational channel's composer is always on — `useReplyBox` re-opens it
  // the instant it closes (see `channelUsesAlwaysOnComposer`), so an inline X
  // discards the draft and immediately gets a fresh empty composer back. That is
  // a flicker, not an exit, so the button is not offered.
  //
  // Floating/dialog mode keeps it: there the X is a window control
  // (`handleCloseClick`, no discard) and closing genuinely puts the composer
  // away.
  const showCloseButton = isDialogMode || isEmailChannel
  // Same rule as the picker's badge, so a pinned From and a switchable From read
  // identically: an address where the channel has one, the account's display
  // name where `identifier` is an opaque routing id (Meta Page id / IG account
  // id). Reading `identifier` unconditionally, as this did, put a bare Page
  // number in the From row of every Facebook and Instagram reply.
  const pinnedChannelRow = selectedChannel ?? selectedChannelFromList
  const pinnedChannelLabel = pinnedChannelRow ? channelLabel(pinnedChannelRow) : 'Unknown channel'

  // Every channel this org can send from, so a From switch can resolve the
  // INCOMING channel's capabilities (the memo above only covers the current
  // one). `integrations` is the new-compose fallback before the store hydrates.
  const allChannels = useChannels()
  const capabilitiesForIntegration = useCallback(
    (integrationId: string): PlatformCapabilities | undefined => {
      const provider = (allChannels.find((c) => c.id === integrationId)?.provider ??
        integrations?.channels?.find((c) => c.id === integrationId)?.provider) as
        | keyof typeof PLATFORM_CAPABILITIES
        | undefined
      return provider ? PLATFORM_CAPABILITIES[provider] : undefined
    },
    [allChannels, integrations]
  )

  // Other UI state — canonical content model is Tiptap JSON (HTML at send time).
  const [content, setContent] = useState<JSONContent>(state.contentJson)
  const [showCc, setShowCc] = useState(state.cc.length > 0)
  const [showBcc, setShowBcc] = useState(state.bcc.length > 0)
  const [showSubject, setShowSubject] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isDraftSaved, setIsDraftSaved] = useState(!!initialDraft)
  const [showNoToWarning, setShowNoToWarning] = useState(false)

  // The rule under From is the divider ABOVE the next header row — Cc, Bcc and
  // Subject each bring their own leading one, so From only owns the divider that
  // introduces To. On a channel with neither (Facebook/Instagram are
  // `thread_only`, chat is `platform_user`, and all three are `subject: false`)
  // there is no next row, and the rule stacked against the header block's own
  // bottom border as a double line.
  const showFromSeparator = showRecipientField || (showSubjectField && showSubject)

  // Mark the draft dirty so autosave picks up changes.
  const markDraftDirty = useCallback(() => setIsDraftSaved(false), [])

  // Attachments + file uploads + dropzone + persisted/in-progress merge.
  // Entity id is pinned to the draft id (or a static temp id) so files uploaded
  // before the draft exists associate correctly.
  const { attachments, setAttachments, fileSelect, allAttachments, removeAttachment, dropzone } =
    useComposerAttachments({
      initialAttachments: initialDraft?.attachments ?? [],
      entityId: state.draftId ?? undefined,
      onDirty: markDraftDirty,
    })

  // Quick actions state - persisted in draft content
  const [quickActions, setQuickActions] = useState<DraftActionPayload[]>(
    () => (initialDraft?.actions as DraftActionPayload[]) ?? []
  )

  // Sync state when draft prop changes (e.g., navigating back to thread with existing draft)
  const initializedDraftIdRef = useRef<string | null>(initialDraft?.id ?? null)
  useEffect(() => {
    // Only sync if draft ID changed and we have a new draft
    if (initialDraft && initialDraft.id !== initializedDraftIdRef.current) {
      initializedDraftIdRef.current = initialDraft.id

      const newState = deriveInitialState({
        mode,
        thread,
        sourceMessage,
        draft: initialDraft,
        defaultIntegrationId,
        presetValues,
      })

      setState(newState)
      setContent(newState.contentJson)
      setRecipients({
        TO: newState.to,
        CC: newState.cc,
        BCC: newState.bcc,
      })
      setShowCc(newState.cc.length > 0)
      setShowBcc(newState.bcc.length > 0)
      // Sync attachments and actions from draft
      setAttachments(initialDraft.attachments ?? [])
      setQuickActions((initialDraft.actions as DraftActionPayload[]) ?? [])
      setIsDraftSaved(true) // Draft was loaded from server
    }
  }, [initialDraft, mode, thread, sourceMessage, integrations, presetValues])

  // Seed the recipient on an always-on composer.
  //
  // A composer opened by clicking Reply on a message derives its recipient from
  // that message. A conversational channel has no such click — the composer is
  // simply there — so `reply` mode with no `sourceMessage` would otherwise render
  // an empty To field on every SMS thread. Chat gets away with it only because
  // `recipientModel: 'thread_only'` hides the field entirely and the server
  // resolves the recipient from the thread; phone shows the field, so it has to
  // be filled here.
  //
  // Deliberately NOT `sourceMessage.from`: on a thread whose last message is
  // outbound that is US, which would address the reply to our own channel.
  // `useThreadEnvelopeCounterparty` is the same selection the thread title uses, so the
  // thread is addressed to exactly the person it is named after.
  //
  // Fires at most once per composer instance — clearing the chip is a deliberate
  // act and must not be undone by a re-render.
  // Only ever seed an identifier this channel can actually address. A thread's
  // participant set is not guaranteed to be single-model: an outbound SMS records
  // its FROM participant as the operator's login email today
  // (`participant-service.findOrCreateParticipantForIntegration` reads only
  // `Integration.email`, which is NULL on a phone channel), so counterparty
  // selection can hand back an EMAIL participant on a phone thread. Seeding that
  // would put an unsendable recipient in the To field and blame the user for it.
  // Guarding on the channel's own model means the seed degrades to empty rather
  // than to wrong.
  const threadCounterparty = useThreadEnvelopeCounterparty(thread?.id)
  const seededRecipientRef = useRef(false)
  useEffect(() => {
    if (seededRecipientRef.current || initialDraft || mode !== 'reply' || sourceMessage) return
    if (!threadCounterparty) return
    if (
      threadCounterparty.identifierType !==
      getIdentifierModel(platformCaps?.recipientModel).identifierType
    ) {
      return
    }
    seededRecipientRef.current = true
    setRecipients((prev) =>
      prev.TO.length > 0
        ? prev
        : {
            ...prev,
            TO: [
              {
                // `threadCounterparty.id` is a `Participant.id` — not a chip id.
                id: generateId(),
                identifier: threadCounterparty.identifier,
                identifierType: threadCounterparty.identifierType,
                name: threadCounterparty.name,
              },
            ],
          }
    )
  }, [threadCounterparty, initialDraft, mode, sourceMessage, platformCaps?.recipientModel])

  // Defensive sync: if quickActions is empty but initialDraft has actions, restore them.
  // Covers the case where the draft prop arrives with richer data after initial mount.
  const prevActionsRef = useRef(initialDraft?.actions)
  useEffect(() => {
    const incoming = initialDraft?.actions as DraftActionPayload[] | undefined
    if (
      incoming &&
      incoming.length > 0 &&
      quickActions.length === 0 &&
      incoming !== prevActionsRef.current
    ) {
      prevActionsRef.current = incoming
      setQuickActions(incoming)
    }
  }, [initialDraft?.actions, quickActions.length])

  // Handle preset attachments on initial mount (when no draft exists)
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (!initialDraft && presetValues?.attachments && presetValues.attachments.length > 0) {
      setAttachments(presetValues.attachments)
    }
  }, []) // Only run on mount

  // Track when user requested discard to handle late autosave completions
  const discardAfterSave = useRef(false)

  // Ref to store deleteDraft for use in onUpsertSuccess callback
  const deleteDraftRef = useRef<((draftId: string) => Promise<void>) | undefined>(undefined)

  // Draft mutations hook - centralizes upsert/delete with ThreadStore sync
  const { upsert, deleteDraft, isUpserting, isDeleting } = useDraftMutations({
    threadId: thread?.id ?? state.threadId,
    onUpsertSuccess: (data) => {
      // If user already clicked discard and we got a late save, delete the new draft
      if (discardAfterSave.current) {
        if (data?.id) {
          deleteDraftRef
            .current?.(data.id)
            .then(() => onClose())
            .finally(() => {
              discardAfterSave.current = false
            })
        } else {
          discardAfterSave.current = false
          onClose()
        }
        return
      }
      // Normal success - state is updated via autosave's onSaved callback
    },
    onUpsertError: (error) => {
      // If discard was requested, suppress save errors (draft likely deleted/not found)
      if (discardAfterSave.current) return
      // Error toast is handled by the hook
    },
    onDeleteMutate: (draftId) => {
      // Clear local draft state immediately (optimistic update)
      setState((prev) => ({ ...prev, draftId: null }))
      if (instanceId) recordSavedDraft(instanceId, null)
    },
    onDeleteError: (error, draftId) => {
      // Rollback on error
      setState((prev) => ({ ...prev, draftId }))
      if (instanceId) recordSavedDraft(instanceId, draftId)
      // Error toast is handled by the hook
    },
  })

  // Update ref after hook returns for use in onUpsertSuccess
  deleteDraftRef.current = deleteDraft

  const sendMessageMutation = api.thread.sendMessage.useMutation({
    onMutate: () => setIsSending(true),
    onSuccess: (sentMessage, variables) => {
      toastSuccess({ description: 'Message sent successfully' })

      // Draft cleanup (if sending from a draft)
      if (state.draftId) {
        // Tombstone: mark draft as not-found so useReplyBox skips fetch
        getThreadStoreState().markDraftNotFound(state.draftId)

        // Remove draft:<id> from thread's draftIds
        const threadId = thread?.id ?? state.threadId
        if (threadId) {
          const currentThread = getThreadStoreState().getThread(threadId)
          if (currentThread) {
            const recordId = `draft:${state.draftId}`
            getThreadStoreState().updateThread(threadId, {
              draftIds: currentThread.draftIds.filter((id) => id !== recordId),
            })
          }
        }

        // Clear tRPC cache for this draft
        utils.draft.getById.setData({ draftId: state.draftId }, undefined)

        // Decrement draft count
        onSendDraft()
      }

      if (sentMessage.threadId && sentMessage.id) {
        const sentAt = sentMessage.sentAt?.toISOString() ?? new Date().toISOString()
        const attachments = (variables.attachments ?? []).map(toAttachmentMeta)
        const optimistic: MessageMeta = {
          id: sentMessage.id,
          threadId: sentMessage.threadId,
          subject: sentMessage.subject ?? null,
          // Plain channels send no html — fall back to the text body so the
          // optimistic row isn't blank until the server echo lands.
          snippet: htmlToSnippet(variables.textHtml || variables.textPlain || ''),
          textHtml: variables.textHtml ?? null,
          textPlain: variables.textPlain ?? null,
          isInbound: false,
          isFirstInThread: false,
          hasAttachments: attachments.length > 0,
          hasHtmlBody: !!variables.textHtml,
          hasTextBody: !!variables.textPlain,
          sentAt,
          receivedAt: null,
          createdAt: sentAt,
          // Tag ids as `<role>:<id>` so the participant store + grouping render
          // from/to/cc immediately. Without this the optimistic row shows no
          // participants until the realtime echo / refetch lands.
          // `thread.sendMessage` returns `any` (the router widens its
          // sent/scheduled union), so this shape is stated locally. It mirrors
          // `SentMessage['participants']` in @auxx/lib.
          participants: (sentMessage.participants ?? []).map((p: { id: string; role: string }) =>
            toParticipantId(p.role.toLowerCase() as ParticipantRole, p.id)
          ),
          createdById: null,
          sendStatus: 'SENT',
          providerError: null,
          attempts: 1,
          attachments,
          // Must match what the server will echo. `Message.messageType` is not
          // stored — `message-query.service` derives it from the channel's
          // provider on every read — so hardcoding EMAIL here rendered a
          // just-sent SMS through `EmailDisplay` until the echo landed and
          // flipped it to a bubble.
          //
          // `PlatformCapabilities.messageType` and the store's `MessageMeta.messageType`
          // now share the same five-member vocabulary, so no cast is needed here.
          messageType: platformCaps?.messageType ?? 'EMAIL',
        }
        appendOptimisticMessage(utils, sentMessage.threadId, optimistic)

        // A compose that opened a NEW thread has to refresh the thread list here, in the
        // originating tab. The server's `thread:created` cannot do it: that publish carries
        // `excludeSocketId` for this socket (self-echo suppression), so the one tab guaranteed to
        // care is the one guaranteed not to be told. Cheap and idempotent on a reply, where the
        // thread is already in the list.
        if (!getThreadStoreState().getThread(sentMessage.threadId)) {
          utils.thread.listIds.invalidate()
        }
      }

      onSendSuccess()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Failed to send message', description: error.message })
    },
    onSettled: () => setIsSending(false),
  })

  const executeQuickActions = api.quickAction.execute.useMutation()

  const scheduleMessageMutation = api.thread.sendMessage.useMutation({
    onMutate: () => setIsSending(true),
    onSuccess: (data) => {
      toastSuccess({ description: 'Message scheduled' })

      const threadId = thread?.id ?? state.threadId

      // Optimistically increment scheduledMessageCount on thread
      if (threadId) {
        const currentThread = getThreadStoreState().getThread(threadId)
        if (currentThread) {
          getThreadStoreState().updateThread(threadId, {
            scheduledMessageCount: (currentThread.scheduledMessageCount ?? 0) + 1,
          })
        }

        // Invalidate detail query so conversation view refreshes
        utils.thread.getScheduledMessages.invalidate({ threadId })
      }

      // Remove draft from thread's draftIds (scheduled drafts shouldn't show as active drafts)
      if (state.draftId && threadId) {
        const currentThread = getThreadStoreState().getThread(threadId)
        if (currentThread) {
          const recordId = `draft:${state.draftId}`
          getThreadStoreState().updateThread(threadId, {
            draftIds: currentThread.draftIds.filter((id) => id !== recordId),
          })
        }
      }

      // For standalone drafts, update scheduledAt on the draft item
      if (state.draftId && !threadId && (data as any)?.scheduledAt) {
        getThreadStoreState().updateDraft(state.draftId, {
          scheduledAt: new Date((data as any).scheduledAt).toISOString(),
        })
      }

      onSendSuccess()
      onClose()
    },
    onError: (error) => {
      toastError({ title: 'Failed to schedule message', description: error.message })
    },
    onSettled: () => setIsSending(false),
  })

  // Debounced delete to prevent double-click issues
  const debouncedDelete = useDebouncedCallback(
    (draftId: string) => {
      deleteDraft(draftId)
        .then(() => {
          // Clear any pending saves
          draftAutosave.abort()
        })
        .finally(() => {
          // Reset the flag even if delete failed; UI already closed
          discardAfterSave.current = false
        })
    },
    300,
    { leading: true, trailing: false } // fire immediately; ignore rapid subsequent clicks
  )
  // Prepare payload for autosave — attachments come from the shared hook's
  // persisted + ready-upload merge.
  const draftPayload = useMemo(() => {
    return {
      threadId: state.threadId,
      integrationId: state.integrationId,
      inReplyToMessageId: state.sourceMessageId,
      includePreviousMessage: state.includePrev,
      subject: state.subject,
      bodyJson: content,
      textPlain: editor?.getText() ?? '',
      signatureId: state.signatureId,
      to: toPayload(recipients.TO),
      cc: toPayload(recipients.CC),
      bcc: toPayload(recipients.BCC),
      attachments: allAttachments,
      actions: quickActions.length > 0 ? quickActions : undefined,
      draftId: state.draftId,
    }
  }, [state, content, editor, recipients, allAttachments, quickActions])
  const draftAutosave = useDraftAutosave({
    enabled: !isSending && !!state.integrationId,
    payload: draftPayload,
    isEmpty: () => isContentEmpty(editor),
    createOrUpdateDraft: upsert,
    onSaved: ({ draftId, threadId }) => {
      setState((prev) => {
        const nextThreadId = threadId ?? prev.threadId
        // Only update if something actually changed to prevent infinite loops
        if (prev.draftId === draftId && prev.threadId === nextThreadId) {
          return prev
        }
        // Track email_draft_created when a draft is first saved
        if (!prev.draftId && draftId) {
          posthog?.capture('email_draft_created')
        }
        return { ...prev, draftId, threadId: nextThreadId }
      })
      // Tell the store which draft this composer now owns, so opening that draft
      // from the drafts list raises THIS window instead of opening a second one
      // onto the same draft (`findByDraft`). Not written into the instance's
      // `draft` — see the note on `savedDraftId`.
      if (instanceId) recordSavedDraft(instanceId, draftId)
      setIsDraftSaved(true)
    },
    onCacheSync: ({ threadId, draftData }) => {},
  })
  // Recipient management
  const upsertRecipient = useCallback((role: keyof Recipients, recipient: RecipientState) => {
    setRecipients((prev) => {
      const list = prev[role]
      if (list.some((r) => r.identifier === recipient.identifier)) return prev
      return { ...prev, [role]: [...list, recipient] }
    })
    if (role === 'TO') setShowNoToWarning(false)
    setIsDraftSaved(false)
  }, [])
  const removeRecipient = useCallback((role: keyof Recipients, id: string) => {
    setRecipients((prev) => ({
      ...prev,
      [role]: prev[role].filter((r) => r.id !== id),
    }))
    setIsDraftSaved(false)
  }, [])
  // Imperative content writes (AI tools, undo/redo) route through this
  // applier so a duplicate write is a no-op. The handler below stamps the
  // applier with every user edit so subsequent imperative writes of the
  // same HTML short-circuit.
  const contentApplier = useMemo<ContentApplier<string | object>>(
    () =>
      makeContentApplier<string | object>(
        editor,
        (e, content) => {
          e.commands.setContent(content as Parameters<typeof e.commands.setContent>[0])
        },
        (content) => (typeof content === 'string' ? content : stableStringify(content))
      ),
    [editor]
  )

  // Handlers
  const handleContentChange = useCallback(
    (newContent: JSONContent) => {
      setContent(newContent)
      contentApplier.markLocalEdit(stableStringify(newContent))
      setIsDraftSaved(false)
    },
    [contentApplier]
  )
  const handleSubjectChange = useCallback(
    (subject: string) => {
      setState((prev) => ({ ...prev, subject }))
      setIsDraftSaved(false)
      onSubjectChange?.(subject)
    },
    [onSubjectChange]
  )
  const handleSignatureChange = useCallback((signatureId: string | null) => {
    setState((prev) => ({ ...prev, signatureId }))
    setIsDraftSaved(false)
  }, [])

  // `@` menu wiring — reuses the SAME setters as the belowEditor signature /
  // quick-action panels, so the two entry points stay in sync automatically.
  const references = useMemo<MailReferenceConfig>(
    () => ({
      signatureId: state.signatureId,
      onSignatureChange: handleSignatureChange,
      actionIds: quickActions.map((a) => a.actionId),
      onAddAction: (action) => setQuickActions((prev) => [...prev, action]),
      onRemoveAction: (actionId) =>
        setQuickActions((prev) => prev.filter((a) => a.actionId !== actionId)),
      threadId: thread?.id || state.threadId || undefined,
    }),
    [state.signatureId, state.threadId, handleSignatureChange, quickActions, thread?.id]
  )
  /**
   * Switching From can invalidate the draft. Fields the target channel cannot
   * carry are CLEARED from state — hiding them is not enough, because the send
   * handlers read `state`, not what is rendered, so a hidden subject/cc still
   * ships. Recipients are re-validated against the incoming identifier model and
   * whatever fails to normalize is dropped, with one toast naming the loss.
   *
   * Reply mode never reaches the interesting branch: From is pinned to the
   * thread's channel, so the recipient model cannot change mid-draft.
   */
  const handleIntegrationChange = useCallback(
    (integrationId: string) => {
      setIsDraftSaved(false)
      const incoming = capabilitiesForIntegration(integrationId)
      // Same identifier shape (or an unresolvable channel) — nothing to reconcile.
      if (!incoming || !platformCaps || incoming.recipientModel === platformCaps.recipientModel) {
        setState((prev) => ({ ...prev, integrationId }))
        return
      }
      const outcome = reconcileDraftForChannel({
        draft: {
          recipients,
          subject: state.subject,
          signatureId: state.signatureId,
          attachmentCount: allAttachments.length,
        },
        incoming,
        spec: getIdentifierModel(incoming.recipientModel),
      })
      setRecipients(outcome.recipients)
      setState((prev) => ({
        ...prev,
        integrationId,
        subject: outcome.subject,
        signatureId: outcome.signatureId,
      }))
      if (outcome.clearAttachments) {
        setAttachments([])
        fileSelect.clearItems()
      }
      if (outcome.recipients.CC.length === 0) setShowCc(false)
      if (outcome.recipients.BCC.length === 0) setShowBcc(false)
      if (outcome.dropped.length > 0) {
        toastError({
          title: 'Draft updated for this channel',
          description: `Dropped ${formatDroppedList(outcome.dropped)}.`,
        })
      }
    },
    [
      capabilitiesForIntegration,
      platformCaps,
      recipients,
      state.subject,
      state.signatureId,
      allAttachments.length,
      setAttachments,
      fileSelect,
    ]
  )
  const handleContactSelect = useCallback(
    (
      role: 'TO' | 'CC' | 'BCC',
      contactData: {
        /** `null` for a participant never linked to a contact record. */
        recordId: string | null
        identifier: string
        identifierType: IdentifierType
        name?: string | null
      }
    ) => {
      // The chip id is minted here; the contact's id goes to `recordId`. Writing
      // the record id into `id` made two addresses of one contact collide — see
      // the note on `RecipientState.id`.
      upsertRecipient(role, {
        id: generateId(),
        identifier: contactData.identifier,
        identifierType: contactData.identifierType,
        name: contactData.name,
        recordId: contactData.recordId ?? undefined,
      })
    },
    [upsertRecipient]
  )
  const handleMoveTo = useCallback(
    (fromField: RecipientField, id: string, target: RecipientField) => {
      setRecipients((prev) => {
        const recipient = prev[fromField].find((r) => r.id === id)
        if (!recipient) return prev
        if (prev[target].some((r) => r.identifier === recipient.identifier)) {
          return { ...prev, [fromField]: prev[fromField].filter((r) => r.id !== id) }
        }
        return {
          ...prev,
          [fromField]: prev[fromField].filter((r) => r.id !== id),
          [target]: [...prev[target], recipient],
        }
      })
      if (target === 'CC') setShowCc(true)
      if (target === 'BCC') setShowBcc(true)
      if (target === 'TO') setShowNoToWarning(false)
      setIsDraftSaved(false)
    },
    []
  )
  /**
   * Switch ONE chip to another of the same contact's addresses, in place — the
   * chip keeps its `id`, its field and its position. The rule itself lives in
   * {@link switchRecipientIdentifier}, which returns the same object on a no-op
   * so a refused switch re-renders nothing.
   */
  const handleSwitchIdentifier = useCallback(
    (
      role: keyof Recipients,
      id: string,
      next: { identifier: string; identifierType: IdentifierType }
    ) => {
      setRecipients((prev) => switchRecipientIdentifier(prev, role, id, next))
      setIsDraftSaved(false)
    },
    []
  )
  // Calculate if editor has content
  // biome-ignore lint/correctness/useExhaustiveDependencies: content triggers recalculation when editor content changes
  const hasContent = useMemo(() => {
    if (!editor) return false
    return !isContentEmpty(editor)
  }, [editor, content])
  // Character/segment counter for capped channels. Segments are the billing
  // unit and one emoji drops them from 160 to 70 characters, so both numbers
  // are worth showing.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content triggers recalculation when editor content changes
  const lengthInfo = useMemo(() => {
    if (!maxMessageLength) return null
    const body = editor?.getText()?.trim() ?? ''
    const { characters, segments, unicode } = smsLength(body)
    return {
      characters,
      segments,
      unicode,
      remaining: maxMessageLength - characters,
      over: characters > maxMessageLength,
    }
  }, [editor, content, maxMessageLength])
  // Check if thread has previous messages
  const hasPreviousMessages = useMemo(() => {
    if (!thread) return false
    return (thread.messageCount ?? 0) > 0
  }, [thread])
  // AI Tools — shared state + compose wiring, with email's posthog analytics
  // and the contentApplier-backed write-back (so duplicate writes no-op).
  const aiTicketId = thread?.id || state.threadId || undefined
  const {
    state: aiToolsState,
    undo,
    redo,
    canUndo,
    canRedo,
    handleAIOperation,
  } = useComposerAITools({
    editor,
    entityId: thread?.id || state.threadId || '',
    applyContent: (content) => contentApplier.apply(content),
    onContentChanged: handleContentChange,
    analytics: {
      onComposeStarted: () => posthog?.capture('ai_compose_started', { ticket_id: aiTicketId }),
      onComposeCompleted: (durationMs) =>
        posthog?.capture('ai_compose_completed', {
          ticket_id: aiTicketId,
          duration_ms: durationMs,
        }),
      onComposeFailed: (error) =>
        posthog?.capture('ai_compose_failed', { ticket_id: aiTicketId, error }),
      onToolUsed: (operation, tone, language) =>
        posthog?.capture('ai_tool_used', { operation, tone, language }),
    },
  })

  // Wrapped undo handler with analytics tracking
  const handleUndo = useCallback(() => {
    undo()
    posthog?.capture('ai_change_undone')
  }, [undo, posthog])
  const handleSendClick = useCallback(async () => {
    if (isSending || !editor?.isEditable) return
    // 0. Commit any pending recipient input before validation
    flushSync(() => {
      toInputRef.current?.commitPendingInput()
      ccInputRef.current?.commitPendingInput()
      bccInputRef.current?.commitPendingInput()
    })
    // 1. Set sending state immediately to prevent new autosaves
    setIsSending(true)
    // 2. Cancel any pending debounced saves
    draftAutosave.abort()
    try {
      // 3. Wait for any in-flight save to complete
      if (isUpserting) {
        try {
          const result = await upsert(draftPayload)
          if (result?.id) {
            setState((prev) => ({
              ...prev,
              draftId: result.id,
              threadId: result.threadId || prev.threadId,
            }))
          }
        } catch (error) {
          // If save fails, continue without draft ID
          console.warn('Draft save failed during send, continuing without draft ID', error)
        }
      }
      // 4. Validation
      if (!state.integrationId) {
        toastError({
          title: 'Missing Integration',
          description: 'Please select an integration to send from.',
        })
        setIsSending(false)
        return
      }
      if (showRecipientField && recipients.TO.length === 0) {
        setShowNoToWarning(true)
        setIsSending(false)
        return
      }
      if (showSubjectField && !state.subject.trim()) {
        toastError({ title: 'Missing Subject', description: 'Please enter a subject.' })
        setIsSending(false)
        return
      }
      const plainContent = editor?.getText()?.trim() ?? ''
      if (!plainContent) {
        toastError({
          title: 'Empty Message',
          description: 'Please enter some content before sending.',
        })
        setIsSending(false)
        return
      }
      if (maxMessageLength && plainContent.length > maxMessageLength) {
        toastError({
          title: 'Message too long',
          description: `This channel accepts ${maxMessageLength} characters; yours is ${plainContent.length}.`,
        })
        setIsSending(false)
        return
      }
      // 5. Execute quick actions before sending (blocking)
      if (quickActions.length > 0) {
        const confirmed = await confirm({
          title: 'Send & execute actions',
          description: `This will send your reply and execute ${quickActions.length} action${quickActions.length > 1 ? 's' : ''}: ${quickActions.map((a) => a.display.summary || a.display.label).join(', ')}`,
          confirmText: 'Send & Execute',
          cancelText: 'Cancel',
        })

        if (!confirmed) {
          setIsSending(false)
          return
        }

        try {
          const results = await executeQuickActions.mutateAsync({
            actions: quickActions,
            context: { threadId: thread?.id },
          })

          const failed = results.filter((r: { success: boolean }) => !r.success)
          if (failed.length > 0) {
            toastError({
              title: 'Action failed',
              description:
                (failed[0] as { error?: string }).error ?? 'An action failed. Email was not sent.',
            })
            setIsSending(false)
            return
          }
        } catch (error) {
          toastError({
            title: 'Action failed',
            description: error instanceof Error ? error.message : 'Failed to execute actions.',
          })
          setIsSending(false)
          return
        }
      }

      // 6. Send with draft ID if available
      sendMessageMutation.mutate({
        threadId: thread?.id,
        integrationId: state.integrationId,
        draftMessageId: state.draftId, // Will be null if no draft was created
        // Belt and braces alongside the From-switch reconcile: a draft restored
        // onto a channel that cannot carry these still holds them in `state`,
        // and `handleIntegrationChange` never ran for that path.
        subject: showSubjectField ? state.subject : '',
        // A plain channel sends NO html: it is meaningless on the wire (Quo
        // posts `content` as text) and storing it would make the thread view
        // render marks that were never sent. `message-display` falls through to
        // `textPlain`, which is therefore mandatory here — `MessageSenderService`
        // rejects a send with neither body.
        textHtml: supportsRichText ? (editor?.getHTML() ?? '') : null,
        textPlain: supportsRichText ? undefined : plainContent,
        signatureId: supportsSignature ? state.signatureId : null,
        to: toPayload(recipients.TO),
        cc: toPayload(recipients.CC),
        bcc: toPayload(recipients.BCC),
        attachments: supportsAttachments ? draftPayload.attachments : [],
        includePreviousMessage: state.includePrev,
        linkTicketId: presetValues?.linkTicketId,
      })
    } catch (error) {
      setIsSending(false) // Reset on error
      throw error
    }
  }, [
    isSending,
    editor,
    state,
    recipients,
    thread?.id,
    sendMessageMutation,
    draftPayload,
    draftAutosave,
    upsert,
    isUpserting,
    quickActions,
    confirm,
    supportsRichText,
    supportsSignature,
    supportsAttachments,
    showSubjectField,
    maxMessageLength,
  ])
  const handleScheduleClick = useCallback(
    async (scheduledAt: Date) => {
      if (isSending || !editor?.isEditable) return
      flushSync(() => {
        toInputRef.current?.commitPendingInput()
        ccInputRef.current?.commitPendingInput()
        bccInputRef.current?.commitPendingInput()
      })
      setIsSending(true)
      draftAutosave.abort()
      try {
        if (isUpserting) {
          try {
            const result = await upsert(draftPayload)
            if (result?.id) {
              setState((prev) => ({
                ...prev,
                draftId: result.id,
                threadId: result.threadId || prev.threadId,
              }))
            }
          } catch (error) {
            console.warn('Draft save failed during schedule, continuing without draft ID', error)
          }
        }
        if (!state.integrationId) {
          toastError({
            title: 'Missing Integration',
            description: 'Please select an integration to send from.',
          })
          setIsSending(false)
          return
        }
        if (showRecipientField && recipients.TO.length === 0) {
          setShowNoToWarning(true)
          setIsSending(false)
          return
        }
        if (showSubjectField && !state.subject.trim()) {
          toastError({ title: 'Missing Subject', description: 'Please enter a subject.' })
          setIsSending(false)
          return
        }
        const plainContent = editor?.getText()?.trim() ?? ''
        if (!plainContent) {
          toastError({
            title: 'Empty Message',
            description: 'Please enter some content before sending.',
          })
          setIsSending(false)
          return
        }
        if (maxMessageLength && plainContent.length > maxMessageLength) {
          toastError({
            title: 'Message too long',
            description: `This channel accepts ${maxMessageLength} characters; yours is ${plainContent.length}.`,
          })
          setIsSending(false)
          return
        }
        // See `handleSendClick` — plain channels send textPlain and no html.
        scheduleMessageMutation.mutate({
          threadId: thread?.id,
          integrationId: state.integrationId,
          draftMessageId: state.draftId,
          subject: showSubjectField ? state.subject : '',
          textHtml: supportsRichText ? (editor?.getHTML() ?? '') : null,
          textPlain: supportsRichText ? undefined : plainContent,
          signatureId: supportsSignature ? state.signatureId : null,
          to: toPayload(recipients.TO),
          cc: toPayload(recipients.CC),
          bcc: toPayload(recipients.BCC),
          attachments: supportsAttachments ? draftPayload.attachments : [],
          includePreviousMessage: state.includePrev,
          linkTicketId: presetValues?.linkTicketId,
          scheduledAt,
        })
      } catch (error) {
        setIsSending(false)
        throw error
      }
    },
    [
      isSending,
      editor,
      state,
      recipients,
      thread?.id,
      scheduleMessageMutation,
      draftPayload,
      draftAutosave,
      upsert,
      isUpserting,
      supportsRichText,
      supportsSignature,
      supportsAttachments,
      showSubjectField,
      maxMessageLength,
    ]
  )
  const handleDiscardClick = useCallback(async () => {
    if (isSending || isDeleting) return

    // Only confirm if there's a draft with content
    const hasContent = state.draftId || !isContentEmpty(editor)

    if (hasContent) {
      const confirmed = await confirm({
        title: 'Discard draft?',
        description: 'This draft will be permanently deleted.',
        confirmText: 'Discard',
        cancelText: 'Cancel',
        destructive: true,
      })
      if (!confirmed) return
    }

    // Abort any pending autosaves immediately
    discardAfterSave.current = true
    draftAutosave.abort()
    if (state.draftId) {
      // Use debounced delete to prevent double-clicks
      debouncedDelete(state.draftId)
    }
    // Close immediately for instant UX feedback
    onClose()
  }, [
    state.draftId,
    isSending,
    isDeleting,
    onClose,
    draftAutosave,
    debouncedDelete,
    editor,
    confirm,
  ])

  /** Close without deleting draft (used in dialog mode) */
  const handleCloseClick = useCallback(() => {
    onClose()
  }, [onClose])
  const handleWrapperClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!editor || editor.isDestroyed || editor.isFocused || isSending) return
      const target = event.target as Element
      if (target.closest(INTERACTIVE_ELEMENT_SELECTORS)) return
      editor.commands.focus('end')
    },
    [editor, isSending]
  )
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // Meta+Enter to send message
      if (event.metaKey && event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        // Only send if not already sending and not processing AI
        if (!isSending && !aiToolsState.isProcessing && editor?.isEditable) {
          handleSendClick()
        }
      }
    },
    [isSending, aiToolsState.isProcessing, editor, handleSendClick]
  )
  // Find message for previous message component
  const messageForPrevComponent = useMemo(() => {
    if (sourceMessage) return sourceMessage
    if (state.sourceMessageId && thread?.messages) {
      return thread.messages.find((m) => m.id === state.sourceMessageId) || null
    }
    return null
  }, [sourceMessage, state.sourceMessageId, thread])

  // Resolve the thread's primary contact record for dynamic-select quick-action
  // inputs — the sender (`from:`) of the message being replied to, mapped to its
  // linked contact entity instance. Null when unlinked → pickers render disabled.
  const contactParticipantId = useMemo(() => {
    const from = messageForPrevComponent?.participants?.find(
      (p) => p.role?.toUpperCase() === 'FROM'
    )
    return from?.participant?.id ?? null
  }, [messageForPrevComponent])
  const contactEntityInstanceId = useParticipantStore((s) =>
    contactParticipantId
      ? (s.participants.get(contactParticipantId)?.entityInstanceId ?? null)
      : null
  )
  const contactRecordId = useMemo(
    () => (contactEntityInstanceId ? toRecordId('contact', contactEntityInstanceId) : null),
    [contactEntityInstanceId]
  )

  return (
    <>
      <ConfirmDialog />
      <div className='transition-background flex flex-col duration-200 ease-in-out relative bg-gray-300 dark:bg-gray-800 rounded-[15px] shadow-lg'>
        {/* Header */}
        <div className='flex justify-between h-9'>
          <div
            {...dragHandleProps}
            className={cn(
              'ps-4 flex flex-row items-center gap-2 flex-1 min-w-0',
              dragHandleProps && 'cursor-grab active:cursor-grabbing',
              dragHandleProps?.className
            )}>
            {isEmailChannel ? (
              <Mail size='16' className='my-1.5 text-foreground' />
            ) : (
              <MessageSquare size='16' className='my-1.5 text-foreground' />
            )}
            <span className='text-sm'>{isEmailChannel ? 'Compose Email' : 'Compose Message'}</span>
            {isUpserting && (
              <Loader2 className='ml-auto size-4 animate-spin text-muted-foreground' />
            )}
          </div>
          <div className='flex flex-row gap-0 items-center me-1 relative z-10'>
            {/* AI Status (undo/redo and processing) */}
            <AIStatus
              state={aiToolsState}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={handleUndo}
              onRedo={redo}
            />
            {state.draftId && <span className='text-muted-foreground text-sm me-2'>Draft</span>}

            {/* Pop-out button — only in inline (non-dialog) mode */}
            {!isDialogMode && onPopOut && (
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                onClick={onPopOut}
                title='Pop out'>
                <ArrowUpRight />
              </Button>
            )}

            {/* Dock-back button — floating mode when thread is visible */}
            {isDialogMode && onDockBack && (
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                onClick={onDockBack}
                title='Dock into thread'>
                <ArrowDownLeft />
              </Button>
            )}

            {/* Minimize button — only in floating/dialog mode */}
            {isDialogMode && onMinimize && (
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                onClick={onMinimize}
                title='Minimize'>
                <Minus />
              </Button>
            )}

            {/* Delete button - only show in dialog mode when draft exists */}
            {isDialogMode && state.draftId && (
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30'
                onClick={handleDiscardClick}
                disabled={isSending || isUpserting || isDeleting}
                title='Delete draft'>
                {isDeleting ? <Loader2 className='size-4 animate-spin' /> : <Trash2 />}
              </Button>
            )}

            {/* Close/Discard button — hidden on an always-on messaging composer */}
            {showCloseButton && (
              <Button
                size='icon-sm'
                variant='ghost'
                className='rounded-full text-muted-foreground hover:bg-gray-200 dark:hover:bg-gray-700'
                onClick={isDialogMode ? handleCloseClick : handleDiscardClick}
                disabled={isSending || isUpserting || (isDeleting && !isDialogMode)}>
                {isDeleting && !isDialogMode ? <Loader2 className='size-4 animate-spin' /> : <X />}
              </Button>
            )}
          </div>
        </div>

        <ComposerBody
          content={content}
          onContentChange={handleContentChange}
          placeholder={
            supportsSignature
              ? 'Type / for commands or @ for signatures & actions'
              : 'Type / for commands'
          }
          editable={!aiToolsState.isProcessing}
          popoverClassName={popoverZIndex}
          aiSlash={{ onRunAI: handleAIOperation }}
          onAttachFile={(file) => fileSelect.addExistingFiles([file])}
          onUploadFiles={(files) => fileSelect.addFiles(files)}
          // Hiding the signature button while leaving `@` live is a half-fix —
          // dropping `references` reverts `@` to a literal character, which is
          // what the chat composer already does.
          references={supportsSignature ? references : undefined}
          // `plain` strips block nodes (headings, lists, quotes, code) from the
          // schema. Inline marks survive by design; with the toolbar hidden and
          // `textHtml` null on send, nothing formatted reaches storage.
          variant={supportsRichText ? 'rich' : 'plain'}
          onWrapperClick={handleWrapperClick}
          onKeyDown={handleKeyDown}
          dropzone={dropzone}
          headerFields={
            <div className='flex flex-col border-b border-border'>
              {/* From Field */}
              <div className='flex items-center gap-2 px-4 py-2'>
                <span className='w-10 shrink-0 text-sm text-muted-foreground'>From:</span>
                <div className='flex-1'>
                  {canSwitchChannel ? (
                    <ChannelPicker
                      value={state.integrationId}
                      onChange={handleIntegrationChange}
                      disabled={isSending}
                      scope={isNewCompose ? 'addressable' : 'email'}
                      className={popoverZIndex}
                    />
                  ) : (
                    <Badge variant='user'>{pinnedChannelLabel}</Badge>
                  )}
                </div>
              </div>
              {showFromSeparator && <Separator className='mx-4 w-auto' />}

              {/* To Field & Toggles */}
              {showRecipientField && (
                <div className='flex items-center gap-2 px-4 py-2'>
                  <span className='w-10 shrink-0 text-sm text-muted-foreground'>To:</span>
                  <RecipientInput
                    // Remount on a From switch that changes the identifier model.
                    // `reconcile-channel-switch` fixes the committed chips, but
                    // the input keeps per-contact address lists fetched under the
                    // OLD spec plus a half-typed value — so a pick made right
                    // after switching email→phone offered email addresses and
                    // committed one with `identifierType: PHONE`. Shipped in
                    // #1654; reply mode can't reach it because From is pinned.
                    key={platformCaps?.recipientModel ?? 'email'}
                    ref={toInputRef}
                    recipientModel={platformCaps?.recipientModel}
                    defaultRegion={phoneRegion}
                    supportsCcBcc={showCcBccToggle}
                    field='TO'
                    recipients={recipients.TO}
                    onAdd={(r) => upsertRecipient('TO', r)}
                    onRemove={(id) => removeRecipient('TO', id)}
                    onMoveTo={(id, target) => handleMoveTo('TO', id, target)}
                    onSwitchIdentifier={(id, next) => handleSwitchIdentifier('TO', id, next)}
                    onContactSelect={(c) => handleContactSelect('TO', c)}
                    placeholder='Add recipients...'
                    disabled={isSending}
                    popoverClassName={popoverZIndex}
                  />
                  <div className='ml-auto flex shrink-0 items-center gap-1'>
                    {showSubjectField && !showSubject && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 px-1 text-xs text-info'
                        onClick={() => setShowSubject(true)}
                        disabled={isSending}>
                        Subject
                      </Button>
                    )}
                    {showCcBccToggle && !showCc && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 px-1 text-xs text-info'
                        onClick={() => setShowCc(true)}
                        disabled={isSending}>
                        Cc
                      </Button>
                    )}
                    {showCcBccToggle && !showBcc && (
                      <Button
                        variant='ghost'
                        size='sm'
                        className='h-6 px-1 text-xs text-info'
                        onClick={() => setShowBcc(true)}
                        disabled={isSending}>
                        Bcc
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Cc Field */}
              {showCcBccToggle && showCc && (
                <>
                  <Separator className='mx-4 w-auto' />
                  <div className='flex items-center gap-2 px-4 py-2'>
                    <span className='w-10 shrink-0 text-sm text-muted-foreground'>Cc:</span>
                    <RecipientInput
                      key={platformCaps?.recipientModel ?? 'email'}
                      ref={ccInputRef}
                      recipientModel={platformCaps?.recipientModel}
                      defaultRegion={phoneRegion}
                      supportsCcBcc={showCcBccToggle}
                      field='CC'
                      recipients={recipients.CC}
                      onAdd={(r) => upsertRecipient('CC', r)}
                      onRemove={(id) => removeRecipient('CC', id)}
                      onMoveTo={(id, target) => handleMoveTo('CC', id, target)}
                      onSwitchIdentifier={(id, next) => handleSwitchIdentifier('CC', id, next)}
                      onContactSelect={(c) => handleContactSelect('CC', c)}
                      placeholder='Add Cc recipients...'
                      disabled={isSending}
                      popoverClassName={popoverZIndex}
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                      onClick={() => {
                        setShowCc(false)
                        setRecipients((prev) => ({ ...prev, CC: [] }))
                      }}
                      disabled={isSending}>
                      Remove
                    </Button>
                  </div>
                </>
              )}

              {/* Bcc Field */}
              {showCcBccToggle && showBcc && (
                <>
                  <Separator className='mx-4 w-auto' />
                  <div className='flex items-center gap-2 px-4 py-2'>
                    <span className='w-10 shrink-0 text-sm text-muted-foreground'>Bcc:</span>
                    <RecipientInput
                      key={platformCaps?.recipientModel ?? 'email'}
                      ref={bccInputRef}
                      recipientModel={platformCaps?.recipientModel}
                      defaultRegion={phoneRegion}
                      supportsCcBcc={showCcBccToggle}
                      field='BCC'
                      recipients={recipients.BCC}
                      onAdd={(r) => upsertRecipient('BCC', r)}
                      onRemove={(id) => removeRecipient('BCC', id)}
                      onMoveTo={(id, target) => handleMoveTo('BCC', id, target)}
                      onSwitchIdentifier={(id, next) => handleSwitchIdentifier('BCC', id, next)}
                      onContactSelect={(c) => handleContactSelect('BCC', c)}
                      placeholder='Add Bcc recipients...'
                      disabled={isSending}
                      popoverClassName={popoverZIndex}
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                      onClick={() => {
                        setShowBcc(false)
                        setRecipients((prev) => ({ ...prev, BCC: [] }))
                      }}
                      disabled={isSending}>
                      Remove
                    </Button>
                  </div>
                </>
              )}

              {/* Subject Field */}
              {showSubjectField && showSubject && (
                <>
                  <Separator className='mx-4 w-auto' />
                  <div className='flex items-center gap-2 px-4 py-2'>
                    <span className='shrink-0 text-sm text-muted-foreground'>Subject:</span>
                    <input
                      type='text'
                      className='w-full flex-1 bg-transparent text-sm outline-hidden placeholder:text-muted-foreground/60'
                      value={state.subject}
                      onChange={(e) => handleSubjectChange(e.target.value)}
                      placeholder='Enter subject'
                      disabled={isSending}
                    />
                    <Button
                      variant='ghost'
                      size='sm'
                      className='ml-auto h-6 px-1 text-xs text-muted-foreground'
                      onClick={() => setShowSubject(false)}
                      disabled={isSending}>
                      Remove
                    </Button>
                  </div>
                </>
              )}
            </div>
          }
          belowEditor={
            <>
              {/* Panels render above the action row. Signature is always first. */}
              {supportsSignature && (
                <SignaturePanel
                  integrationId={state.integrationId}
                  selectedSignatureId={state.signatureId}
                  onSignatureChange={handleSignatureChange}
                  disabled={isSending}
                  className={popoverZIndex}
                />
              )}

              <QuickActionPanel
                actions={quickActions}
                onAdd={(action) => setQuickActions((prev) => [...prev, action])}
                onRemove={(actionId) =>
                  setQuickActions((prev) => prev.filter((a) => a.actionId !== actionId))
                }
                onUpdate={(actionId, inputs) =>
                  setQuickActions((prev) =>
                    prev.map((a) => (a.actionId === actionId ? { ...a, inputs } : a))
                  )
                }
                threadId={thread?.id || state.threadId || undefined}
                contactRecordId={contactRecordId}
                disabled={isSending}
                popoverClassName={popoverZIndex}
                onPopoverOpenChange={(open) =>
                  open
                    ? activeState.trackPopoverOpen('quick-action')
                    : activeState.trackPopoverClose('quick-action')
                }
              />

              {/* File Attachments Display - Persisted + In-Progress Uploads */}
              <AttachmentStrip
                attachments={attachments}
                selectedItems={fileSelect.selectedItems}
                onRemoveAttachment={removeAttachment}
                onRemoveUpload={fileSelect.removeItem}
              />

              {/* Action row — triggers grouped; signature last so its removal
                  on select doesn't shift the persistent action/attachment buttons. */}
              {!isSending && (
                <div className='flex items-center gap-1 px-2'>
                  <AddActionButton
                    threadId={thread?.id || state.threadId || undefined}
                    currentActions={quickActions}
                    onAdd={(action) => setQuickActions((prev) => [...prev, action])}
                    onRemove={(actionId) =>
                      setQuickActions((prev) => prev.filter((a) => a.actionId !== actionId))
                    }
                    disabled={isSending}
                    popoverClassName={popoverZIndex}
                    onOpenChange={(open) =>
                      open
                        ? activeState.trackPopoverOpen('add-action')
                        : activeState.trackPopoverClose('add-action')
                    }
                  />
                  {/* Quo's send schema has no media field — an attachment here
                      would be silently dropped at send, so this is correctness,
                      not polish. */}
                  {supportsAttachments && (
                    <AddAttachmentButton
                      fileSelect={fileSelect}
                      disabled={isSending}
                      popoverClassName={popoverZIndex}
                    />
                  )}
                  {supportsSignature && (
                    <SignatureAddButton
                      integrationId={state.integrationId}
                      selectedSignatureId={state.signatureId}
                      onSignatureChange={handleSignatureChange}
                      disabled={isSending}
                      className={popoverZIndex}
                    />
                  )}
                  {lengthInfo && (
                    <span
                      className={cn(
                        'ml-auto shrink-0 text-xs tabular-nums',
                        lengthInfo.over ? 'text-destructive' : 'text-muted-foreground'
                      )}
                      title={`${lengthInfo.characters} of ${maxMessageLength} characters · ${lengthInfo.unicode ? '70' : '160'}-character segments`}>
                      {lengthInfo.remaining} left ·{' '}
                      {lengthInfo.segments === 1 ? '1 segment' : `${lengthInfo.segments} segments`}
                    </span>
                  )}
                </div>
              )}

              {showQuotedReply && state.includePrev && messageForPrevComponent && (
                <PrevMessage
                  message={messageForPrevComponent}
                  onRemove={() => setState((prev) => ({ ...prev, includePrev: false }))}
                />
              )}
              {showQuotedReply && !state.includePrev && messageForPrevComponent && (
                <div className='px-2'>
                  <Button
                    variant='ghost'
                    size='xs'
                    onClick={() => setState((prev) => ({ ...prev, includePrev: true }))}
                    title='Add previous message'
                    className='text-muted-foreground/50'
                    disabled={isSending}>
                    <Plus />
                    Add previous message
                  </Button>
                </div>
              )}
            </>
          }
          toolbar={
            <>
              {showRecipientField && showNoToWarning && (
                <Badge variant='red' size='sm' className='absolute right-3 bottom-full z-10'>
                  Add a To recipient to send
                </Badge>
              )}
              {showRecipientField && !showNoToWarning && suppressionWarningText && (
                <Badge
                  variant='amber'
                  size='sm'
                  className='absolute right-3 bottom-full z-10 max-w-[min(90%,32rem)] truncate'
                  title={suppressionWarningText}>
                  {suppressionWarningText}
                </Badge>
              )}
              <div className='flex items-center gap-1 shrink-0 no-scrollbar md:gap-2'>
                <EditorToolbar
                  editor={editor}
                  onSend={handleSendClick}
                  // Deliberately ungated: scheduling never touches the provider.
                  // `thread.sendMessage` writes a `ScheduledMessage` row and
                  // enqueues a delayed BullMQ job that later calls the ordinary
                  // send path, so it works on every channel that can send.
                  onSchedule={handleScheduleClick}
                  isSending={isSending}
                  showFormatting={supportsRichText}
                  disabled={isSending || !editor?.isEditable || aiToolsState.isProcessing}
                  popoverClassName={popoverZIndex}
                  aiToolsProps={{
                    threadId: thread?.id || state.threadId || undefined,
                    hasContent,
                    hasPreviousMessages,
                    state: aiToolsState,
                    onOperation: (operation, options) => {
                      // `EditorButton` declares `tone?: string`; narrow back to
                      // the compose API's named tones (see `isAiToneType`).
                      void handleAIOperation(operation, {
                        ...options,
                        tone: isAiToneType(options?.tone) ? options.tone : undefined,
                      })
                    },
                  }}
                />
              </div>
            </>
          }
        />
      </div>
    </>
  )
}
// Editor Provider Wrapper with Active State Management
const ReplyComposeEditor = (props: ReplyComposeEditorProps) => (
  <EditorActiveStateProvider>
    <EditorProvider>
      <ReplyComposeEditorComponent {...props} />
    </EditorProvider>
  </EditorActiveStateProvider>
)
export default ReplyComposeEditor
