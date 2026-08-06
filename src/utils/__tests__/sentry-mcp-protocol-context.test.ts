import { describe, expect, it } from 'vitest';
import { buildMcpProtocolContextPayload } from '../sentry.ts';

describe('buildMcpProtocolContextPayload', () => {
  it('always reports the era and protocol version', () => {
    expect(
      buildMcpProtocolContextPayload({ era: 'modern', protocolVersion: '2026-07-28' }),
    ).toEqual({
      era: 'modern',
      protocolVersion: '2026-07-28',
    });
  });

  it('omits client capabilities when the client declares none', () => {
    const payload = buildMcpProtocolContextPayload({
      era: 'modern',
      protocolVersion: '2026-07-28',
      clientName: 'probe',
      clientVersion: '1.0.0',
      clientCapabilities: [],
    });

    expect(payload).not.toHaveProperty('clientCapabilities');
    expect(payload).toEqual({
      era: 'modern',
      protocolVersion: '2026-07-28',
      clientName: 'probe',
      clientVersion: '1.0.0',
    });
  });

  it('omits client capabilities when they are not provided', () => {
    expect(
      buildMcpProtocolContextPayload({ era: 'legacy', protocolVersion: '2025-06-18' }),
    ).not.toHaveProperty('clientCapabilities');
  });

  it('joins declared client capabilities', () => {
    expect(
      buildMcpProtocolContextPayload({
        era: 'modern',
        protocolVersion: '2026-07-28',
        clientCapabilities: ['elicitation', 'experimental'],
      }).clientCapabilities,
    ).toBe('elicitation,experimental');
  });

  it('omits empty client name and version rather than emitting blanks', () => {
    const payload = buildMcpProtocolContextPayload({
      era: 'modern',
      protocolVersion: '2026-07-28',
      clientName: '',
      clientVersion: '',
    });

    expect(payload).not.toHaveProperty('clientName');
    expect(payload).not.toHaveProperty('clientVersion');
  });
});
