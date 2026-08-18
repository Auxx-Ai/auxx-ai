// apps/web/src/components/kopilot/ui/blocks/__tests__/entity-blocks-node-id.test.tsx
//
// Plan 17 live run: with `auxx://` links forbidden, the model reached for the
// entity FENCES instead and addressed a workflow node with them — one
// `auxx:entity-card` carrying an app-block node id, plus two `auxx:entity-list`
// fences with an empty `recordIds`. The user saw "Record unavailable" over a
// raw node id and a bare "Records 0" card. Both must now render nothing.

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The card item is the piece that would do the (doomed) record lookup; stub it
// so this file tests the renderers' guard, not the resource stack.
vi.mock('../entity-card-item', () => ({
  EntityCardItem: ({ recordId }: { recordId: string }) => (
    <div data-testid='entity-card-item'>{recordId}</div>
  ),
}))
vi.mock('~/components/resources', () => ({
  useResource: () => ({ resource: { plural: 'Contacts', color: 'blue' } }),
}))

import { EntityCardBlock } from '../entity-card-block'
import { EntityListBlock } from '../entity-list-block'

const RECORD_ID = 'i5aezsg4bc6n8gof2uan3wcf:lk6jz2jsyiqwusswhrf187du'
const NODE_ID = 'z3prnwpd3rt31mp7f9yxo5m6:fedex-DmJuCD8M2cAE0Hqdua0Ns'

describe('EntityCardBlock', () => {
  it('renders the card for a real record id', () => {
    render(<EntityCardBlock data={{ recordId: RECORD_ID }} />)

    expect(screen.getByTestId('entity-card-item')).toHaveTextContent(RECORD_ID)
  })

  it('renders nothing for an app-block workflow node id', () => {
    const { container } = render(<EntityCardBlock data={{ recordId: NODE_ID }} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('entity-card-item')).toBeNull()
  })
})

describe('EntityListBlock', () => {
  it('drops node ids and keeps the records beside them', () => {
    render(<EntityListBlock data={{ recordIds: [RECORD_ID, NODE_ID] }} />)

    const items = screen.getAllByTestId('entity-card-item')
    expect(items).toHaveLength(1)
    expect(items[0]).toHaveTextContent(RECORD_ID)
  })

  it('renders nothing when the fence carries no usable ids', () => {
    // The "Records 0" card the live run produced after `list_app_blocks`.
    const { container } = render(<EntityListBlock data={{ recordIds: [] }} />)

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByText('Records')).toBeNull()
  })
})
