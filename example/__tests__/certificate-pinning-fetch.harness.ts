import { describe, it, expect, beforeAll } from 'react-native-harness';
import {
  NitroFetch,
  fetch as nitroFetch,
  nitroFetchOnWorklet,
  prefetch,
} from 'react-native-nitro-fetch';
import { BASE, TLS_BASE, TLS_OTHER_ORIGIN } from '../test-utils/server';

const WRONG_SHA256 = '00'.repeat(32);

let serverSha256 = '';

beforeAll(async () => {
  const res = await nitroFetch(`${BASE}/tls/fingerprint`);
  serverSha256 = (await res.json()).sha256;
});

async function rejection(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error('Expected the request to fail');
}

describe('Certificate pinning - fetch', () => {
  it('reports native support', () => {
    expect(NitroFetch.createClient().supportsTrust).toBe(true);
  });

  it('fetches from a self-signed server whose certificate is pinned', async () => {
    const res = await nitroFetch(`${TLS_BASE}/get?pinned=1`, {
      trust: { certificateSha256: [WRONG_SHA256, serverSha256] },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.args.pinned).toBe('1');
  });

  it('sends the body and follows https redirects', async () => {
    const res = await nitroFetch(`${TLS_BASE}/redirect/2`, {
      trust: { certificateSha256: [serverSha256] },
    });
    expect(res.status).toBe(200);
    expect(res.redirected).toBe(true);
    const post = await nitroFetch(`${TLS_BASE}/post`, {
      method: 'POST',
      body: 'hello',
      headers: { 'Content-Type': 'text/plain' },
      trust: { certificateSha256: [serverSha256] },
    });
    expect((await post.json()).data).toBe('hello');
  });

  it('applies the pin on a worklet', async () => {
    const trust = { certificateSha256: [serverSha256] };
    const status = await nitroFetchOnWorklet(
      `${TLS_BASE}/get`,
      { trust },
      (payload) => {
        'worklet';
        return payload.status;
      }
    );
    expect(status).toBe(200);
    await rejection(
      nitroFetchOnWorklet(
        `${TLS_BASE}/get`,
        { trust: { certificateSha256: [WRONG_SHA256] } },
        (payload) => {
          'worklet';
          return payload.status;
        }
      )
    );
  });

  it('rejects when the pin does not match', async () => {
    await rejection(
      nitroFetch(`${TLS_BASE}/get`, {
        trust: { certificateSha256: [WRONG_SHA256] },
      })
    );
  });

  it('rejects without the trust option', async () => {
    await rejection(nitroFetch(`${TLS_BASE}/get`));
  });

  it('still rejects an unpinned request after a pinned one to the same server', async () => {
    const res = await nitroFetch(`${TLS_BASE}/get`, {
      trust: { certificateSha256: [serverSha256] },
    });
    expect(res.status).toBe(200);
    await rejection(nitroFetch(`${TLS_BASE}/get`));
  });

  it('rejects a publicly trusted server whose certificate is not pinned', async () => {
    await rejection(
      nitroFetch('https://www.google.com/generate_204', {
        trust: { certificateSha256: [WRONG_SHA256] },
      })
    );
    const unpinned = await nitroFetch('https://www.google.com/generate_204');
    expect(unpinned.status).toBe(204);
  });

  it('checks the pin after an unpinned request to the same server', async () => {
    const unpinned = await nitroFetch('https://www.google.com/generate_204');
    expect(unpinned.status).toBe(204);
    await rejection(
      nitroFetch('https://www.google.com/generate_204', {
        trust: { certificateSha256: [WRONG_SHA256] },
      })
    );
  });

  it('drops credentials on a cross-origin redirect', async () => {
    const res = await nitroFetch(
      `${TLS_BASE}/redirect-to?url=${encodeURIComponent(`${TLS_OTHER_ORIGIN}/headers`)}`,
      {
        trust: { certificateSha256: [serverSha256] },
        headers: { Authorization: 'Bearer secret', Cookie: 'session=secret' },
      }
    );
    const headers = (await res.json()).headers;
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Cookie).toBeUndefined();
  });

  it('drops the body and its Content-Type when a 303 turns POST into GET', async () => {
    const res = await nitroFetch(
      `${TLS_BASE}/redirect-to?status=303&url=${encodeURIComponent(`${TLS_BASE}/anything`)}`,
      {
        method: 'POST',
        body: 'hello',
        headers: { 'Content-Type': 'text/plain' },
        trust: { certificateSha256: [serverSha256] },
      }
    );
    const json = await res.json();
    expect(json.method).toBe('GET');
    expect(json.data).toBe('');
    expect(json.headers['Content-Type']).toBeUndefined();
  });

  it('returns a 3xx other than 301, 302, 303, 307 and 308 as is', async () => {
    const res = await nitroFetch(
      `${TLS_BASE}/redirect-to?status=300&url=${encodeURIComponent(`${TLS_BASE}/get`)}`,
      { trust: { certificateSha256: [serverSha256] } }
    );
    expect(res.status).toBe(300);
  });

  it('aborts a pinned request', async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = nitroFetch(`${TLS_BASE}/delay/5`, {
      trust: { certificateSha256: [serverSha256] },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 300);
    const error = (await rejection(pending)) as Error;
    expect(error.name).toBe('AbortError');
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('does not follow a redirect to http://', async () => {
    const to = encodeURIComponent(`${BASE}/get`);
    await rejection(
      nitroFetch(`${TLS_BASE}/redirect-to?url=${to}`, {
        trust: { certificateSha256: [serverSha256] },
      })
    );
  });

  it('throws a TypeError for http://, streaming and prefetch', async () => {
    const trust = { certificateSha256: [serverSha256] };
    expect(
      await rejection(nitroFetch(`${BASE}/get`, { trust }))
    ).toBeInstanceOf(TypeError);
    expect(
      await rejection(nitroFetch(`${TLS_BASE}/get`, { trust, stream: true }))
    ).toBeInstanceOf(TypeError);
    expect(
      await rejection(
        prefetch(`${TLS_BASE}/get`, {
          trust,
          headers: { prefetchKey: 'pinned' },
        } as RequestInit)
      )
    ).toBeInstanceOf(TypeError);
  });

  it('rejects a malformed fingerprint', async () => {
    await rejection(
      nitroFetch(`${TLS_BASE}/get`, {
        trust: { certificateSha256: ['zz'] },
      })
    );
    await rejection(
      nitroFetch(`${TLS_BASE}/get`, { trust: { certificateSha256: [] } })
    );
  });
});
