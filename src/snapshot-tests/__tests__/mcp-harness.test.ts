import { describe, expect, it, vi } from 'vitest';
import { connectMcpClientWithCleanup } from '../mcp-harness.ts';

describe('MCP snapshot harness connection cleanup', () => {
  it('closes both the client and transport when connecting fails', async () => {
    const connectionError = new Error('connection failed');
    const connect = vi.fn().mockRejectedValue(connectionError);
    const closeClient = vi.fn().mockRejectedValue(new Error('client close failed'));
    const closeTransport = vi.fn().mockResolvedValue(undefined);

    await expect(connectMcpClientWithCleanup(connect, closeClient, closeTransport)).rejects.toBe(
      connectionError,
    );

    expect(connect).toHaveBeenCalledOnce();
    expect(closeClient).toHaveBeenCalledOnce();
    expect(closeTransport).toHaveBeenCalledOnce();
  });
});
