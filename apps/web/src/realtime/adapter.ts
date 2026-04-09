// ~/realtime/adapter.ts

import { PusherRealtimeAdapter } from '@auxx/lib/realtime/client'

/** Single instance for the entire app — lives outside React. */
export const realtimeAdapter = new PusherRealtimeAdapter()
