import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

const CLI_PATH = join(process.cwd(), 'build/cli.js');
const MCP_IDLE_TIMEOUT_MS = 1_000;
const MCP_KEEPALIVE_IDLE_TIMEOUT_MS = 1_500;
const LISTEN_REFRESH_INTERVAL_MS = 900;
const LISTEN_REFRESH_ROUNDS = 5;
const MCP_READY_TIMEOUT_MS = 20_000;
const MCP_EXIT_WAIT_MS = 15_000;
const MCP_TEST_TIMEOUT_MS = 45_000;
const MODERN_PROTOCOL_VERSION = '2026-07-28';

type ChildExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

interface JsonRpcMessage {
  id?: string | number;
  method?: string;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

function getSmokeTestEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const { VITEST: _vitest, NODE_ENV: _nodeEnv, ...rest } = process.env;
  const env = Object.fromEntries(
    Object.entries(rest).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
  return { ...env, ...overrides };
}

function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': {
      name: 'mcp-modern-idle-timeout-e2e-client',
      version: '1.0.0',
    },
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

/**
 * A raw modern-era stdio peer.
 *
 * The SDK client negotiates the 2025 era over stdio, so the 2026-07-28 wire
 * shape (and `subscriptions/listen`, which has no client helper that leaves the
 * request pending) is driven directly.
 */
class ModernStdioChild {
  readonly child: ChildProcess;
  private buffer = '';
  private stderrOutput = '';
  private nextId = 1;

  readonly messages: JsonRpcMessage[] = [];

  constructor(idleTimeoutMs: number) {
    this.child = spawn('node', [CLI_PATH, 'mcp'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: getSmokeTestEnv({
        SENTRY_DISABLED: 'true',
        XCODEBUILDMCP_ENABLED_WORKFLOWS: 'simulator',
        XCODEBUILDMCP_DISABLE_SESSION_DEFAULTS: 'true',
        XCODEBUILDMCP_DISABLE_XCODE_AUTO_SYNC: '1',
        XCODEBUILDMCP_MCP_IDLE_TIMEOUT_MS: String(idleTimeoutMs),
      }),
    });

    const stdout = this.child.stdout as Readable;
    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let newlineIndex = this.buffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = this.buffer.slice(0, newlineIndex).trim();
        this.buffer = this.buffer.slice(newlineIndex + 1);
        if (line) {
          this.messages.push(JSON.parse(line) as JsonRpcMessage);
        }
        newlineIndex = this.buffer.indexOf('\n');
      }
    });

    const stderr = this.child.stderr as Readable;
    stderr.setEncoding('utf8');
    stderr.on('data', (chunk: string) => {
      this.stderrOutput += chunk;
    });
  }

  get stderr(): string {
    return this.stderrOutput;
  }

  send(message: Record<string, unknown>): void {
    this.child.stdin?.write(`${JSON.stringify(message)}\n`);
  }

  sendRequest(method: string, params: Record<string, unknown> = {}): number {
    const id = this.nextId++;
    this.send({ jsonrpc: '2.0', id, method, params: { ...params, _meta: modernMeta() } });
    return id;
  }

  async awaitResult(id: number, timeoutMs: number): Promise<JsonRpcMessage> {
    return this.awaitMessage(
      (_message, matches) => matches >= 1,
      timeoutMs,
      `a response to request ${id}`,
      (message) =>
        message.id === id && (message.result !== undefined || message.error !== undefined),
    );
  }

  async awaitNotification(
    method: string,
    timeoutMs: number,
    occurrence = 1,
  ): Promise<JsonRpcMessage> {
    return this.awaitMessage(
      (_message, matches) => matches >= occurrence,
      timeoutMs,
      `${method} #${occurrence}`,
      (message) => message.method === method && message.id === undefined,
    );
  }

  private async awaitMessage(
    accept: (message: JsonRpcMessage, matchCount: number) => boolean,
    timeoutMs: number,
    description: string,
    filter: (message: JsonRpcMessage) => boolean = () => true,
  ): Promise<JsonRpcMessage> {
    const startedAt = Date.now();
    for (;;) {
      const matched = this.messages.filter(filter);
      const last = matched[matched.length - 1];
      if (last && accept(last, matched.length)) {
        return last;
      }
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for ${description}. stderr:\n${this.stderrOutput}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  waitForExit(timeoutMs: number): Promise<ChildExit> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return Promise.resolve({ code: this.child.exitCode, signal: this.child.signalCode });
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            `MCP server process did not exit within ${timeoutMs}ms. stderr:\n${this.stderrOutput}`,
          ),
        );
      }, timeoutMs);

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.child.removeListener('close', onClose);
      };

      const onClose = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        resolve({ code, signal });
      };

      this.child.once('close', onClose);
    });
  }

  async dispose(): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      return;
    }
    this.child.kill('SIGTERM');
    await this.waitForExit(3_000).catch(() => undefined);
  }
}

let activeChild: ModernStdioChild | null = null;

function requireBuild(): void {
  if (!existsSync(CLI_PATH)) {
    throw new Error(
      'MCP modern idle timeout e2e test requires build/cli.js. Run npm run build first.',
    );
  }
}

afterEach(async () => {
  await activeChild?.dispose();
  activeChild = null;
});

describe('MCP modern-era idle timeout e2e', () => {
  it(
    'exits after the client cancels a subscriptions/listen stream',
    async () => {
      requireBuild();
      const server = new ModernStdioChild(MCP_IDLE_TIMEOUT_MS);
      activeChild = server;

      const listId = server.sendRequest('tools/list');
      const tools = await server.awaitResult(listId, MCP_READY_TIMEOUT_MS);
      expect(tools.error).toBeUndefined();
      expect((tools.result?.tools as unknown[] | undefined)?.length).toBeGreaterThan(0);

      const listenId = server.sendRequest('subscriptions/listen', {
        notifications: { toolsListChanged: true, resourcesListChanged: true },
      });
      await server.awaitNotification(
        'notifications/subscriptions/acknowledged',
        MCP_READY_TIMEOUT_MS,
      );

      server.send({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: listenId, reason: 'test finished' },
      });

      const exit = await server.waitForExit(MCP_EXIT_WAIT_MS);
      activeChild = null;

      expect(exit).toEqual({ code: 0, signal: null });
      expect(server.stderr).toContain('MCP idle timeout reached');
    },
    MCP_TEST_TIMEOUT_MS,
  );

  it(
    'keeps the process alive while listen streams keep opening inside the idle window',
    async () => {
      requireBuild();
      const server = new ModernStdioChild(MCP_KEEPALIVE_IDLE_TIMEOUT_MS);
      activeChild = server;

      const listId = server.sendRequest('tools/list');
      await server.awaitResult(listId, MCP_READY_TIMEOUT_MS);
      const lastOrdinaryRequestAt = Date.now();

      // Open a subscription every time the window is about to lapse, and never
      // send any other traffic. Opening a stream is real client activity, so it
      // must refresh the idle window; without that refresh the server shuts
      // down at the first idle check after `lastOrdinaryRequestAt`.
      for (let round = 0; round < LISTEN_REFRESH_ROUNDS; round += 1) {
        await new Promise((resolve) => setTimeout(resolve, LISTEN_REFRESH_INTERVAL_MS));

        if (server.child.exitCode !== null || server.child.signalCode !== null) {
          throw new Error(
            `MCP server exited after ${Date.now() - lastOrdinaryRequestAt}ms of listen-only ` +
              `activity (round ${round}); opening a subscription did not refresh the idle window.`,
          );
        }

        server.sendRequest('subscriptions/listen', {
          notifications: { toolsListChanged: true },
        });
        await server.awaitNotification(
          'notifications/subscriptions/acknowledged',
          MCP_READY_TIMEOUT_MS,
          round + 1,
        );
      }

      const keptAliveForMs = Date.now() - lastOrdinaryRequestAt;
      expect(server.child.exitCode).toBeNull();
      expect(keptAliveForMs).toBeGreaterThan(MCP_KEEPALIVE_IDLE_TIMEOUT_MS * 2);

      // Refreshing is a delay, not a reprieve: once the streams stop opening,
      // idle shutdown still runs.
      const exit = await server.waitForExit(MCP_EXIT_WAIT_MS);
      activeChild = null;

      expect(exit).toEqual({ code: 0, signal: null });
      expect(server.stderr).toContain('MCP idle timeout reached');
    },
    MCP_TEST_TIMEOUT_MS,
  );

  it(
    'exits while a subscriptions/listen stream is still open',
    async () => {
      requireBuild();
      const server = new ModernStdioChild(MCP_IDLE_TIMEOUT_MS);
      activeChild = server;

      const listId = server.sendRequest('tools/list');
      await server.awaitResult(listId, MCP_READY_TIMEOUT_MS);

      server.sendRequest('subscriptions/listen', {
        notifications: { toolsListChanged: true },
      });
      await server.awaitNotification(
        'notifications/subscriptions/acknowledged',
        MCP_READY_TIMEOUT_MS,
      );

      // An idle subscription carries no traffic, so it must not hold the
      // process open past the configured idle timeout.
      const exit = await server.waitForExit(MCP_EXIT_WAIT_MS);
      activeChild = null;

      expect(exit).toEqual({ code: 0, signal: null });
      expect(server.stderr).toContain('MCP idle timeout reached');
    },
    MCP_TEST_TIMEOUT_MS,
  );
});
