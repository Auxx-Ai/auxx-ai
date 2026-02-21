// packages/lib/src/browser/index.ts

import { configService } from '@auxx/credentials'
import { jwtVerify } from 'jose'
import { Result } from '../result'

export const TOKEN_TYPES = { websocket: 'websocket', websocketRefresh: 'websocketRefresh' }

type TokenType = 'websocket' | 'websocketRefresh'

const SECRET_TOKENS: Record<TokenType, string> = {
  websocket: configService.get<string>('BETTER_AUTH_SECRET') || 'default-websocket-secret',
  websocketRefresh:
    configService.get<string>('BETTER_AUTH_SECRET') || 'default-websocket-refresh-secret',
}

export type WebSocketData = { userId: string; workspaceId: number }

export type WebClientToServerEvents = {
  joinWorkspace: (args: { workspaceId: number; userId: string }) => void
}

export type WebServerToClientEvents = {
  documentBatchRunStatus: (args: DocumentBatchRunStatusArgs) => void
  evaluationStatus: (args: EvaluationStatusArgs) => void
  experimentStatus: (args: ExperimentStatusArgs) => void
  evaluationResultCreated: (args: EvaluationResultCreatedArgs) => void
  datasetRowsCreated: (args: DatasetRowsCreatedArgs) => void
  joinWorkspace: (args: { workspaceId: number; userId: string }) => void
  documentLogCreated: (args: DocumentLogCreatedArgs) => void
  documentSuggestionCreated: (args: DocumentSuggestionCreatedArgs) => void
  evaluationResultV2Created: (args: EvaluationResultV2CreatedArgs) => void
  mcpServerScaleEvent: (args: {
    workspaceId: number
    replicas: number
    mcpServerId: number
  }) => void
  mcpServerConnected: (args: { workspaceId: number; mcpServerId: number }) => void
}

type DocumentBatchRunStatusArgs = {
  documentUuid: string
  total: number
  completed: number
  errors: number
  enqueued: number
}

type EvaluationStatusArgs = {
  batchId: string
  total: number
  completed: number
  errors: number
  enqueued: number
} & (
  | { evaluationId: number; documentUuid: string; version: 'v1' }
  | { commitId: number; documentUuid: string; evaluationUuid: string; version: 'v2' }
)

type ExperimentStatusArgs = { experiment: string }

type EvaluationResultCreatedArgs = {
  workspaceId: number
  evaluationId: number
  documentUuid: string
  evaluationResultId: number
  documentLogUuid: string
  row: string
}

type DocumentLogCreatedArgs = {
  workspaceId: number
  documentUuid: string
  commitUuid: string
  documentLogId: number
  documentLogWithMetadata: string
}

type DocumentSuggestionCreatedArgs = { workspaceId: number; suggestion: string; evaluation: string }

type DatasetRowsCreatedArgs =
  | { datasetId: number; error: null; rows: string[]; finished: false }
  | { datasetId: number; error: Error; rows: null; finished: false }
  | { datasetId: number; error: null; rows: null; finished: true }

type EvaluationResultV2CreatedArgs = {
  workspaceId: number
  result: string
  evaluation: string
  commit: string
  providerLog: string
  dataset?: string
  datasetRow?: string
}

export type WorkersClientToServerEvents = {
  documentBatchRunStatus: (args: { workspaceId: number; data: DocumentBatchRunStatusArgs }) => void
  evaluationStatus: (args: { workspaceId: number; data: EvaluationStatusArgs }) => void
  evaluationResultCreated: (args: {
    workspaceId: number
    data: EvaluationResultCreatedArgs
  }) => void
  datasetRowsCreated: (args: { workspaceId: number; data: DatasetRowsCreatedArgs }) => void
  documentLogCreated: (args: { workspaceId: number; data: DocumentLogCreatedArgs }) => void
  documentSuggestionCreated: (args: {
    workspaceId: number
    data: DocumentSuggestionCreatedArgs
  }) => void
  evaluationResultV2Created: (args: {
    workspaceId: number
    data: EvaluationResultV2CreatedArgs
  }) => void
  experimentStatus: (args: { workspaceId: number; data: ExperimentStatusArgs }) => void
  mcpServerScaleEvent: (args: {
    workspaceId: number
    data: { workspaceId: number; replicas: number; mcpServerId: number }
  }) => void
  mcpServerConnected: (args: {
    workspaceId: number
    data: { workspaceId: number; mcpServerId: number }
  }) => void
}

export function buildWorkspaceRoom({ workspaceId }: { workspaceId: number }) {
  return `workspace:${workspaceId}`
}

export async function verifyWebsocketToken({
  token,
  type,
}: {
  token: string | undefined
  type: TokenType
}) {
  if (!token) return Result.error(new Error('No token provided'))

  try {
    const secret = new TextEncoder().encode(SECRET_TOKENS[type])
    const { payload } = await jwtVerify<WebSocketData>(token, secret)

    return Result.ok({ payload })
  } catch (err) {
    const error = err as Error
    return Result.error(error)
  }
}

export async function verifyWorkerWebsocketToken(token: string) {
  try {
    const secret = new TextEncoder().encode(
      configService.get<string>('BETTER_AUTH_SECRET') || 'default-worker-secret'
    )
    const { payload } = await jwtVerify<Record<string, unknown>>(token, secret)

    return Result.ok({ payload })
  } catch (err) {
    const error = err as Error
    return Result.error(error)
  }
}
