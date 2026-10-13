import { describe, it, expect, beforeAll } from 'react-native-harness';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import type { WebSocketConnectOptions } from 'react-native-nitro-websockets';
import { BASE, WS_BASE, WSS_TLS_BASE } from '../test-utils/server';

const WRONG_SHA256 = '00'.repeat(32);
const TIMEOUT_MS = 10_000;

let serverSha256 = '';

beforeAll(async () => {
  const res = await nitroFetch(`${BASE}/tls/fingerprint`);
  serverSha256 = (await res.json()).sha256;
});

type WsOutcome =
  | { kind: 'open'; message: string; ws: NitroWebSocket }
  | { kind: 'error'; error: string; code: number };

function connect(
  url: string,
  options?: WebSocketConnectOptions
): Promise<WsOutcome> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout connecting to ${url}`)),
      TIMEOUT_MS
    );
    let error = '';
    const ws = new NitroWebSocket(url, undefined, undefined, options);
    ws.onopen = () => {
      ws.onmessage = (e) => {
        clearTimeout(timer);
        resolve({ kind: 'open', message: e.data, ws });
      };
      ws.send('ping');
    };
    ws.onerror = (e) => {
      error = e;
    };
    ws.onclose = (e) => {
      clearTimeout(timer);
      resolve({ kind: 'error', error, code: e.code });
    };
  });
}

async function expectConnectFails(
  url: string,
  options?: WebSocketConnectOptions
) {
  const outcome = await connect(url, options);
  if (outcome.kind === 'open') outcome.ws.close();
  expect(outcome.kind).toBe('error');
  return outcome as Extract<WsOutcome, { kind: 'error' }>;
}

describe('Certificate pinning - WebSocket', () => {
  it('connects to a self-signed server whose certificate is pinned', async () => {
    const outcome = await connect(`${WSS_TLS_BASE}/ws/echo`, {
      trust: { certificateSha256: [WRONG_SHA256, serverSha256] },
    });
    expect(outcome.kind).toBe('open');
    if (outcome.kind === 'open') {
      expect(outcome.message).toBe('ping');
      outcome.ws.close();
    }
  });

  it('accepts lowercase hex without separators', async () => {
    const outcome = await connect(`${WSS_TLS_BASE}/ws/echo`, {
      trust: {
        certificateSha256: [serverSha256.replace(/:/g, '').toLowerCase()],
      },
    });
    expect(outcome.kind).toBe('open');
    if (outcome.kind === 'open') outcome.ws.close();
  });

  it('fails when the pin does not match', async () => {
    const outcome = await expectConnectFails(`${WSS_TLS_BASE}/ws/echo`, {
      trust: { certificateSha256: [WRONG_SHA256] },
    });
    expect(outcome.error).toContain('pinned');
    expect(outcome.code).toBe(1006);
  });

  it('fails without the trust option', async () => {
    await expectConnectFails(`${WSS_TLS_BASE}/ws/echo`);
  });

  it('still rejects an unpinned connection after a pinned one to the same server', async () => {
    const pinned = await connect(`${WSS_TLS_BASE}/ws/echo`, {
      trust: { certificateSha256: [serverSha256] },
    });
    expect(pinned.kind).toBe('open');
    await expectConnectFails(`${WSS_TLS_BASE}/ws/echo`);
    if (pinned.kind === 'open') pinned.ws.close();
  });

  it('rejects a publicly trusted server whose certificate is not pinned', async () => {
    await expectConnectFails('wss://echo.websocket.org', {
      trust: { certificateSha256: [WRONG_SHA256] },
    });
    const unpinned = await connect('wss://echo.websocket.org');
    expect(unpinned.kind).toBe('open');
    if (unpinned.kind === 'open') unpinned.ws.close();
  });

  it('fails for a ws:// URL', async () => {
    const outcome = await expectConnectFails(`${WS_BASE}/ws/echo`, {
      trust: { certificateSha256: [serverSha256] },
    });
    expect(outcome.error).toContain('wss://');
  });

  it('does not follow a redirect to ws://', async () => {
    const to = encodeURIComponent(`${WS_BASE}/ws/echo`);
    await expectConnectFails(`${WSS_TLS_BASE}/ws/redirect?to=${to}`, {
      trust: { certificateSha256: [serverSha256] },
    });
  });

  it('throws for a malformed fingerprint', () => {
    expect(
      () =>
        new NitroWebSocket(`${WSS_TLS_BASE}/ws/echo`, undefined, undefined, {
          trust: { certificateSha256: ['not-a-fingerprint'] },
        })
    ).toThrow();
    expect(
      () =>
        new NitroWebSocket(`${WSS_TLS_BASE}/ws/echo`, undefined, undefined, {
          trust: { certificateSha256: [] },
        })
    ).toThrow();
  });
});
