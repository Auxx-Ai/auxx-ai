// packages/sdk/src/root/settings/base-node.ts

import { BaseSchemaNode, type BaseSchemaOptions } from '../schema/base-node.js'

/**
 * Settings-specific options
 * Re-export from shared schema for backward compatibility
 */
export interface BaseSettingOptions<TValue = unknown> extends BaseSchemaOptions<TValue> {}

/**
 * Base class for all settings nodes
 * Extends shared schema base for consistency
 */
export abstract class BaseNode<
  TType extends string = string,
  TValue = unknown,
  TOptions extends BaseSettingOptions<TValue> = BaseSettingOptions<TValue>,
> extends BaseSchemaNode<TType, TValue, TOptions> {}
