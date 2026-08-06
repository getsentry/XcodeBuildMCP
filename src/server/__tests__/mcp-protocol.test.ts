import { describe, expect, it } from 'vitest';
import {
  MCP_CACHE_HINTS,
  MCP_METHOD_HEADER,
  MCP_NAME_HEADER,
  MCP_PROTOCOL_VERSION_HEADER,
  MODERN_PROTOCOL_VERSION,
  buildModernHttpHeaders,
  encodeMcpHeaderValue,
  mcpNameHeaderValue,
  readModernRequestEnvelope,
} from '../mcp-protocol.ts';

describe('modern protocol helpers', () => {
  it('uses the 2026-07-28 revision string', () => {
    expect(MODERN_PROTOCOL_VERSION).toBe('2026-07-28');
  });

  it('derives the Mcp-Name header value per method', () => {
    expect(mcpNameHeaderValue('tools/call', { name: 'build_sim' })).toBe('build_sim');
    expect(mcpNameHeaderValue('prompts/get', { name: 'review' })).toBe('review');
    expect(mcpNameHeaderValue('resources/read', { uri: 'xcodebuildmcp://simulators' })).toBe(
      'xcodebuildmcp://simulators',
    );
    expect(mcpNameHeaderValue('tools/list', {})).toBeUndefined();
    expect(mcpNameHeaderValue('tools/call', null)).toBeUndefined();
  });

  it('base64-encodes header values that are not printable ASCII', () => {
    expect(encodeMcpHeaderValue('build_sim')).toBe('build_sim');
    expect(encodeMcpHeaderValue('café')).toBe(
      `=?base64?${Buffer.from('café', 'utf8').toString('base64')}?=`,
    );
  });

  it('builds the required modern HTTP headers', () => {
    expect(buildModernHttpHeaders('tools/call', { name: 'build_sim' })).toEqual({
      [MCP_PROTOCOL_VERSION_HEADER]: MODERN_PROTOCOL_VERSION,
      [MCP_METHOD_HEADER]: 'tools/call',
      [MCP_NAME_HEADER]: 'build_sim',
    });

    expect(buildModernHttpHeaders('tools/list', {})).toEqual({
      [MCP_PROTOCOL_VERSION_HEADER]: MODERN_PROTOCOL_VERSION,
      [MCP_METHOD_HEADER]: 'tools/list',
    });
  });

  it('reads the modern per-request envelope', () => {
    const envelope = readModernRequestEnvelope({
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientInfo': { name: 'probe', version: '1.2.3' },
        'io.modelcontextprotocol/clientCapabilities': { elicitation: { form: {} } },
        'io.modelcontextprotocol/logLevel': 'debug',
      },
    });

    expect(envelope).toEqual({
      protocolVersion: MODERN_PROTOCOL_VERSION,
      clientInfo: { name: 'probe', version: '1.2.3' },
      clientCapabilities: { elicitation: { form: {} } },
      logLevel: 'debug',
    });
  });

  it('returns null for legacy-era params that carry no envelope', () => {
    expect(readModernRequestEnvelope(undefined)).toBeNull();
    expect(readModernRequestEnvelope({})).toBeNull();
    expect(readModernRequestEnvelope({ _meta: {} })).toBeNull();
    expect(
      readModernRequestEnvelope({
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'legacy', version: '1.0.0' },
      }),
    ).toBeNull();
  });

  it('defaults client capabilities to an empty object when malformed', () => {
    expect(
      readModernRequestEnvelope({
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': 'not-an-object',
        },
      }),
    ).toEqual({
      protocolVersion: MODERN_PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  });

  it('declares private cache hints for every cacheable operation', () => {
    const cacheableMethods = [
      'server/discover',
      'tools/list',
      'prompts/list',
      'resources/list',
      'resources/templates/list',
      'resources/read',
    ] as const;

    for (const method of cacheableMethods) {
      const hint = MCP_CACHE_HINTS[method];
      expect(hint, `missing cache hint for ${method}`).toBeDefined();
      expect(hint?.cacheScope).toBe('private');
      expect(hint?.ttlMs).toBeGreaterThanOrEqual(0);
    }
  });
});
