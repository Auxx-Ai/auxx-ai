// packages/lib/src/connections/transports/postgres.ts
// SQL transport — SCAFFOLD ONLY. The interface is locked so the data-connectors
// postgres source and a future "Postgres Query" workflow node can be written against
// a stable `query()` signature. The implementation (open a pg client from
// `conn.fields` host/port/user/password/db, run, close in a `finally`) lands with
// that consumer; reuse the pg path from
// `workflow-engine/services/credential-testers/postgres-tester.ts`.

import type { RuntimeConnectionData } from '../resolve-connection-for-runtime'
import type { SqlRow, SqlTransport } from './types'

export const postgresTransport: SqlTransport = {
  kind: 'postgres',

  async query(
    _conn: RuntimeConnectionData,
    _sql: string,
    _params?: unknown[]
  ): Promise<{ rows: SqlRow[] }> {
    throw new Error(
      'postgres transport is not implemented yet — it lands with the data-connectors postgres source consumer'
    )
  },
}
