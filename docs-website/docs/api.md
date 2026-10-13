---
id: api
title: API Reference
sidebar_position: 2
---

# API Reference

## fetch(input, init)

Drop-in replacement for the global `fetch`.

- Accepts `Headers`, array pairs, or plain object for `init.headers`
- Body supports: `string`, `URLSearchParams`, `FormData`, and `Blob`
- Returns a spec-compliant `Response` with `text()`, `json()`, `arrayBuffer()`, `blob()`, `bytes()`, `formData()`, `clone()`, a `body` stream, and `headers`
- `formData()` parses `application/x-www-form-urlencoded` bodies only; other types, including `multipart/form-data`, reject with a `TypeError`
- `init.priority` (`'high'`, `'low'` or `'auto'`) sets the network priority of plain, streamed, worklet and prefetch requests. On Android it sets the Cronet request priority, which orders requests waiting for a connection. On iOS it sets `URLSessionTask.priority` (iOS 16+ for non-streamed requests), which URLSession treats as a hint. `'auto'` keeps the default
- `init.trust` (`{ certificateSha256: string[] }`) accepts the server only if its leaf certificate matches one of the fingerprints, instead of the system trust store and hostname check. See [Trusting a specific certificate](#trusting-a-specific-certificate)

```ts
import { fetch } from 'react-native-nitro-fetch';

const res = await fetch('https://jsonplaceholder.typicode.com/todos/1');
const data = await res.json();
```

## Trusting a specific certificate

`init.trust` lets one request talk to a server whose certificate you already know, for example a desktop companion app on the local network that serves a self-signed certificate and shares its fingerprint through a QR code.

```ts
import { fetch } from 'react-native-nitro-fetch';

const res = await fetch('https://192.168.1.20:8443/status', {
  trust: {
    certificateSha256: [
      '72:A9:C4:05:73:D4:A3:00:3C:55:58:F9:E3:D4:FD:C0:71:6B:3A:2E:59:65:EE:2C:1A:54:52:0D:16:D5:9B:17',
    ],
  },
});
```

- Each entry is the SHA-256 of the DER-encoded leaf certificate as 64 hex digits, case-insensitive, with optional `:` separators. `openssl x509 -in cert.pem -noout -fingerprint -sha256` prints it in this form.
- The request succeeds only if the leaf certificate matches one of the entries. The system trust store, the certificate chain, expiry and the hostname are not checked for that request. Every request without `trust` keeps the default validation.
- Pass `trust` in `fetch`'s `init`; it is not read from a `Request` object.
- `https://` only. Redirects are followed only to `https://` URLs, every hop must present a pinned certificate, and a cross-origin redirect drops the `Authorization`, `Cookie` and `Proxy-Authorization` headers.
- Pinned requests do not share connections or TLS sessions with other requests, skip the HTTP cache, and are never served from the prefetch cache. They still read and write the app's shared cookie store (`HTTPCookieStorage.shared` on iOS, the `CookieManager` sync on Android) unless `credentials: 'omit'` is set.
- Not supported with `stream: true`, `prefetch()`, `prefetchOnAppStart()` or on web; those throw a `TypeError`. A native build that predates `trust` also makes the request throw a `TypeError` instead of sending it unpinned.
- iOS uses an ephemeral `URLSession` per set of fingerprints (the 8 most recently used are kept). App Transport Security still applies to these requests when the URL has a hostname: without an ATS exception for that domain (for example `NSExceptionDomains` with `NSExceptionAllowsInsecureHTTPLoads`), the request fails with `NSURLErrorSecureConnectionFailed`. URLs with an IP address and `localhost` are not affected.
- On Android, Cronet cannot verify certificates per request, so pinned requests go through `HttpsURLConnection` instead, with an `SSLContext` per set of fingerprints (the 8 most recently used are kept). They do not use Cronet's HTTP/2, QUIC or cache, and are not reported to DevTools. If the app installs a VM-wide `java.net.CookieHandler`, `HttpsURLConnection` applies it too, so `credentials: 'omit'` is refused for pinned requests in that case.

> **Security:** only pin a certificate you received over a separate trusted channel, such as a QR code shown by the server or a value bundled with your app. Never pin the certificate a server presents on a first, unverified connection: anyone in the middle of that connection could present theirs.

## nitroFetchOnWorklet(input, init, mapWorklet, options?)

Runs the network request and then invokes `mapWorklet` on a worklet runtime, keeping the JS thread free for UI work.

- `mapWorklet(payload)` receives `{ url, status, statusText, ok, redirected, headers, bodyBytes?, bodyString? }`
- `options.preferBytes` (default `false`) controls whether `bodyBytes` or `bodyString` is sent to the mapper

```ts
import { nitroFetchOnWorklet } from 'react-native-nitro-fetch';

const map = (payload: { bodyString?: string }) => {
  'worklet';
  return JSON.parse(payload.bodyString ?? '{}');
};

const data = await nitroFetchOnWorklet(
  'https://httpbin.org/get',
  undefined,
  map,
  { preferBytes: false }
);
```

:::tip
See the [Worklets guide](./worklets.md) for setup instructions.
:::

## prefetch(input, init)

Starts a background request in native when possible. Requires a `prefetchKey` provided either via `headers: { prefetchKey }` or `init.prefetchKey`.

Later, call `fetch(url, { headers: { prefetchKey } })` to consume a fresh or pending prefetched result. On success, the response will include header `nitroPrefetched: true`.

## prefetchOnAppStart(input, \{ prefetchKey \})

Enqueues a request to be prefetched at the next app start by writing into native storage.

:::note
Enqueued requests are stored in native storage and automatically executed on the next app start on both platforms.
:::

## removeFromAutoPrefetch / removeAllFromAutoprefetch

Utilities to manage the auto-prefetch queue.

## Types

### NitroRequest

```ts
{
  url: string;
  method?: string;
  headers?: { key: string; value: string }[];
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
  timeoutMs?: number;
  followRedirects?: boolean;
}
```

### NitroResponse

```ts
{
  url: string;
  status: number;
  statusText: string;
  ok: boolean;
  redirected: boolean;
  headers: { key: string; value: string }[];
  bodyString?: string;
  bodyBytes?: ArrayBuffer;
}
```
