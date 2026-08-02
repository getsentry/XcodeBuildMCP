import * as z from 'zod';

const environmentVariableEntrySchema = z.strictObject({
  key: z.string().min(1),
  value: z.string(),
});

export const environmentVariableEntriesSchema = z
  .array(environmentVariableEntrySchema)
  .superRefine((entries, ctx) => {
    const seenKeys = new Set<string>();

    entries.forEach((entry, index) => {
      if (seenKeys.has(entry.key)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate environment variable key: ${entry.key}`,
          path: [index, 'key'],
        });
      }
      seenKeys.add(entry.key);
    });
  });

export function createEnvironmentVariableInputSchema(
  description: string,
): z.ZodOptional<typeof environmentVariableEntriesSchema> {
  return environmentVariableEntriesSchema.optional().describe(description);
}

export const testRunnerEnvironmentSchema = createEnvironmentVariableInputSchema(
  'Environment variables to pass to the test runner (TEST_RUNNER_ prefix added automatically)',
);

export function toEnvironmentVariableRecord(
  entries: z.infer<typeof environmentVariableEntriesSchema> | undefined,
): Record<string, string> | undefined {
  return entries === undefined
    ? undefined
    : Object.fromEntries(entries.map(({ key, value }) => [key, value]));
}

export function normalizeEnvironmentVariableArgument(
  args: Record<string, unknown>,
  key: 'env' | 'testRunnerEnv',
): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(args, key)) {
    return args;
  }

  if (typeof args[key] === 'object' && args[key] !== null && !Array.isArray(args[key])) {
    return args;
  }

  const entries = environmentVariableEntriesSchema.parse(args[key]);
  return {
    ...args,
    [key]: toEnvironmentVariableRecord(entries),
  };
}
