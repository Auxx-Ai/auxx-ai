// apps/web/src/components/files/utils/__tests__/attachment-display.test.tsx

import type { CommentAttachmentInfo } from '@auxx/lib/comments'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { AttachmentDisplay } from '../attachment-display'

// Mock the AttachmentThumbnail component
vi.mock('../attachment-thumbnail', () => ({
  AttachmentThumbnail: vi.fn(() => (
    <div data-testid='attachment-thumbnail'>Attachment Thumbnail</div>
  )),
}))

// Mock the FileIcon component
vi.mock('~/components/files/utils/file-icon', () => ({
  FileIcon: vi.fn(() => <div data-testid='file-icon'>File Icon</div>),
}))

// Mock window.open
const mockWindowOpen = vi.fn()
global.window.open = mockWindowOpen

describe('AttachmentDisplay', () => {
  const mockAttachment: CommentAttachmentInfo = {
    id: 'att_123',
    name: 'test-document.pdf',
    mimeType: 'application/pdf',
    size: 1024n,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('rendering', () => {
    test('renders attachment with basic info', () => {
      render(<AttachmentDisplay attachment={mockAttachment} />)

      expect(screen.getByText('test-document.pdf')).toBeInTheDocument()
      expect(screen.getByText('1 KB')).toBeInTheDocument()
    })

    test('shows AttachmentThumbnail for previewable images', () => {
      const imageAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
      }

      render(<AttachmentDisplay attachment={imageAttachment} />)
      expect(screen.getByTestId('attachment-thumbnail')).toBeInTheDocument()
    })

    test('shows FileIcon for non-previewable files', () => {
      render(<AttachmentDisplay attachment={mockAttachment} />)
      expect(screen.getByTestId('file-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('attachment-thumbnail')).not.toBeInTheDocument()
    })

    test('does not show AttachmentThumbnail for SVG files (security)', () => {
      const svgAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        name: 'icon.svg',
        mimeType: 'image/svg+xml',
      }

      render(<AttachmentDisplay attachment={svgAttachment} />)
      expect(screen.getByTestId('file-icon')).toBeInTheDocument()
      expect(screen.queryByTestId('attachment-thumbnail')).not.toBeInTheDocument()
    })

    test('applies custom className', () => {
      const { container } = render(
        <AttachmentDisplay attachment={mockAttachment} className='custom-class' />
      )

      const button = container.querySelector('button')
      expect(button).toHaveClass('custom-class')
    })
  })

  describe('download functionality', () => {
    test('opens download URL on click', () => {
      render(<AttachmentDisplay attachment={mockAttachment} />)

      const button = screen.getByRole('button', { name: /Download test-document.pdf/i })
      fireEvent.click(button)

      expect(mockWindowOpen).toHaveBeenCalledWith('/api/attachments/att_123/download', '_blank')
    })

    test('download works for image attachments', () => {
      const imageAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
      }

      render(<AttachmentDisplay attachment={imageAttachment} />)

      const button = screen.getByRole('button', { name: /Download photo.jpg/i })
      fireEvent.click(button)

      expect(mockWindowOpen).toHaveBeenCalledWith('/api/attachments/att_123/download', '_blank')
    })
  })

  describe('remove functionality', () => {
    test('shows remove button when showRemoveButton is true and onRemove is provided', () => {
      render(
        <AttachmentDisplay attachment={mockAttachment} showRemoveButton={true} onRemove={vi.fn()} />
      )

      expect(screen.getByTitle('Remove file')).toBeInTheDocument()
    })

    test('hides remove button when showRemoveButton is false', () => {
      render(<AttachmentDisplay attachment={mockAttachment} showRemoveButton={false} />)

      expect(screen.queryByTitle('Remove file')).not.toBeInTheDocument()
    })

    test('calls onRemove with attachment ID when remove button clicked', () => {
      const onRemove = vi.fn()

      render(
        <AttachmentDisplay
          attachment={mockAttachment}
          showRemoveButton={true}
          onRemove={onRemove}
        />
      )

      const removeButton = screen.getByTitle('Remove file')
      fireEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalledWith('att_123')
    })

    test('prevents download when clicking remove button', () => {
      const onRemove = vi.fn()

      render(
        <AttachmentDisplay
          attachment={mockAttachment}
          showRemoveButton={true}
          onRemove={onRemove}
        />
      )

      const removeButton = screen.getByTitle('Remove file')
      fireEvent.click(removeButton)

      expect(onRemove).toHaveBeenCalled()
      expect(mockWindowOpen).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    test('handles attachment with zero size', () => {
      const zeroSizeAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        size: 0n,
      }

      render(<AttachmentDisplay attachment={zeroSizeAttachment} />)
      // size 0n is falsy, so formatBytes is not rendered
      expect(screen.queryByText('0 B')).not.toBeInTheDocument()
    })

    test('handles attachment with very large size', () => {
      const largeSizeAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        size: BigInt(5 * 1024 * 1024 * 1024), // 5 GB
      }

      render(<AttachmentDisplay attachment={largeSizeAttachment} />)
      expect(screen.getByText('5 GB')).toBeInTheDocument()
    })

    test('handles attachment with no mimeType', () => {
      const noMimeAttachment: CommentAttachmentInfo = {
        ...mockAttachment,
        mimeType: null,
      }

      render(<AttachmentDisplay attachment={noMimeAttachment} />)
      expect(screen.getByTestId('file-icon')).toBeInTheDocument()
    })

    test('handles various image types correctly', () => {
      const imageTypes = [
        { mimeType: 'image/jpeg', shouldPreview: true },
        { mimeType: 'image/png', shouldPreview: true },
        { mimeType: 'image/gif', shouldPreview: true },
        { mimeType: 'image/webp', shouldPreview: true },
        { mimeType: 'image/svg+xml', shouldPreview: false }, // Security exclusion
        { mimeType: 'image/bmp', shouldPreview: false }, // Not in previewable list
      ]

      imageTypes.forEach(({ mimeType, shouldPreview }) => {
        const { rerender } = render(
          <AttachmentDisplay attachment={{ ...mockAttachment, mimeType }} />
        )

        if (shouldPreview) {
          expect(screen.queryByTestId('attachment-thumbnail')).toBeInTheDocument()
        } else {
          expect(screen.queryByTestId('file-icon')).toBeInTheDocument()
        }

        rerender(<></>)
      })
    })
  })
})
