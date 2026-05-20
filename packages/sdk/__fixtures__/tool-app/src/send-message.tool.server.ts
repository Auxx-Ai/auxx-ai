// packages/sdk/__fixtures__/tool-app/src/send-message.tool.server.ts
//
// Server-side executor for the fixture's `send_message` tool. The catalog
// extractor stubs `.server.ts` imports at extraction time so this body is
// never invoked from the test.

export default async function sendMessage(_input: {
  threadId: string
  body: string
}): Promise<{ messageId: string }> {
  return { messageId: 'fixture-message-id' }
}
