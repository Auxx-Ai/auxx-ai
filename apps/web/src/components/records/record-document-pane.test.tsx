// apps/web/src/components/records/record-document-pane.test.tsx

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createContext, type ReactNode, useContext, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('~/components/attachments/attachment-preview', () => ({
  AttachmentPreview: ({ type, id }: { type: string; id: string }) => (
    <div data-testid='attachment-preview'>
      {type}:{id}
    </div>
  ),
}))

vi.mock('@auxx/ui/components/scroll-area', () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

const TabsContext = createContext<{ value: string; setValue: (value: string) => void }>({
  value: 'document',
  setValue: () => {},
})
vi.mock('@auxx/ui/components/tabs', () => ({
  Tabs: ({ defaultValue, children }: { defaultValue: string; children: ReactNode }) => {
    const [value, setValue] = useState(defaultValue)
    return <TabsContext.Provider value={{ value, setValue }}>{children}</TabsContext.Provider>
  },
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children: ReactNode }) => {
    const tabs = useContext(TabsContext)
    return (
      <button role='tab' onClick={() => tabs.setValue(value)}>
        {children}
      </button>
    )
  },
  TabsContent: ({ value, children }: { value: string; children: ReactNode }) => {
    const tabs = useContext(TabsContext)
    return tabs.value === value ? <div>{children}</div> : null
  },
}))

const { RecordDocumentPane } = await import('./record-document-pane')

describe('RecordDocumentPane', () => {
  it('renders parent-selected transcription without another tab row', () => {
    render(
      <RecordDocumentPane
        documentRef='asset:invoice-1'
        fileName='invoice.xlsx'
        mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        extractedText={'# Sheet\nOriginal supplier,10'}
        asReadText={'# Invoice\nVendor,Acme'}
        view='read'
      />
    )
    expect(screen.getByText('Acme')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument()
  })

  it('shows converted XLSX source in Original instead of an unsupported attachment preview', () => {
    render(
      <RecordDocumentPane
        documentRef='asset:invoice-1'
        fileName='invoice.xlsx'
        mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        extractedText={'# Sheet\nOriginal supplier,10'}
        asReadText={'# Invoice\nVendor,Acme'}
        view='document'
      />
    )
    expect(screen.getByText('Original supplier')).toBeInTheDocument()
    expect(screen.queryByText('Acme')).not.toBeInTheDocument()
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument()
  })

  it('keeps converted text visible for callers without review tabs', () => {
    render(
      <RecordDocumentPane
        documentRef='asset:quote-1'
        fileName='quote.csv'
        mimeType='text/csv'
        extractedText={'# Sheet\nDescription,Qty\nBolt,4'}
      />
    )

    expect(screen.getByText('Bolt')).toBeInTheDocument()
    expect(screen.queryByTestId('attachment-preview')).not.toBeInTheDocument()
  })

  it('switches between the source document and the transcription', async () => {
    const user = userEvent.setup()
    render(
      <RecordDocumentPane
        documentRef='asset:invoice-1'
        fileName='invoice.pdf'
        mimeType='application/pdf'
        extractedText={null}
        showTabs
        asReadText={'# Invoice\nVendor,Acme'}
      />
    )

    expect(screen.getByTestId('attachment-preview')).toHaveTextContent('asset:invoice-1')
    await user.click(screen.getByRole('tab', { name: 'As read' }))
    expect(screen.getByText('Acme')).toBeInTheDocument()
  })

  it('parses quoted commas in converted CSV text', () => {
    render(
      <RecordDocumentPane
        documentRef={null}
        fileName='invoice.csv'
        mimeType='text/csv'
        extractedText={'# Lines\nDescription,Qty\n"Nut, bolt",2'}
      />
    )

    expect(screen.getByText('Nut, bolt')).toBeInTheDocument()
  })
})
