// packages/lib/src/workflow-engine/constants/nodes/dataset.ts

/**
 * Constants for the Dataset node's embedding wait.
 *
 * Lives here rather than beside the processor so the builder panel and the
 * engine read the SAME numbers — the panel's help text promises the timeout,
 * and `workflow-engine/nodes/dataset/embedding-wait.ts` is what enforces it.
 * This module is client-safe (values only, no imports).
 */
export const DATASET_NODE_CONSTANTS = {
  EMBEDDING_WAIT: {
    /** Waiting is the default: see the DatasetProcessor docblock for why. */
    DEFAULT_WAIT_FOR_EMBEDDINGS: true,
    /** Comfortably covers a several-thousand-segment document at 20 segments/batch. */
    DEFAULT_TIMEOUT_MINUTES: 15,
    MIN_TIMEOUT_MINUTES: 1,
    MAX_TIMEOUT_MINUTES: 120,
  },
} as const
