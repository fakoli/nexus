import { describe, it, expect } from 'vitest';
import {
  ConnectParams,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
} from '../protocol/frames.js';

describe('frames: ConnectParams', () => {
  it('accepts an empty object (no credentials)', () => {
    const result = ConnectParams.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a token', () => {
    const result = ConnectParams.safeParse({ token: 'my-token' });
    expect(result.success).toBe(true);
    expect(result.data?.token).toBe('my-token');
  });

  it('accepts a password', () => {
    const result = ConnectParams.safeParse({ password: 'hunter2' });
    expect(result.success).toBe(true);
  });

  it('accepts a deviceToken', () => {
    const result = ConnectParams.safeParse({ deviceToken: 'dev-tok' });
    expect(result.success).toBe(true);
  });

  it('accepts full client metadata', () => {
    const result = ConnectParams.safeParse({
      token: 'tok',
      client: { name: 'MyApp', version: '1.0.0', platform: 'darwin' },
    });
    expect(result.success).toBe(true);
    expect(result.data?.client?.platform).toBe('darwin');
  });

  it('rejects extra top-level fields (strict parsing not enforced — should pass through or strip)', () => {
    // Zod by default strips unknown keys; extra fields do not cause parse failure
    const result = ConnectParams.safeParse({ token: 'x', unknown: true });
    expect(result.success).toBe(true);
  });

  it('rejects non-string token', () => {
    const result = ConnectParams.safeParse({ token: 123 });
    expect(result.success).toBe(false);
  });
});

describe('frames: HelloOk', () => {
  const valid = {
    proto: 1 as const,
    server: { name: 'nexus', version: '0.1.0' },
    session: { id: 'sess-1', agentId: 'agent-1' },
  };

  it('accepts a valid HelloOk', () => {
    expect(HelloOk.safeParse(valid).success).toBe(true);
  });

  it('rejects wrong proto value', () => {
    expect(HelloOk.safeParse({ ...valid, proto: 2 }).success).toBe(false);
  });

  it('rejects missing server field', () => {
    const { server: _s, ...rest } = valid;
    expect(HelloOk.safeParse(rest).success).toBe(false);
  });

  it('rejects missing session field', () => {
    const { session: _s, ...rest } = valid;
    expect(HelloOk.safeParse(rest).success).toBe(false);
  });
});

describe('frames: RequestFrame', () => {
  it('accepts a minimal valid request', () => {
    const result = RequestFrame.safeParse({ id: 'req-1', method: 'chat.send', params: {} });
    expect(result.success).toBe(true);
  });

  it('defaults params to {} when omitted', () => {
    const result = RequestFrame.safeParse({ id: 'req-2', method: 'ping' });
    expect(result.success).toBe(true);
    expect(result.data?.params).toEqual({});
  });

  it('accepts params with values', () => {
    const result = RequestFrame.safeParse({
      id: 'req-3',
      method: 'chat.send',
      params: { sessionId: 's1', content: 'hello' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing id', () => {
    expect(RequestFrame.safeParse({ method: 'ping', params: {} }).success).toBe(false);
  });

  it('rejects missing method', () => {
    expect(RequestFrame.safeParse({ id: 'r1', params: {} }).success).toBe(false);
  });
});

describe('frames: ResponseFrame', () => {
  it('accepts a successful response with payload', () => {
    const result = ResponseFrame.safeParse({ id: 'resp-1', ok: true, payload: { data: 42 } });
    expect(result.success).toBe(true);
  });

  it('accepts a failure response with error', () => {
    const result = ResponseFrame.safeParse({
      id: 'resp-2',
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Resource not found' },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a response with no payload or error', () => {
    expect(ResponseFrame.safeParse({ id: 'resp-3', ok: true }).success).toBe(true);
  });

  it('rejects missing ok field', () => {
    expect(ResponseFrame.safeParse({ id: 'r1' }).success).toBe(false);
  });

  it('rejects non-boolean ok', () => {
    expect(ResponseFrame.safeParse({ id: 'r2', ok: 'yes' }).success).toBe(false);
  });

  it('rejects error without required code field', () => {
    expect(
      ResponseFrame.safeParse({ id: 'r3', ok: false, error: { message: 'oops' } }).success,
    ).toBe(false);
  });
});

describe('frames: EventFrame', () => {
  it('accepts a valid event frame', () => {
    const result = EventFrame.safeParse({ event: 'session:message', payload: {}, seq: 0 });
    expect(result.success).toBe(true);
  });

  it('defaults payload to {} when omitted', () => {
    const result = EventFrame.safeParse({ event: 'ping', seq: 1 });
    expect(result.success).toBe(true);
    expect(result.data?.payload).toEqual({});
  });

  it('rejects negative seq', () => {
    expect(EventFrame.safeParse({ event: 'ev', payload: {}, seq: -1 }).success).toBe(false);
  });

  it('rejects missing event field', () => {
    expect(EventFrame.safeParse({ payload: {}, seq: 0 }).success).toBe(false);
  });

  it('rejects non-integer seq', () => {
    expect(EventFrame.safeParse({ event: 'ev', payload: {}, seq: 1.5 }).success).toBe(false);
  });
});
