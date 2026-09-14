// apps/web/src/components/returns/intake/ui/return-intake-dialog.test.tsx
//
// The upload dialog's own wiring (money/tasks/57 §7.2), following
// `return-lines-card.test.tsx`'s harness: heavy leaves (the drop zone, the
// upload door) are stubbed to their props, since each has its own surface,
// while the dialog's own decisions run for real — the gate, the 20-label cap,
// the n-of-m phase line, and the push to the review route.
//
// Four things are pinned because each is a decision the brief argues for and
// not an implementation detail:
//   · the gate is the ONLY page when the model cannot read images (§7.2)
//   · the 21st photo is refused (`RETURN_INTAKE_MAX_LABELS`) — the drop zone
//     itself does NOT enforce `maxFiles`, it only prints it
//   · `reading` is n of m, never a bare spinner (§3.1: one call per label)
//   · a ready draft pushes to `/app/returns/intake/[draftId]` (§7.2)

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const DRAFT_ID = 'rid_draft00000000000000000000'

type Capability = { ok: boolean; modelId: string | null; reason: string | null }

const h = vi.hoisted(() => ({
  capability: { ok: true, modelId: 'gpt-5.4', reason: null } as Capability,
  draft: null as Record<string, unknown> | null,
  startCalls: [] as unknown[],
  startResult: { draftId: 'rid_draft00000000000000000000' },
  uploadCalls: [] as File[][],
  uploadResults: [] as Array<{
    fileName: string
    fileRef: string | null
    mimeType: string | null
    size: number | null
    error: string | null
  }>,
  pushCalls: [] as string[],
  toastErrors: [] as Array<{ title?: string; description?: string }>,
  photosFieldId: 'fld_returnphotos0000000000000',
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (url: string) => h.pushCalls.push(url),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/app/returns',
  useParams: () => ({}),
}))

// The gate page is the one page carrying a `<Link>`, and `next/link`'s
// prefetch observer does `new IntersectionObserver(...)` — which the shared
// setup stubs as an arrow function, not a class, so a real Link throws
// "is not a constructor" on mount. A plain anchor is all the assertion needs.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

vi.mock('@auxx/ui/components/toast', () => ({
  toastError: (args: { title?: string; description?: string }) => h.toastErrors.push(args),
}))

vi.mock('~/components/resources', () => ({
  useResourceFields: () => ({
    fields: h.photosFieldId ? [{ id: h.photosFieldId, systemAttribute: 'return_photos' }] : [],
  }),
}))

vi.mock('../hooks/use-label-upload', () => ({
  useLabelUpload: () => ({
    upload: (files: File[]) => {
      h.uploadCalls.push(files)
      return Promise.resolve(h.uploadResults)
    },
    cancel: () => {},
    isUploading: false,
    progress: {},
  }),
}))

/**
 * The drop zone, stubbed to two buttons that emit a batch of N synthetic files.
 * The real component never refuses anything — its `maxFiles` is a caption, and
 * its hidden input is unconditionally `multiple` — so the cap under test is the
 * dialog's, which is where it actually lives.
 */
vi.mock('~/components/file-select/file-select-drop-zone', () => ({
  FileSelectDropZone: ({
    onFilesSelected,
    accept,
    placeholder,
  }: {
    onFilesSelected: (files: File[]) => void
    accept?: string
    placeholder?: string
  }) => (
    <div data-testid='drop-zone' data-accept={accept} data-placeholder={placeholder}>
      <button
        type='button'
        data-testid='emit-1'
        onClick={() => onFilesSelected([makeFile('label-1.jpg')])}>
        emit 1
      </button>
      <button
        type='button'
        data-testid='emit-21'
        onClick={() =>
          onFilesSelected(Array.from({ length: 21 }, (_, i) => makeFile(`label-${i + 1}.jpg`)))
        }>
        emit 21
      </button>
    </div>
  ),
}))

vi.mock('~/trpc/react', () => ({
  api: {
    returnIntake: {
      checkCapability: {
        useQuery: () => ({ data: h.capability }),
      },
      start: {
        useMutation: () => ({
          mutateAsync: (input: unknown) => {
            h.startCalls.push(input)
            return Promise.resolve(h.startResult)
          },
          isPending: false,
        }),
      },
      get: {
        useQuery: () => ({ data: h.draft }),
      },
    },
  },
}))

import { ReturnIntakeDialog } from './return-intake-dialog'

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' })
}

function renderDialog() {
  return render(<ReturnIntakeDialog open onOpenChange={() => {}} />)
}

/** The queued-photo cards each carry a "Remove <name>" control. */
function fileCardCount(): number {
  return screen.queryAllByRole('button', { name: /^Remove / }).length
}

beforeEach(() => {
  h.capability = { ok: true, modelId: 'gpt-5.4', reason: null }
  h.draft = null
  h.startCalls = []
  h.startResult = { draftId: DRAFT_ID }
  h.uploadCalls = []
  h.uploadResults = []
  h.pushCalls = []
  h.toastErrors = []
  h.photosFieldId = 'fld_returnphotos0000000000000'
})

describe('the gate', () => {
  it('is the only page when the model cannot read images', () => {
    h.capability = { ok: false, modelId: 'tiny-text-only', reason: 'tiny-text-only has no vision' }
    renderDialog()

    expect(screen.getByText('This model cannot read photos')).toBeInTheDocument()
    expect(screen.getByText('tiny-text-only has no vision')).toBeInTheDocument()
    expect(screen.getByText('tiny-text-only')).toBeInTheDocument()

    // `DialogNavPages` renders only the active page, so the upload page's drop
    // zone and its submit are genuinely absent — not merely hidden.
    expect(screen.queryByTestId('drop-zone')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Read label/ })).not.toBeInTheDocument()
  })

  it('leaves the upload page alone when the model can read images', () => {
    renderDialog()

    expect(screen.getByTestId('drop-zone')).toBeInTheDocument()
    expect(screen.queryByText('This model cannot read photos')).not.toBeInTheDocument()
  })
})

describe('the photo list', () => {
  it('advertises image/* alongside the extensions so a phone offers its camera', () => {
    renderDialog()

    const accept = screen.getByTestId('drop-zone').getAttribute('data-accept') ?? ''
    expect(accept.split(',')).toContain('image/*')
    expect(accept.split(',')).toContain('.heic')
  })

  it('refuses the 21st photo and says so', async () => {
    renderDialog()

    await userEvent.click(screen.getByTestId('emit-21'))

    expect(fileCardCount()).toBe(20)
    expect(h.toastErrors).toHaveLength(1)
    expect(h.toastErrors[0]?.title).toBe('Some photos were left out')
  })

  it('a removed photo leaves the list', async () => {
    renderDialog()
    await userEvent.click(screen.getByTestId('emit-1'))
    expect(fileCardCount()).toBe(1)

    await userEvent.click(screen.getByRole('button', { name: 'Remove label-1.jpg' }))

    expect(fileCardCount()).toBe(0)
  })
})

describe('starting the read', () => {
  async function startWithOneLabel() {
    h.uploadResults = [
      {
        fileName: 'label-1.jpg',
        fileRef: 'asset:ast_0000000000000000000000001',
        mimeType: 'image/jpeg',
        size: 1,
        error: null,
      },
    ]
    renderDialog()
    await userEvent.click(screen.getByTestId('emit-1'))
    await userEvent.click(screen.getByRole('button', { name: /Read label/ }))
    await waitFor(() => expect(h.startCalls).toHaveLength(1))
  }

  it('sends one fileRef per uploaded photo', async () => {
    await startWithOneLabel()

    expect(h.startCalls[0]).toEqual({
      labels: [{ fileRef: 'asset:ast_0000000000000000000000001', fileName: 'label-1.jpg' }],
    })
  })

  it('starts on what landed when one photo fails, and names the one that did not', async () => {
    h.uploadResults = [
      {
        fileName: 'label-1.jpg',
        fileRef: 'asset:ast_0000000000000000000000001',
        mimeType: 'image/jpeg',
        size: 1,
        error: null,
      },
      {
        fileName: 'label-2.jpg',
        fileRef: null,
        mimeType: null,
        size: null,
        error: 'The upload did not complete.',
      },
    ]
    renderDialog()
    await userEvent.click(screen.getByTestId('emit-1'))
    await userEvent.click(screen.getByRole('button', { name: /Read label/ }))

    await waitFor(() => expect(h.startCalls).toHaveLength(1))
    expect(h.startCalls[0]).toEqual({
      labels: [{ fileRef: 'asset:ast_0000000000000000000000001', fileName: 'label-1.jpg' }],
    })
    expect(h.toastErrors[0]?.title).toBe('1 of 2 photos did not upload')
  })

  it('refuses only when nothing landed at all', async () => {
    h.uploadResults = [
      {
        fileName: 'label-1.jpg',
        fileRef: null,
        mimeType: null,
        size: null,
        error: 'That file could not be uploaded.',
      },
    ]
    renderDialog()
    await userEvent.click(screen.getByTestId('emit-1'))
    await userEvent.click(screen.getByRole('button', { name: /Read label/ }))

    await waitFor(() => expect(h.toastErrors).toHaveLength(1))
    expect(h.startCalls).toHaveLength(0)
    expect(h.toastErrors[0]?.title).toBe('Could not read the labels')
    expect(h.toastErrors[0]?.description).toBe('That file could not be uploaded.')
  })

  describe('the reading page', () => {
    it('counts the labels off, n of m, instead of spinning', async () => {
      h.draft = {
        id: DRAFT_ID,
        status: 'reading',
        phase: 'reading',
        labelsRead: 2,
        labelsTotal: 7,
        failureReason: null,
        payload: { labels: [], orderOptions: {} },
      }
      await startWithOneLabel()

      expect(await screen.findByText('Reading label 3 of 7')).toBeInTheDocument()
      expect(screen.queryByText('Reading the labels')).not.toBeInTheDocument()
      expect(h.pushCalls).toHaveLength(0)
    })

    it('pushes to the review route once the draft is ready', async () => {
      h.draft = {
        id: DRAFT_ID,
        status: 'ready',
        phase: 'ready',
        labelsRead: 1,
        labelsTotal: 1,
        failureReason: null,
        payload: { labels: [], orderOptions: {} },
      }
      await startWithOneLabel()

      await waitFor(() => expect(h.pushCalls).toEqual([`/app/returns/intake/${DRAFT_ID}`]))
    })

    it('shows the failure reason rather than routing', async () => {
      h.draft = {
        id: DRAFT_ID,
        status: 'failed',
        phase: 'reading',
        labelsRead: 0,
        labelsTotal: 1,
        failureReason: 'The daily read limit for this organization is used up.',
        payload: { labels: [], orderOptions: {} },
      }
      await startWithOneLabel()

      expect(
        await screen.findByText('The daily read limit for this organization is used up.')
      ).toBeInTheDocument()
      expect(h.pushCalls).toHaveLength(0)
    })
  })
})
