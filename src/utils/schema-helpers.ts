import * as z from 'zod';

export function nullifyEmptyStrings(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const copy: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const key of Object.keys(copy)) {
      const v = copy[key];
      if (typeof v === 'string' && v.trim() === '') copy[key] = undefined;
    }
    return copy;
  }
  return value;
}

export function withProjectOrWorkspace<T extends z.ZodObject>(baseObject: T) {
  return baseObject
    .refine(
      (val: { projectPath?: unknown; workspacePath?: unknown }) =>
        val.projectPath !== undefined || val.workspacePath !== undefined,
      { message: 'Either projectPath or workspacePath is required.' },
    )
    .refine(
      (val: { projectPath?: unknown; workspacePath?: unknown }) =>
        !(val.projectPath !== undefined && val.workspacePath !== undefined),
      { message: 'projectPath and workspacePath are mutually exclusive. Provide only one.' },
    );
}

type SimulatorSelector = { simulatorId?: unknown; simulatorName?: unknown };

export function withSimulatorIdOrName<T extends z.ZodType<SimulatorSelector>>(schema: T) {
  return schema
    .refine((val) => val.simulatorId !== undefined || val.simulatorName !== undefined, {
      message: 'Either simulatorId or simulatorName is required.',
    })
    .refine((val) => !(val.simulatorId !== undefined && val.simulatorName !== undefined), {
      message: 'simulatorId and simulatorName are mutually exclusive. Provide only one.',
    });
}
