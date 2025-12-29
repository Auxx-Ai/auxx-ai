// apps/web/src/components/file-upload/__tests__/concurrent-uploads.test.tsx

import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useFileSelect } from '~/components/file-select/hooks/use-file-select'

// Test component that uses file upload with specific config
function TestUploadComponent({
  entityType,
  maxFiles,
  maxFileSize,
  fileExtensions,
  testId,
}: {
  entityType: string
  maxFiles?: number
  maxFileSize?: number
  fileExtensions?: string[]
  testId: string
}) {
  const fileSelect = useFileSelect({
    entityType: entityType as any,
    maxFiles,
    maxFileSize,
    fileExtensions,
    allowMultiple: maxFiles ? maxFiles > 1 : true,
  })

  return (
    <div data-testid={testId}>
      <input
        type="file"
        data-testid={`${testId}-input`}
        multiple={maxFiles ? maxFiles > 1 : true}
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          if (files.length > 0) {
            fileSelect.addFiles(files)
          }
        }}
      />
      <div data-testid={`${testId}-selected`}>
        Selected: {fileSelect.selectedItems.length}
      </div>
      <div data-testid={`${testId}-errors`}>
        {fileSelect.errors.map((error, idx) => (
          <div key={idx}>{error}</div>
        ))}
      </div>
      {fileSelect.selectedItems.map((item) => (
        <div key={item.id} data-testid={`${testId}-file-${item.id}`}>
          {item.name} - {item.status}
        </div>
      ))}
    </div>
  )
}

describe('Concurrent Uploads Integration', () => {
  beforeEach(() => {
    // Clear any existing store state
    vi.clearAllMocks()
  })

  it('should handle multiple components with different configurations', async () => {
    const user = userEvent.setup()

    // Render multiple upload components with different configs
    const { container } = render(
      <div>
        {/* Avatar: Single image, max 2MB */}
        <TestUploadComponent
          testId="avatar"
          entityType="AVATAR"
          maxFiles={1}
          maxFileSize={2 * 1024 * 1024}
          fileExtensions={['.jpg', '.png']}
        />

        {/* Documents: Multiple files, max 10MB */}
        <TestUploadComponent
          testId="documents"
          entityType="FILE"
          maxFiles={5}
          maxFileSize={10 * 1024 * 1024}
          fileExtensions={['.pdf', '.doc']}
        />

        {/* Messages: Small files, max 1MB */}
        <TestUploadComponent
          testId="messages"
          entityType="MESSAGE"
          maxFiles={3}
          maxFileSize={1024 * 1024}
        />
      </div>
    )

    // Test avatar upload (single file only)
    const avatarInput = screen.getByTestId('avatar-input') as HTMLInputElement
    const avatarFile = new File(['avatar content'], 'avatar.jpg', { type: 'image/jpeg' })
    const avatarFile2 = new File(['avatar2 content'], 'avatar2.jpg', { type: 'image/jpeg' })

    // Upload one file to avatar
    Object.defineProperty(avatarInput, 'files', {
      value: [avatarFile],
      writable: false,
    })
    await user.click(avatarInput)
    avatarInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByTestId('avatar-selected')).toHaveTextContent('Selected: 1')
    })

    // Try to add second file to avatar (should fail due to maxFiles=1)
    Object.defineProperty(avatarInput, 'files', {
      value: [avatarFile2],
      writable: false,
    })
    avatarInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      // Should still have only 1 file
      expect(screen.getByTestId('avatar-selected')).toHaveTextContent('Selected: 1')
    })

    // Test document upload (multiple files)
    const docInput = screen.getByTestId('documents-input') as HTMLInputElement
    const docFiles = [
      new File(['doc1'], 'doc1.pdf', { type: 'application/pdf' }),
      new File(['doc2'], 'doc2.pdf', { type: 'application/pdf' }),
      new File(['doc3'], 'doc3.pdf', { type: 'application/pdf' }),
    ]

    Object.defineProperty(docInput, 'files', {
      value: docFiles,
      writable: false,
    })
    await user.click(docInput)
    docInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByTestId('documents-selected')).toHaveTextContent('Selected: 3')
    })

    // Test message upload with size limit
    const msgInput = screen.getByTestId('messages-input') as HTMLInputElement
    const smallFile = new File(['small'], 'small.txt', { type: 'text/plain' })
    const largeFile = new File(['x'.repeat(2 * 1024 * 1024)], 'large.txt', { type: 'text/plain' })

    Object.defineProperty(msgInput, 'files', {
      value: [smallFile, largeFile],
      writable: false,
    })
    await user.click(msgInput)
    msgInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      // Only small file should be added
      expect(screen.getByTestId('messages-selected')).toHaveTextContent('Selected: 1')
      // Should show error for large file
      const errors = screen.getByTestId('messages-errors')
      expect(errors.textContent).toContain('exceeds maximum')
    })

    // Verify all three components maintain their separate states
    expect(screen.getByTestId('avatar-selected')).toHaveTextContent('Selected: 1')
    expect(screen.getByTestId('documents-selected')).toHaveTextContent('Selected: 3')
    expect(screen.getByTestId('messages-selected')).toHaveTextContent('Selected: 1')
  })

  it('should validate files according to session-specific rules', async () => {
    const user = userEvent.setup()

    render(
      <TestUploadComponent
        testId="images"
        entityType="MEDIA"
        maxFiles={2}
        maxFileSize={1024 * 1024}
        fileExtensions={['.jpg', '.png', '.gif']}
      />
    )

    const input = screen.getByTestId('images-input') as HTMLInputElement

    // Test invalid file type
    const pdfFile = new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
    Object.defineProperty(input, 'files', {
      value: [pdfFile],
      writable: false,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      const errors = screen.getByTestId('images-errors')
      expect(errors.textContent).toContain('not allowed')
      expect(screen.getByTestId('images-selected')).toHaveTextContent('Selected: 0')
    })

    // Test valid files
    const validFiles = [
      new File(['img1'], 'photo1.jpg', { type: 'image/jpeg' }),
      new File(['img2'], 'photo2.png', { type: 'image/png' }),
    ]
    Object.defineProperty(input, 'files', {
      value: validFiles,
      writable: false,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      expect(screen.getByTestId('images-selected')).toHaveTextContent('Selected: 2')
    })

    // Test exceeding max files
    const extraFile = new File(['img3'], 'photo3.gif', { type: 'image/gif' })
    Object.defineProperty(input, 'files', {
      value: [extraFile],
      writable: false,
    })
    input.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      const errors = screen.getByTestId('images-errors')
      expect(errors.textContent).toContain('Maximum')
      // Should still have 2 files
      expect(screen.getByTestId('images-selected')).toHaveTextContent('Selected: 2')
    })
  })

  it('should not have config bleeding between components', async () => {
    const user = userEvent.setup()

    // Component 1: Strict validation
    const { rerender } = render(
      <>
        <TestUploadComponent
          testId="strict"
          entityType="AVATAR"
          maxFiles={1}
          maxFileSize={1024} // 1KB
          fileExtensions={['.jpg']}
        />
        <TestUploadComponent
          testId="permissive"
          entityType="FILE"
          maxFiles={100}
          maxFileSize={100 * 1024 * 1024} // 100MB
          // No file extension restrictions
        />
      </>
    )

    // Add large PDF to permissive component
    const permissiveInput = screen.getByTestId('permissive-input') as HTMLInputElement
    const largePdf = new File(['x'.repeat(10 * 1024)], 'large.pdf', { type: 'application/pdf' })
    
    Object.defineProperty(permissiveInput, 'files', {
      value: [largePdf],
      writable: false,
    })
    permissiveInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      // Should succeed in permissive component
      expect(screen.getByTestId('permissive-selected')).toHaveTextContent('Selected: 1')
      expect(screen.getByTestId('permissive-errors')).toHaveTextContent('')
    })

    // Try same file in strict component
    const strictInput = screen.getByTestId('strict-input') as HTMLInputElement
    Object.defineProperty(strictInput, 'files', {
      value: [largePdf],
      writable: false,
    })
    strictInput.dispatchEvent(new Event('change', { bubbles: true }))

    await waitFor(() => {
      // Should fail in strict component
      expect(screen.getByTestId('strict-selected')).toHaveTextContent('Selected: 0')
      const errors = screen.getByTestId('strict-errors')
      expect(errors.textContent).toContain('exceeds maximum')
    })

    // Verify both components maintain their separate states
    expect(screen.getByTestId('permissive-selected')).toHaveTextContent('Selected: 1')
    expect(screen.getByTestId('strict-selected')).toHaveTextContent('Selected: 0')
  })
})