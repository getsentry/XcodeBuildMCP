import { EventEmitter } from 'node:events';
import type { InteractiveProcess, InteractiveSpawner } from '../../execution/index.ts';
import { log } from '../../logging/index.ts';
import type { DapEvent, DapRequest, DapResponse } from './types.ts';

const DEFAULT_LOG_PREFIX = '[DAP Transport]';

export type DapTransportOptions = {
  spawner: InteractiveSpawner;
  adapterCommand: string[];
  env?: Record<string, string>;
  cwd?: string;
  logPrefix?: string;
};

type PendingRequest = {
  command: string;
  resolve: (body: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

export class DapTransport {
  private readonly process: InteractiveProcess;
  private readonly logPrefix: string;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly events = new EventEmitter();
  private nextSeq = 1;
  private buffer = Buffer.alloc(0);
  private disposed = false;
  private exited = false;

  constructor(options: DapTransportOptions) {
    this.logPrefix = options.logPrefix ?? DEFAULT_LOG_PREFIX;
    this.process = options.spawner(options.adapterCommand, {
      env: options.env,
      cwd: options.cwd,
    });

    this.process.process.stdout?.on('data', (data: Buffer) => this.handleStdout(data));
    this.process.process.stderr?.on('data', (data: Buffer) => this.handleStderr(data));
    this.process.process.on('exit', (code, signal) => this.handleExit(code, signal));
    this.process.process.on('error', (error) => this.handleError(error));
  }

  sendRequest<A, B>(command: string, args?: A, opts?: { timeoutMs?: number }): Promise<B> {
    if (this.disposed || this.exited) {
      return Promise.reject(new Error('DAP transport is not available'));
    }

    const seq = this.nextSeq++;
    const request: DapRequest<A> = {
      seq,
      type: 'request',
      command,
      arguments: args,
    };

    const payload = JSON.stringify(request);
    const message = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;

    return new Promise<B>((resolve, reject) => {
      const timeoutMs = opts?.timeoutMs ?? 30_000;
      const timeout = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`DAP request timed out after ${timeoutMs}ms (${command})`));
      }, timeoutMs);

      this.pending.set(seq, {
        command,
        resolve: (body) => resolve(body as B),
        reject,
        timeout,
      });

      try {
        this.process.write(message);
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(seq);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onEvent(handler: (event: DapEvent) => void): () => void {
    this.events.on('event', handler);
    return () => {
      this.events.off('event', handler);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.failAllPending(new Error('DAP transport disposed'));
    try {
      this.process.dispose();
    } catch (error) {
      log('debug', `${this.logPrefix} dispose error: ${String(error)}`);
    }
  }

  private handleStdout(data: Buffer): void {
    if (this.disposed) return;
    this.buffer = Buffer.concat([this.buffer, data]);
    this.processBuffer();
  }

  private handleStderr(data: Buffer): void {
    if (this.disposed) return;
    const message = data.toString('utf8').trim();
    if (!message) return;
    log('debug', `${this.logPrefix} stderr: ${message}`);
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true;
    const detail = signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`;
    this.failAllPending(new Error(`DAP adapter exited (${detail})`));
  }

  private handleError(error: Error): void {
    this.exited = true;
    this.failAllPending(new Error(`DAP adapter error: ${error.message}`));
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const contentLength = this.parseContentLength(header);
      if (contentLength == null) {
        log('error', `${this.logPrefix} invalid DAP header: ${header}`);
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const bodyBuffer = this.buffer.slice(messageStart, messageEnd);
      this.buffer = this.buffer.slice(messageEnd);

      try {
        const message = JSON.parse(bodyBuffer.toString('utf8')) as
          | DapResponse
          | DapEvent
          | DapRequest;
        this.handleMessage(message);
      } catch (error) {
        log('error', `${this.logPrefix} failed to parse DAP message: ${String(error)}`);
      }
    }
  }

  private handleMessage(message: DapResponse | DapEvent | DapRequest): void {
    if (message.type === 'response') {
      const pending = this.pending.get(message.request_seq);
      if (!pending) {
        log('debug', `${this.logPrefix} received response without pending request`);
        return;
      }

      this.pending.delete(message.request_seq);
      clearTimeout(pending.timeout);

      if (!message.success) {
        const bodyError = (message.body as { error?: { format?: string } } | undefined)?.error
          ?.format;
        const detail = message.message ?? bodyError ?? 'DAP request failed';
        pending.reject(new Error(`${pending.command} failed: ${detail}`));
        return;
      }

      pending.resolve(message.body ?? {});
      return;
    }

    if (message.type === 'event') {
      this.events.emit('event', message);
      return;
    }

    log('debug', `${this.logPrefix} ignoring DAP request: ${message.command ?? 'unknown'}`);
  }

  private parseContentLength(header: string): number | null {
    const lines = header.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^Content-Length:\s*(\d+)/i);
      if (match) {
        const length = Number(match[1]);
        return Number.isFinite(length) ? length : null;
      }
    }
    return null;
  }

  private failAllPending(error: Error): void {
    for (const [seq, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(seq);
    }
  }
}
