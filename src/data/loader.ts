import { z } from 'zod';
import { DatasetSchema, type Dataset } from './schema';

/**
 * Dataset loader (spec §4.1). The only thing that reads `dataset.<version>.json`.
 * Validation is runtime because the data originates outside the type system (a bundled
 * asset produced by the pipeline) — this is the gate that both the community bootstrap
 * and our own extraction must pass.
 */

/** Parse + validate. Throws a formatted error listing every violation. */
export function parseDataset(input: unknown): Dataset {
  const result = DatasetSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid dataset:\n${formatIssues(result.error)}`);
  }
  return result.data;
}

/** Non-throwing variant for callers that want to inspect the result. */
export function safeParseDataset(input: unknown) {
  return DatasetSchema.safeParse(input);
}

/** Render Zod issues as a readable, one-per-line list keyed by path. */
export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `  • ${path}: ${issue.message}`;
    })
    .join('\n');
}
