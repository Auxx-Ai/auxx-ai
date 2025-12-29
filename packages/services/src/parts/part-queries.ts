// packages/services/src/parts/part-queries.ts

import { database, schema } from '@auxx/database'
import { eq, and, or, ilike, gt } from 'drizzle-orm'
import { ok, err } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { PartContext, GetAllPartsInput, CheckSkuExistsInput } from './types'

/**
 * Get all parts with pagination and search
 */
export async function getAllParts(input: GetAllPartsInput) {
  const { organizationId, cursor, limit, sortOrder, orderBy, searchParams } = input
  const take = limit + 1

  const result = await fromDatabase(
    database.query.Part.findMany({
      where: (part, { and, eq, or, ilike, gt }) => {
        const conditions = [eq(part.organizationId, organizationId)]

        if (searchParams?.category) {
          conditions.push(eq(part.category, searchParams.category))
        }

        if (searchParams?.query) {
          conditions.push(
            or(
              ilike(part.title, `%${searchParams.query}%`),
              ilike(part.sku, `%${searchParams.query}%`),
              ilike(part.description, `%${searchParams.query}%`)
            )!
          )
        }

        if (cursor) {
          conditions.push(gt(part.id, cursor))
        }

        return and(...conditions)
      },
      with: {
        inventory: true,
      },
      orderBy: (part, { desc, asc }) => [
        sortOrder === 'desc' ? desc(part[orderBy]) : asc(part[orderBy]),
      ],
      limit: take,
    }),
    'get-all-parts'
  )

  if (result.isErr()) return result

  const parts = result.value
  const hasMore = parts.length > limit
  const resultParts = hasMore ? parts.slice(0, limit) : parts
  const nextCursor = hasMore ? resultParts[resultParts.length - 1]?.id : null

  return ok({ parts: resultParts, nextCursor })
}

/**
 * Get a single part by ID with all relations
 */
export async function getPartById(input: { partId: string } & PartContext) {
  const { partId, organizationId } = input

  const result = await fromDatabase(
    database.query.Part.findFirst({
      where: (part, { and, eq }) =>
        and(eq(part.id, partId), eq(part.organizationId, organizationId)),
      with: {
        inventory: true,
        subparts: {
          with: {
            childPart: true,
          },
        },
        vendorParts: {
          with: {
            contact: true,
          },
          orderBy: (vendorPart: any, { desc }: any) => [desc(vendorPart.isPreferred)],
        },
        parentParts: {
          with: {
            parentPart: true,
          },
        },
      },
    }),
    'get-part-by-id'
  )

  if (result.isErr()) return result

  if (!result.value) {
    return err({
      code: 'PART_NOT_FOUND' as const,
      message: `Part ${partId} not found`,
      partId,
    })
  }

  return ok(result.value)
}

/**
 * Check if a SKU already exists
 */
export async function checkSkuExists(input: CheckSkuExistsInput) {
  const { organizationId, sku, excludeId } = input

  const result = await fromDatabase(
    database.query.Part.findFirst({
      where: (part, { and, eq, ne }) => {
        const conditions = [eq(part.organizationId, organizationId), eq(part.sku, sku)]
        if (excludeId) {
          conditions.push(ne(part.id, excludeId))
        }
        return and(...conditions)
      },
      columns: { id: true },
    }),
    'check-sku-exists'
  )

  if (result.isErr()) return result

  return ok(!!result.value)
}

/**
 * Get attachments for a part
 */
export async function getPartAttachments(partId: string) {
  return fromDatabase(
    database.query.File.findMany({
      where: (file, { and, eq }) =>
        and(eq(file.entityId, partId), eq(file.entityType, 'Part')),
    }),
    'get-part-attachments'
  )
}

/**
 * Get all leaf parts (parts without subparts) for cost calculation
 */
export async function getLeafParts(organizationId: string) {
  const allPartsResult = await fromDatabase(
    database.query.Part.findMany({
      where: (part, { eq }) => eq(part.organizationId, organizationId),
      columns: { id: true },
    }),
    'get-all-part-ids'
  )

  if (allPartsResult.isErr()) return allPartsResult

  const partsWithSubpartsResult = await fromDatabase(
    database.query.Subpart.findMany({
      where: (subpart, { eq }) => eq(subpart.organizationId, organizationId),
      columns: { parentPartId: true },
    }),
    'get-parts-with-subparts'
  )

  if (partsWithSubpartsResult.isErr()) return partsWithSubpartsResult

  const partsWithSubpartsSet = new Set(
    partsWithSubpartsResult.value.map((p) => p.parentPartId)
  )
  const leafParts = allPartsResult.value.filter(
    (part) => !partsWithSubpartsSet.has(part.id)
  )

  return ok(leafParts)
}

/**
 * Get parent parts for a child part (for cost propagation after delete)
 */
export async function getParentPartIds(childPartId: string) {
  const result = await fromDatabase(
    database.query.Subpart.findMany({
      where: (subpart, { eq }) => eq(subpart.childPartId, childPartId),
      columns: { parentPartId: true },
    }),
    'get-parent-part-ids'
  )

  if (result.isErr()) return result

  return ok(result.value.map((p) => p.parentPartId))
}
