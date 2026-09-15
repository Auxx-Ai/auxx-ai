// apps/web/src/components/purchasing/intake/ui/intake-document-preview.tsx
'use client'

// The left half of the review screen: the vendor's own document, beside our
// reading of it (plans/money/tasks/38 §6.2).
//
// A thin wrapper over `RecordDocumentPane` (plans/money/tasks/58 §6.4), which
// generalised this component so the vendor bill's page could adopt it too. The
// props stay the intake draft's own shape (`draftId`, `assetId`) so the review
// page is unchanged; this file only translates them into the pane's props.

import { useMemo } from 'react'
import { RecordDocumentPane } from '~/components/records/record-document-pane'

interface IntakeDocumentPreviewProps {
  draftId: string
  assetId: string | null
  fileName: string | null
  mimeType: string | null
  /** The converted text the model read. `null` for a PDF or an image. */
  extractedText: string | null
}

export function IntakeDocumentPreview({
  draftId,
  assetId,
  fileName,
  mimeType,
  extractedText,
}: IntakeDocumentPreviewProps) {
  const documentRef = useMemo(() => (assetId ? `asset:${assetId}` : null), [assetId])

  return (
    <RecordDocumentPane
      documentRef={documentRef}
      fileName={fileName}
      mimeType={mimeType}
      extractedText={extractedText}
      scope={{ kind: 'intakeDraft', draftId }}
      // `null`, not omitted: while `assetId` is still loading this pane must
      // render nothing, the same as the original `if (!assetId) return null`,
      // not the pane's default "No document" placeholder.
      emptyState={null}
    />
  )
}
