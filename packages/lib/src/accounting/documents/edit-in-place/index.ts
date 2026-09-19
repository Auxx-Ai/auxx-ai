// packages/lib/src/accounting/documents/edit-in-place/index.ts

export { type CancelDocumentEditResult, cancelDocumentEdit } from './cancel'
export { type DocumentEditInput, openDocumentEdit } from './open'
export { type DocumentEditState, readDocumentEditState } from './read-state'
export { type SaveDocumentEditResult, saveDocumentEdit } from './save'
export {
  DOCUMENT_EDIT_FAMILIES,
  type DocumentEditDoc,
  type DocumentEditFamily,
  type DocumentEditPosting,
  type DocumentEditRow,
  documentEditRow,
} from './spec'
