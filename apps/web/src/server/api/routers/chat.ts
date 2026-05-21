// src/server/api/routers/chat.ts
//
// Phase 4a: all agent- and visitor-facing chat procedures have moved onto
// either `apps/api` Hono routes (visitor) or the unified `thread` router
// (agent). The router is empty and exists only so existing tRPC imports don't
// break during the 4a + 4b landing window. It's removed entirely in Phase 5.

import { createTRPCRouter } from '~/server/api/trpc'

export const chatRouter = createTRPCRouter({})
