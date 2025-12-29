# Email Editor Preset Values Implementation

## Overview
Successfully implemented preset values functionality for the `ReplyComposeEditor` component, allowing programmatic initialization of email compose state including recipients, subject, content, attachments, and more.

## Implementation Summary

### Files Modified

1. **types.ts** - Added `EditorPresetValues` interface
2. **derive-initial.ts** - Added validation helpers and preset application logic
3. **index.tsx** (ReplyComposeEditor) - Added preset handling and attachment initialization
4. **new-message-dialog.tsx** - Added preset prop pass-through

### Key Features

✅ Preset TO/CC/BCC recipients
✅ Preset subject and HTML content
✅ Preset sender integration ID
✅ Preset signature ID
✅ Preset file attachments
✅ Preset "include previous message" flag
✅ Input validation and sanitization
✅ Duplicate recipient deduplication
✅ Draft precedence (drafts always override presets)
✅ Backward compatible (all preset props are optional)

## Usage

### Basic Example
```tsx
import NewMessageDialog from '~/components/mail/email-editor/new-message-dialog'
import type { EditorPresetValues } from '~/components/mail/email-editor/types'

const MyComponent = () => {
  const presetValues: EditorPresetValues = {
    to: [{
      id: 'contact-123',
      identifier: 'customer@example.com',
      identifierType: 'EMAIL',
      name: 'John Customer',
    }],
    subject: 'Re: Your inquiry',
    contentHtml: '<p>Thank you for reaching out!</p>',
  }

  return (
    <NewMessageDialog
      trigger={<Button>Email Contact</Button>}
      presetValues={presetValues}
      onSendSuccess={() => console.log('Sent!')}
    />
  )
}
```

### Available Preset Fields

```typescript
interface EditorPresetValues {
  // Recipients
  to?: RecipientState[]
  cc?: RecipientState[]
  bcc?: RecipientState[]

  // Content
  subject?: string
  contentHtml?: string

  // Sender settings
  integrationId?: string
  signatureId?: string | null

  // Attachments (must reference existing uploaded files)
  attachments?: FileAttachment[]

  // Advanced
  includePreviousMessage?: boolean
  sourceMessage?: MessageType | null
}
```

## Implementation Details

### 1. Validation & Sanitization

**Recipients**: Filtered to ensure `identifier` and `identifierType` are present
```typescript
sanitized.to = presetValues.to.filter((r) => r.identifier && r.identifierType)
```

**Subject**: Trimmed whitespace
```typescript
sanitized.subject = presetValues.subject.trim()
```

**Content HTML**: Ensures valid structure, defaults to `<p></p>` if empty
```typescript
sanitized.contentHtml = content.trim() || '<p></p>'
```

### 2. Deduplication

Recipients are deduplicated by `identifier` to prevent duplicate entries:
```typescript
function deduplicateRecipients(recipients: RecipientState[]): RecipientState[] {
  const seen = new Set<string>()
  return recipients.filter((r) => {
    if (seen.has(r.identifier)) return false
    seen.add(r.identifier)
    return true
  })
}
```

### 3. Draft Precedence

If a draft exists, presets are completely ignored:
```typescript
// In deriveInitialState
if (draft) {
  // Load from draft, ignore presetValues
  return { ...draftState }
}
// Otherwise, apply presets
```

### 4. CC/BCC Auto-Show

CC and BCC fields automatically show when preset contains values:
```typescript
const [showCc, setShowCc] = useState(state.cc.length > 0)
const [showBcc, setShowBcc] = useState(state.bcc.length > 0)
```

### 5. Attachment Handling

Preset attachments are transformed to FileSelectItem format and added to the file selector:
```typescript
useEffect(() => {
  if (!initialDraft && presetValues?.attachments && !attachmentsInitializedRef.current) {
    const fileSelectItems = presetValues.attachments.map((att) => ({
      id: `preset-${att.id}`,
      name: att.name,
      serverFileId: att.id,
      isExistingAttachment: true,
      // ... other fields
    }))
    fileSelect.addItems(fileSelectItems)
    attachmentsInitializedRef.current = true
  }
}, [presetValues?.attachments, initialDraft])
```

## Use Cases

### 1. Reply to Contact
```tsx
const presetValues: EditorPresetValues = {
  to: [{ id: contact.id, identifier: contact.email, identifierType: 'EMAIL', name: contact.name }],
}
```

### 2. Email Template
```tsx
const presetValues: EditorPresetValues = {
  subject: template.subject,
  contentHtml: template.bodyHtml,
  signatureId: template.signatureId,
}
```

### 3. Send from Specific Account
```tsx
const presetValues: EditorPresetValues = {
  integrationId: supportAccount.id,
  signatureId: supportSignature.id,
}
```

### 4. Forward with Recipients
```tsx
const presetValues: EditorPresetValues = {
  to: [{ id: 'new-recipient', identifier: 'forward@example.com', identifierType: 'EMAIL' }],
  subject: `Fwd: ${originalSubject}`,
}
```

## Testing Checklist

- [x] Preset TO recipients populate correctly
- [x] Preset CC recipients populate and field shows
- [x] Preset BCC recipients populate and field shows
- [x] Preset subject populates
- [x] Preset content HTML populates in editor
- [x] Preset integration ID selects correct sender
- [x] Preset signature ID applies correctly
- [x] Invalid recipients filtered out
- [x] Duplicate recipients deduplicated
- [x] Draft takes precedence over presets
- [x] Empty/partial presets work correctly
- [x] No TypeScript errors
- [x] Backward compatible (no presets = default behavior)

## Examples

See `__examples__/preset-usage-examples.tsx` for comprehensive usage examples including:
- Single recipient preset
- Multiple recipients with CC/BCC
- Template presets
- Sender/integration presets
- Complete preset (all fields)
- Attachments preset
- Dynamic presets from data
- Partial presets

## API Reference

### EditorPresetValues Type

```typescript
interface EditorPresetValues {
  to?: RecipientState[]
  cc?: RecipientState[]
  bcc?: RecipientState[]
  subject?: string
  contentHtml?: string
  integrationId?: string
  signatureId?: string | null
  attachments?: FileAttachment[]
  includePreviousMessage?: boolean
  sourceMessage?: MessageType | null
}
```

### ReplyComposeEditorProps

```typescript
interface ReplyComposeEditorProps {
  thread?: ThreadWithDetails | null
  sourceMessage?: MessageType | null
  draftMessage?: DraftMessageType | null
  mode: EditorMode
  onClose: () => void
  onSendSuccess: () => void
  presetValues?: EditorPresetValues // NEW
}
```

### NewMessageDialogProps

```typescript
interface NewMessageDialogProps {
  trigger: React.ReactNode
  onSendSuccess?: () => void
  presetValues?: EditorPresetValues // NEW
}
```

## Notes

- **Attachments**: Preset attachments must reference existing uploaded files (valid file or asset IDs)
- **Integration ID**: Will fall back to first available integration if invalid
- **Validation**: All preset values are validated and sanitized before application
- **Performance**: Presets are applied during initial state derivation (no re-renders)
- **Immutability**: Original preset object is never mutated

## Future Enhancements

Potential future improvements:
- Preset templates library
- AI-suggested recipients based on context
- Preset validation warnings/errors shown to user
- Preset source tracking for analytics
- Smart merging of presets with thread context
