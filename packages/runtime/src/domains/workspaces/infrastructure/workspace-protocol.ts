import { z } from "zod";

export const workspaceLimits = {
  timeoutMs: 5000,
  sourceBytes: 16_384,
  outputBytes: 32_768,
  fileBytes: 8 * 1024 * 1024,
  checkpointBytes: 12 * 1024 * 1024,
  entries: 1024,
  receiptsBytes: 16 * 1024 * 1024,
  queued: 16,
  concurrent: 4,
};

export const checkpointSchema = z
  .array(
    z
      .object({
        path: z
          .string()
          .max(1024)
          .refine(
            (p) =>
              p === "/workspace" ||
              (p.startsWith("/workspace/") &&
                !p
                  .split("/")
                  .slice(1)
                  .some((s) => s === ".." || s === "." || s === "")),
          ),
        kind: z.enum(["file", "directory", "symlink"]),
        content: z.string().max(workspaceLimits.checkpointBytes),
        mode: z.number().int().min(0).max(0xffff),
        mtime: z.number().finite(),
      })
      .strict(),
  )
  .max(workspaceLimits.entries);

export type Checkpoint = z.infer<typeof checkpointSchema>;

export const executionResultSchema = z
  .object({
    stdout: z.string().max(workspaceLimits.outputBytes),
    stderr: z.string().max(workspaceLimits.outputBytes),
    exitCode: z.number().int(),
    committed: z.boolean(),
  })
  .strict();

export type ExecutionResult = z.infer<typeof executionResultSchema>;

export type ComputeRequest = { checkpoint: Checkpoint; command: string };

export const computeResponseSchema = z
  .object({ checkpoint: checkpointSchema, result: executionResultSchema })
  .strict();

export type ComputeResponse = z.infer<typeof computeResponseSchema>;
