// packages/lib/src/snippets/index.ts

export {
  type CreateSnippetFolderInput,
  createSnippetFolder,
  deleteSnippetFolderWithCascade,
  type UpdateSnippetFolderInput,
  updateSnippetFolder,
} from './snippet-folder-mutations'
export {
  type CreateSnippetInput,
  createSnippet,
  deleteSnippet,
  incrementSnippetUsage,
  SNIPPET_SHARE_GRANTEE_TYPES,
  type SnippetShareGranteeType,
  type SnippetShareInput,
  setSnippetSharing,
  type UpdateSnippetInput,
  updateSnippet,
} from './snippet-mutations'
export {
  getSnippetWithAccess,
  type ListSnippetsFilters,
  listSnippetFoldersWithCounts,
  listSnippetsForUser,
} from './snippet-queries'
export {
  buildSystemSnippetTemplates,
  getSystemSnippet,
  type SystemSnippetTemplate,
} from './system-snippets'
