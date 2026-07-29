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
  type UpdateSnippetInput,
  updateSnippet,
} from './snippet-mutations'
export {
  getSnippetWithShares,
  type ListSnippetsFilters,
  listSnippetFoldersWithCounts,
  listSnippetsForUser,
} from './snippet-queries'
export {
  buildSystemSnippetTemplates,
  getSystemSnippet,
  type SystemSnippetTemplate,
} from './system-snippets'
