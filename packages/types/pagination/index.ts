// packages/types/pagination/index.ts

/** Paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

/** Standard API response wrapper */
export interface APIResponse<T> {
  success: boolean
  data?: T
  error?: string
}
