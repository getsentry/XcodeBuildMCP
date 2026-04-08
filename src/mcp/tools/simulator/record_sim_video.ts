import * as z from 'zod';
import {
  getDefaultCommandExecutor,
  getDefaultFileSystemExecutor,
} from '../../../utils/execution/index.ts';
import type { CommandExecutor, FileSystemExecutor } from '../../../utils/execution/index.ts';
import {
  areAxeToolsAvailable,
  isAxeAtLeastVersion,
  AXE_NOT_AVAILABLE_MESSAGE,
} from '../../../utils/axe/index.ts';
import {
  startSimulatorVideoCapture,
  stopSimulatorVideoCapture,
} from '../../../utils/video-capture/index.ts';
import {
  createSessionAwareTool,
  getSessionAwareToolSchemaShape,
  getHandlerContext,
} from '../../../utils/typed-tool-factory.ts';
import { dirname } from 'path';
import { header, statusLine, detailTree, section } from '../../../utils/tool-event-builders.ts';

// Base schema object (used for MCP schema exposure)
const recordSimVideoSchemaObject = z.object({
  simulatorId: z
    .uuid({ message: 'Invalid Simulator UUID format' })
    .describe('UUID of the simulator to record'),
  start: z.boolean().optional(),
  stop: z.boolean().optional(),
  fps: z.number().int().min(1).max(120).optional().describe('default: 30'),
  outputFile: z.string().optional().describe('Path to write MP4 file'),
});

// Schema enforcing mutually exclusive start/stop and requiring outputFile on stop
const recordSimVideoSchema = recordSimVideoSchemaObject
  .refine(
    (v) => {
      const s = v.start === true ? 1 : 0;
      const t = v.stop === true ? 1 : 0;
      return s + t === 1;
    },
    {
      message:
        'Provide exactly one of start=true or stop=true; these options are mutually exclusive',
      path: ['start'],
    },
  )
  .refine((v) => (v.stop ? typeof v.outputFile === 'string' && v.outputFile.length > 0 : true), {
    message: 'outputFile is required when stop=true',
    path: ['outputFile'],
  });

type RecordSimVideoParams = z.infer<typeof recordSimVideoSchema>;

export async function record_sim_videoLogic(
  params: RecordSimVideoParams,
  executor: CommandExecutor,
  axe: {
    areAxeToolsAvailable(): boolean;
    isAxeAtLeastVersion(v: string, e: CommandExecutor): Promise<boolean>;
  } = {
    areAxeToolsAvailable,
    isAxeAtLeastVersion,
  },
  video: {
    startSimulatorVideoCapture: typeof startSimulatorVideoCapture;
    stopSimulatorVideoCapture: typeof stopSimulatorVideoCapture;
  } = {
    startSimulatorVideoCapture,
    stopSimulatorVideoCapture,
  },
  fs: FileSystemExecutor = getDefaultFileSystemExecutor(),
): Promise<void> {
  const ctx = getHandlerContext();
  const headerEvent = header('Record Video', [{ label: 'Simulator', value: params.simulatorId }]);

  if (!axe.areAxeToolsAvailable()) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', AXE_NOT_AVAILABLE_MESSAGE));
    return;
  }
  const hasVersion = await axe.isAxeAtLeastVersion('1.1.0', executor);
  if (!hasVersion) {
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine(
        'error',
        'AXe v1.1.0 or newer is required for simulator video capture. Please update bundled AXe artifacts.',
      ),
    );
    return;
  }

  if (params.start) {
    const fpsUsed = params.fps ?? 30;
    const startRes = await video.startSimulatorVideoCapture(
      { simulatorUuid: params.simulatorId, fps: fpsUsed },
      executor,
    );

    if (!startRes.started) {
      ctx.emit(headerEvent);
      ctx.emit(statusLine('error', `Failed to start video recording: ${startRes.error}`));
      return;
    }

    const notes: string[] = [];
    if (typeof params.outputFile === 'string' && params.outputFile.length > 0) {
      notes.push(
        'Note: outputFile is ignored when start=true; provide it when stopping to move/rename the recorded file.',
      );
    }
    if (startRes.warning) {
      notes.push(startRes.warning);
    }

    ctx.emit(headerEvent);
    ctx.emit(
      detailTree([
        { label: 'FPS', value: String(fpsUsed) },
        { label: 'Session', value: startRes.sessionId },
      ]),
    );
    if (notes.length > 0) {
      ctx.emit(section('Notes', notes));
    }
    ctx.emit(
      statusLine(
        'success',
        `Video recording started for simulator ${params.simulatorId} at ${fpsUsed} fps`,
      ),
    );
    ctx.nextStepParams = {
      record_sim_video: {
        simulatorId: params.simulatorId,
        stop: true,
        outputFile: '/path/to/output.mp4',
      },
    };
    return;
  }

  // params.stop must be true here per schema
  const stopRes = await video.stopSimulatorVideoCapture(
    { simulatorUuid: params.simulatorId },
    executor,
  );

  if (!stopRes.stopped) {
    ctx.emit(headerEvent);
    ctx.emit(statusLine('error', `Failed to stop video recording: ${stopRes.error}`));
    return;
  }

  const outputs: string[] = [];
  let finalSavedPath = params.outputFile ?? stopRes.parsedPath ?? '';
  try {
    if (params.outputFile) {
      if (!stopRes.parsedPath) {
        ctx.emit(headerEvent);
        ctx.emit(
          statusLine(
            'error',
            `Recording stopped but could not determine the recorded file path from AXe output. Raw output: ${stopRes.stdout ?? '(no output captured)'}`,
          ),
        );
        return;
      }

      const src = stopRes.parsedPath;
      const dest = params.outputFile;
      await fs.mkdir(dirname(dest), { recursive: true });
      await fs.cp(src, dest);
      try {
        await fs.rm(src, { recursive: false });
      } catch {
        // Ignore cleanup failure
      }
      finalSavedPath = dest;

      outputs.push(`Original file: ${src}`);
      outputs.push(`Saved to: ${dest}`);
    } else if (stopRes.parsedPath) {
      outputs.push(`Saved to: ${stopRes.parsedPath}`);
      finalSavedPath = stopRes.parsedPath;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.emit(headerEvent);
    ctx.emit(
      statusLine('error', `Recording stopped but failed to save/move the video file: ${msg}`),
    );
    return;
  }

  ctx.emit(headerEvent);
  if (outputs.length > 0) {
    ctx.emit(section('Output', outputs));
  } else if (stopRes.stdout) {
    ctx.emit(section('AXe Output', [stopRes.stdout]));
  }
  ctx.emit(statusLine('success', `Video recording stopped for simulator ${params.simulatorId}`));
}

const publicSchemaObject = z.strictObject(
  recordSimVideoSchemaObject.omit({ simulatorId: true } as const).shape,
);

export const schema = getSessionAwareToolSchemaShape({
  sessionAware: publicSchemaObject,
  legacy: recordSimVideoSchemaObject,
});

export const handler = createSessionAwareTool<RecordSimVideoParams>({
  internalSchema: recordSimVideoSchema as unknown as z.ZodType<RecordSimVideoParams, unknown>,
  logicFunction: record_sim_videoLogic,
  getExecutor: getDefaultCommandExecutor,
  requirements: [{ allOf: ['simulatorId'], message: 'simulatorId is required' }],
});
