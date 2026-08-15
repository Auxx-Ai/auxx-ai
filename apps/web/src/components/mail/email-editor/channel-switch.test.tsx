// apps/web/src/components/mail/email-editor/channel-switch.test.tsx
//
// The Phase-1 regression guard, wired through the real component.
//
// `reconcile-channel-switch.test.ts` covers the reconciliation logic; this file
// covers that `handleIntegrationChange` actually CALLS it. Before the fix the
// handler was a one-line `setState`, so subject/cc/bcc/signature were hidden but
// still present in `state` — which is why the assertion here is on the payload
// handed to `thread.sendMessage`, the closest observable proxy for `state`.
// A DOM assertion would pass while the bug persisted.

import { IdentifierType } from '@auxx/database/enums'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sendMutate: vi.fn(),
  toastError: vi.fn(),
  clearItems: vi.fn(),
  showFormatting: undefined as boolean | undefined,
  referencesPassed: undefined as unknown,
  variantPassed: undefined as string | undefined,
  pickerScope: undefined as string | undefined,
  channels: [
    { id: 'ch_email', provider: 'google', identifier: 'support@auxx.ai' },
    { id: 'ch_sms', provider: 'openphone', identifier: '+18889155797' },
  ],
  editor: {
    isEditable: true,
    isDestroyed: false,
    isFocused: false,
    getText: () => 'hello there',
    getHTML: () => '<p>hello there</p>',
    commands: { focus: () => {}, setContent: () => {} },
  },
}))

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: h.toastError,
  toastSuccess: vi.fn(),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    useUtils: () => ({
      draft: { getById: { setData: vi.fn() } },
      thread: { getScheduledMessages: { invalidate: vi.fn() } },
    }),
    channel: { list: { useQuery: () => ({ data: { channels: h.channels } }) } },
    thread: { sendMessage: { useMutation: () => ({ mutate: h.sendMutate }) } },
    quickAction: { execute: { useMutation: () => ({ mutateAsync: vi.fn() }) } },
  },
}))

vi.mock('~/components/editor/editor-context', () => ({
  EditorProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditorContext: () => ({ editor: h.editor, setEditor: () => {} }),
}))

vi.mock('~/components/editor/inline-picker', () => ({
  makeContentApplier: () => ({ apply: () => {}, markLocalEdit: () => {} }),
}))

vi.mock('~/components/editor/editor-button', () => ({
  EditorToolbar: ({ onSend, showFormatting }: { onSend: () => void; showFormatting?: boolean }) => {
    h.showFormatting = showFormatting
    return (
      <button type='button' onClick={onSend}>
        send
      </button>
    )
  },
}))

vi.mock('../composer-shared', async () => {
  const { useState } = await import('react')
  return {
    INTERACTIVE_ELEMENT_SELECTORS: 'button',
    isAiToneType: () => false,
    isContentEmpty: () => false,
    AttachmentStrip: () => null,
    ComposerBody: ({
      headerFields,
      belowEditor,
      toolbar,
      references,
      variant,
    }: Record<string, React.ReactNode> & { variant?: string }) => {
      h.referencesPassed = references
      h.variantPassed = variant
      return (
        <div>
          {headerFields}
          {belowEditor}
          {toolbar}
        </div>
      )
    },
    useComposerAITools: () => ({
      state: { isProcessing: false },
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
      handleAIOperation: () => {},
    }),
    useComposerAttachments: ({
      initialAttachments,
    }: {
      initialAttachments?: Array<{ id: string }>
    }) => {
      const [attachments, setAttachments] = useState(initialAttachments ?? [])
      return {
        attachments,
        setAttachments,
        allAttachments: attachments,
        removeAttachment: () => {},
        fileSelect: {
          selectedItems: [],
          clearItems: h.clearItems,
          addFiles: () => {},
          addExistingFiles: () => {},
          removeItem: () => {},
        },
        dropzone: {
          getRootProps: () => ({}),
          getInputProps: () => ({}),
          isDragActive: false,
        },
      }
    },
  }
})

vi.mock('~/components/pickers/channel-picker', () => ({
  ChannelPicker: ({ onChange, scope }: { onChange: (id: string) => void; scope?: string }) => {
    h.pickerScope = scope
    return (
      <>
        {h.channels.map((c) => (
          <button key={c.id} type='button' onClick={() => onChange(c.id)}>
            {`pick-${c.id}`}
          </button>
        ))}
      </>
    )
  },
}))

vi.mock('~/components/channels/hooks/use-channels', () => ({
  useChannel: (id?: string) => h.channels.find((c) => c.id === id),
  useChannels: () => h.channels,
}))

vi.mock('~/components/channels/hooks/use-default-channel', () => ({
  useDefaultChannelId: () => 'ch_email',
}))

vi.mock('~/components/signatures/ui', () => ({
  SignatureAddButton: () => <div data-testid='signature-add' />,
  SignaturePanel: () => <div data-testid='signature-panel' />,
}))

vi.mock('./add-attachment-button', () => ({
  AddAttachmentButton: () => <div data-testid='add-attachment' />,
}))

vi.mock('./recipient-input', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    RecipientInput: forwardRef((_props: unknown, ref) => {
      useImperativeHandle(ref, () => ({ commitPendingInput: () => {} }))
      return null
    }),
  }
})

vi.mock('./quick-action-panel', () => ({
  AddActionButton: () => null,
  QuickActionPanel: () => null,
}))

vi.mock('./ai-status', () => ({ AIStatus: () => null }))
vi.mock('./prev-message', () => ({ default: () => null }))

vi.mock('./editor-active-state-context', () => ({
  EditorActiveStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useEditorActiveStateContext: () => ({
    isActive: false,
    setHasFocus: () => {},
    trackPopoverOpen: () => {},
    trackPopoverClose: () => {},
  }),
}))

vi.mock('./hooks', () => ({
  useDraftMutations: () => ({
    upsert: vi.fn(),
    deleteDraft: vi.fn(),
    isUpserting: false,
    isDeleting: false,
  }),
}))

vi.mock('./use-draft-autosave', () => ({
  useDraftAutosave: () => ({ abort: () => {} }),
}))

vi.mock('~/components/mail/hooks', () => ({ useCountUpdates: () => ({ onSendDraft: () => {} }) }))
vi.mock('~/components/mail/hooks/use-suppression-check', () => ({ useSuppressionCheck: () => [] }))
vi.mock('~/components/mail/store/compose-store', () => ({
  useComposeStore: (selector: (s: unknown) => unknown) =>
    selector({ instances: [], clearPendingFocus: () => {} }),
}))
vi.mock('~/components/threads/hooks/append-optimistic-message', () => ({
  appendOptimisticMessage: () => {},
  toAttachmentMeta: (a: unknown) => a,
}))
vi.mock('~/components/threads/store/participant-store', () => ({
  useParticipantStore: (selector: (s: unknown) => unknown) => selector({ participants: new Map() }),
}))
vi.mock('~/components/threads/store/thread-store', () => ({
  getThreadStoreState: () => ({
    getThread: () => null,
    updateThread: () => {},
    updateDraft: () => {},
    markDraftNotFound: () => {},
  }),
}))
// The composer seeds its recipient from the thread counterparty on an always-on
// composer. Stubbed to "not resolved" so these cases exercise only the channel
// switch — the seeding path has its own coverage in always-on-composer.test.tsx.
vi.mock('~/components/threads/hooks/use-thread-envelope-counterparty', () => ({
  useThreadEnvelopeCounterparty: () => undefined,
}))
vi.mock('~/hooks/use-analytics', () => ({ useAnalytics: () => ({ capture: () => {} }) }))
vi.mock('~/hooks/use-confirm', () => ({
  useConfirm: () => [async () => true, () => null],
}))
vi.mock('~/hooks/use-debounced-value', () => ({
  useDebouncedCallback: (fn: unknown) => fn,
}))

const { default: ReplyComposeEditor } = await import('./index')

const recipient = (identifier: string, identifierType: IdentifierType) => ({
  id: identifier,
  identifier,
  identifierType,
  name: null,
})

function renderComposer() {
  return render(
    <ReplyComposeEditor
      mode='new'
      onClose={() => {}}
      onSendSuccess={() => {}}
      presetValues={{
        to: [
          recipient('a@example.com', IdentifierType.EMAIL),
          recipient('+14155552671', IdentifierType.PHONE),
        ],
        cc: [recipient('c@example.com', IdentifierType.EMAIL)],
        bcc: [recipient('d@example.com', IdentifierType.EMAIL)],
        subject: 'Order #1234',
        signatureId: 'sig_1',
        attachments: [{ id: 'file_1', name: 'invoice.pdf', type: 'file' as const }],
      }}
    />
  )
}

describe('handleIntegrationChange — switching From reconciles the draft', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.showFormatting = undefined
    h.referencesPassed = undefined
    h.variantPassed = undefined
  })

  it('submits nothing the SMS channel cannot carry', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByText('pick-ch_sms'))
    await user.click(screen.getByText('send'))

    expect(h.sendMutate).toHaveBeenCalledTimes(1)
    const payload = h.sendMutate.mock.calls[0]?.[0]

    // The whole bug: these were merely HIDDEN and still shipped.
    expect(payload.subject).toBe('')
    expect(payload.cc).toEqual([])
    expect(payload.bcc).toEqual([])
    expect(payload.signatureId).toBeNull()
    expect(payload.attachments).toEqual([])

    // The email address is not a valid SMS identifier; the phone number is.
    expect(payload.to).toEqual([
      { identifier: '+14155552671', identifierType: IdentifierType.PHONE, name: undefined },
    ])

    // Phase 3 — a plain channel sends no HTML and must carry the text body.
    expect(payload.textHtml).toBeNull()
    expect(payload.textPlain).toBe('hello there')
  })

  it('surfaces exactly one toast naming what was dropped', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByText('pick-ch_sms'))

    expect(h.toastError).toHaveBeenCalledTimes(1)
    expect(h.toastError.mock.calls[0]?.[0].description).toBe(
      'Dropped 3 recipients, the subject, the signature and 1 attachment.'
    )
    expect(h.clearItems).toHaveBeenCalled()
  })

  it('leaves the draft alone when the recipient model does not change', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByText('pick-ch_email'))
    await user.click(screen.getByText('send'))

    expect(h.toastError).not.toHaveBeenCalled()
    const payload = h.sendMutate.mock.calls[0]?.[0]
    expect(payload.subject).toBe('Order #1234')
    expect(payload.cc).toHaveLength(1)
    expect(payload.signatureId).toBe('sig_1')
    expect(payload.textHtml).toBe('<p>hello there</p>')
  })
})

describe('capability-gated affordances', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.showFormatting = undefined
    h.referencesPassed = undefined
    h.variantPassed = undefined
  })

  it('renders the email affordances on an email channel', () => {
    renderComposer()

    expect(screen.getByText('Compose Email')).toBeTruthy()
    expect(screen.getByTestId('add-attachment')).toBeTruthy()
    expect(screen.getByTestId('signature-add')).toBeTruthy()
    expect(screen.getByTestId('signature-panel')).toBeTruthy()
    expect(h.showFormatting).toBe(true)
    expect(h.variantPassed).toBe('rich')
    expect(h.referencesPassed).toBeDefined()
  })

  it('drops them on a messaging channel', async () => {
    const user = userEvent.setup()
    renderComposer()

    await user.click(screen.getByText('pick-ch_sms'))

    expect(screen.getByText('Compose Message')).toBeTruthy()
    expect(screen.queryByTestId('add-attachment')).toBeNull()
    expect(screen.queryByTestId('signature-add')).toBeNull()
    expect(screen.queryByTestId('signature-panel')).toBeNull()
    expect(h.showFormatting).toBe(false)
    expect(h.variantPassed).toBe('plain')
    // The `@` menu roots the signature picker — hiding the button while leaving
    // `@` live would be a half-fix.
    expect(h.referencesPassed).toBeUndefined()
    // Send AND schedule stay available on every channel.
    expect(screen.getByText('send')).toBeTruthy()
  })
})

/**
 * A thread is a conversation on ONE channel. Its participants are identifiers in
 * that channel's address space, so switching an SMS thread to an email channel
 * does not produce an email to the same person — it produces a send with no
 * valid recipient.
 *
 * The composer plan asserted "reply mode is unaffected — From is pinned by the
 * thread's channel". It was not pinned: `ChannelPicker` rendered in every mode
 * with `disabled={isSending}` as its only gate. These cases pin the claim down.
 */
describe('From is pinned to the thread channel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.pickerScope = undefined
  })

  const renderReply = (integrationId: string) =>
    render(
      <ReplyComposeEditor
        mode='reply'
        thread={{ id: 'th_1', integrationId }}
        onClose={() => {}}
        onSendSuccess={() => {}}
      />
    )

  it('offers no channel picker when replying on a messaging thread', () => {
    renderReply('ch_sms')

    expect(screen.queryByText('pick-ch_email')).toBeNull()
    expect(screen.queryByText('pick-ch_sms')).toBeNull()
    // The sending identity is still shown — pinned, not hidden.
    expect(screen.getByText('+18889155797')).toBeTruthy()
  })

  it('keeps a picker on an email thread, scoped to email only', () => {
    renderReply('ch_email')

    // Email is the exception: a mail thread can be answered from another mailbox
    // or alias. It must NOT be able to degrade to a phone channel, so the scope
    // is 'email' rather than the 'addressable' scope new-compose uses.
    expect(screen.getByText('pick-ch_email')).toBeTruthy()
    expect(h.pickerScope).toBe('email')
  })

  it('offers the full addressable scope only in new compose', () => {
    renderComposer()

    expect(h.pickerScope).toBe('addressable')
  })
})
