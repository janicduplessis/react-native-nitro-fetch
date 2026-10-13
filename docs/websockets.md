# WebSockets (`react-native-nitro-websockets`)

High-performance WebSockets for React Native, built as a [Nitro Module](https://github.com/mrousavy/nitro) (libwebsockets + mbedTLS). This package lives alongside **react-native-nitro-fetch** in the same repo; HTTP stays in nitro-fetch, sockets in nitro-websockets.

## Installation

Install **three** packages: the WebSocket module, **Nitro Modules** (required by all Nitro libraries), and **react-native-nitro-text-decoder** (a **peer dependency** of nitro-websockets — used to decode UTF-8 text frames on the JS side).

```sh
npm i react-native-nitro-websockets react-native-nitro-text-decoder react-native-nitro-modules
```

If you already use **react-native-nitro-fetch**, add the websockets and text-decoder packages; keep `react-native-nitro-modules` on a compatible version (see each package’s `peerDependencies`).

Then install native pods (iOS) and rebuild:

```sh
cd ios && pod install && cd ..
npx react-native run-ios   # or run-android
```


**iOS:** No additional setup required 



## `NitroWebSocket` API

The JS surface is a small class modeled after the browser `WebSocket`

### Constructor

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets'

const ws = new NitroWebSocket(url: string, protocols?: string | string[], headers?: Record<string, string>, options?: { trust?: { certificateSha256: string[] } })
```

- **url** — `ws:` / `wss:` endpoint.
- **protocols** — optional subprotocol string or list (Sec-WebSocket-Protocol).
- **headers** — optional extra HTTP headers for the upgrade request (as supported by native).
- **options.trust** — optional certificate pin that replaces system trust for this connection. See [Trusting a specific certificate](#trusting-a-specific-certificate).

### Properties

- `readyState` — `'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'`
- `url`, `protocol`, `bufferedAmount`, `extensions`

### Methods

- `send(data: string | ArrayBuffer)` — text or binary.
- `close(code?: number, reason?: string)` — default code `1000`.

### Events (assign like the browser API)

- `onopen: (() => void) | null`
- `onmessage: ((e: WebSocketMessageEvent) => void) | null`
  - `e.data` — string for text frames.
  - `e.isBinary` — `true` for binary; then prefer `e.binaryData` (`ArrayBuffer`).
- `onerror: ((error: string) => void) | null`
- `onclose: ((e: { code: number; reason: string }) => void) | null`

### Example (aligned with the example app)

```ts
const ws = new NitroWebSocket('wss://echo.websocket.org')

ws.onopen = () => console.log('open')
ws.onmessage = (e) => console.log('message', e.data, e.isBinary)
ws.onerror = (err) => console.error(err)
ws.onclose = (e) => console.log('closed', e.code, e.reason)

ws.send('hello')
ws.close(1000, 'bye')
```


## Trusting a specific certificate

The fourth constructor argument, `options.trust`, lets one connection talk to a server whose certificate you already know, for example a desktop companion app on the local network that serves a self-signed certificate and shares its fingerprint through a QR code.

```ts
const ws = new NitroWebSocket('wss://192.168.1.20:8443/socket', undefined, undefined, {
  trust: {
    certificateSha256: [
      '72:A9:C4:05:73:D4:A3:00:3C:55:58:F9:E3:D4:FD:C0:71:6B:3A:2E:59:65:EE:2C:1A:54:52:0D:16:D5:9B:17',
    ],
  },
})
```

- Each entry is the SHA-256 of the DER-encoded leaf certificate as 64 hex digits, case-insensitive, with optional `:` separators. `openssl x509 -in cert.pem -noout -fingerprint -sha256` prints it in this form.
- The connection opens only if the leaf certificate matches one of the entries. The system trust store, the certificate chain, expiry and the hostname are not checked for that connection. Every connection without `trust` keeps the default validation.
- A malformed or empty list throws from the constructor. A `ws://` URL, a redirect to `ws://` or a certificate that does not match fails with `onerror` and `onclose` (code `1006`) before the upgrade request, with its headers, is sent.
- A pinned handshake never resumes a TLS session, since a resumed session skips certificate verification: TLS resumption is turned off on the iOS Network.framework transport, the URLSession transport uses an ephemeral session, and on Android pinned connections use their own libwebsockets vhost without a TLS session cache. Pinned connections never adopt a prewarmed socket.
- A native build that predates `trust` makes the constructor throw a `TypeError` instead of connecting unpinned.
- iOS: with the URLSession transport (`NitroWebSocketsUseNetworkFramework` set to `false`), App Transport Security still applies when the URL has a hostname, and the handshake fails without an ATS exception for that domain. URLs with an IP address or `localhost`, and the default Network.framework transport, are not affected.

> **Security:** only pin a certificate you received over a separate trusted channel, such as a QR code shown by the server or a value bundled with your app. Never pin the certificate a server presents on a first, unverified connection: anyone in the middle of that connection could present theirs.

## Prewarm on next app launch

Prewarming starts the TLS/WebSocket handshake **natively** on startup (before JS runs), using URLs you enqueue from JavaScript. That uses the same **NativeStorage** queue as nitro-fetch (`nitro_fetch_storage`), so **react-native-nitro-fetch** must be installed for prewarm to work.

### JS helpers

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets'

// Queue or update an entry (deduped by URL)
prewarmOnAppStart('wss://api.example.com/ws', ['chat-v1'], {
  Authorization: 'Bearer …',
})

// Remove one URL from the queue
removeFromPrewarmQueue('wss://api.example.com/ws')

// Clear the entire queue
clearPrewarmQueue()
```

Optional second argument: **subprotocols** array. Optional third: **headers** for the upgrade request.

### Android native hook

In `Application.onCreate`, before or after `loadReactNative`:

```kotlin
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

override fun onCreate() {
  super.onCreate()
  NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
  // …
}
```



### Auth on cold start

If prewarmed sockets need fresh headers, register token refresh with `target: 'websocket'` or `'all'` using **`registerTokenRefresh`** from `react-native-nitro-fetch` (see the main README, **Token refresh (cold start)**).



```ts
import { registerTokenRefresh } from 'react-native-nitro-fetch'
import { prewarmOnAppStart, NitroWebSocket } from 'react-native-nitro-websockets'

const WSS = 'wss://api.example.com/live'

registerTokenRefresh({
  target: 'websocket',
  url: 'https://api.example.com/oauth/token',
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'client_credentials' }),
  mappings: [
    { jsonPath: 'access_token', header: 'Authorization', valueTemplate: 'Bearer {{value}}' },
  ],
})

prewarmOnAppStart(WSS)

// Runtime connection (add your own token if you have it in JS)
const ws = new NitroWebSocket(WSS, undefined, { Authorization: 'Bearer …' })
```

Use `target: 'all'` if you share the same OAuth response for **both** `prefetchOnAppStart` queues and WebSocket prewarm.



## See also

- [Prefetch & auto-prefetch](prefetch.md) — HTTP prefetch; pairs conceptually with WS prewarm.
- [README.md](../README.md) — token refresh, installation, features.
