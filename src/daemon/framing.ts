import type net from 'node:net';

/**
 * Write a length-prefixed JSON frame to a socket.
 * Format: 4-byte big-endian length + JSON payload
 */
export function writeFrame(socket: net.Socket, obj: unknown): void {
  const json = Buffer.from(JSON.stringify(obj), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0);
  socket.write(Buffer.concat([header, json]));
}

/**
 * Create a frame reader that buffers incoming data and emits complete messages.
 * Returns a function to be used as the 'data' event handler.
 */
export function createFrameReader(
  onMessage: (msg: unknown) => void,
  onError?: (err: Error) => void,
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const len = buffer.readUInt32BE(0);

      if (len > 100 * 1024 * 1024) {
        onError?.(new Error(`Message too large: ${len} bytes`));
        buffer = Buffer.alloc(0);
        return;
      }

      if (buffer.length < 4 + len) {
        return;
      }

      const payload = buffer.subarray(4, 4 + len);
      buffer = buffer.subarray(4 + len);

      try {
        const msg = JSON.parse(payload.toString('utf8')) as unknown;
        onMessage(msg);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };
}
