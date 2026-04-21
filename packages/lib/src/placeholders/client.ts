// packages/lib/src/placeholders/client.ts
//
// Client-safe surface of the placeholders module. Re-exports only the pure
// token parser — never imports `FieldValueService`, bullmq, or any other
// server-only dependency. See CLAUDE.md "Client vs Server Imports".

export {
  type DateSlug,
  type ParsedPlaceholder,
  parsePlaceholderId,
  tryParsePlaceholderId,
} from './path-parser'
