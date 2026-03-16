// packages/lib/src/cache/accessors.ts

/**
 * Accessor for array-shaped cache values (resources, members, inboxes, overages).
 * Provides .all(), .byId(), .find(), .filter() and custom aliases.
 */
export class ArrayAccessor<T extends { id: string }> {
  constructor(private dataFn: () => Promise<T[]>) {}

  /** Get all items */
  async all(): Promise<T[]> {
    return this.dataFn()
  }

  /** Find by id */
  async byId(id: string): Promise<T | null> {
    const data = await this.dataFn()
    return data.find((item) => item.id === id) ?? null
  }

  /** Find first matching predicate */
  async find(predicate: (item: T) => boolean): Promise<T | null> {
    const data = await this.dataFn()
    return data.find(predicate) ?? null
  }

  /** Filter by predicate */
  async filter(predicate: (item: T) => boolean): Promise<T[]> {
    const data = await this.dataFn()
    return data.filter(predicate)
  }

  /** Count items (optionally filtered) */
  async count(predicate?: (item: T) => boolean): Promise<number> {
    const data = await this.dataFn()
    return predicate ? data.filter(predicate).length : data.length
  }

  /** Check if item exists */
  async has(id: string): Promise<boolean> {
    return (await this.byId(id)) !== null
  }
}

/**
 * Accessor for record-shaped cache values (entityDefs, memberRoleMap, etc.).
 * Provides .all(), .byKey(), .values(), .has().
 */
export class RecordAccessor<T> {
  constructor(private dataFn: () => Promise<Record<string, T>>) {}

  /** Get full record */
  async all(): Promise<Record<string, T>> {
    return this.dataFn()
  }

  /** Get value by key */
  async byKey(key: string): Promise<T | null> {
    const data = await this.dataFn()
    return data[key] ?? null
  }

  /** Get all values as array */
  async values(): Promise<T[]> {
    const data = await this.dataFn()
    return Object.values(data)
  }

  /** Get all keys */
  async keys(): Promise<string[]> {
    const data = await this.dataFn()
    return Object.keys(data)
  }

  /** Check if key exists */
  async has(key: string): Promise<boolean> {
    const data = await this.dataFn()
    return key in data
  }
}

/**
 * Accessor for nested record-shaped cache values (customFields: Record<string, T[]>).
 * Provides .in(scope) to drill into a specific group, and .deep() to search across all groups.
 */
export class NestedRecordAccessor<T extends { id: string }> {
  constructor(private dataFn: () => Promise<Record<string, T[]>>) {}

  /** Get full grouped record */
  async all(): Promise<Record<string, T[]>> {
    return this.dataFn()
  }

  /** Scope into a specific group — returns ArrayAccessor for that group */
  in(groupKey: string): ArrayAccessor<T> {
    return new ArrayAccessor(async () => {
      const data = await this.dataFn()
      return data[groupKey] ?? []
    })
  }

  /** Search across ALL groups (flattened) */
  deep(): ArrayAccessor<T> {
    return new ArrayAccessor(async () => {
      const data = await this.dataFn()
      return Object.values(data).flat()
    })
  }

  /** Get keys (group IDs) */
  async keys(): Promise<string[]> {
    const data = await this.dataFn()
    return Object.keys(data)
  }
}

/**
 * Accessor for scalar cache values (systemUser: string, subscription: T | null).
 */
export class ScalarAccessor<T> {
  constructor(private dataFn: () => Promise<T>) {}

  /** Get the value */
  async value(): Promise<T> {
    return this.dataFn()
  }
}
