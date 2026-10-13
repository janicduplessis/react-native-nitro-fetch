---
id: websockets
title: WebSockets
sidebar_position: 8
---

# WebSockets

High-performance WebSockets for React Native, built as a [Nitro Module](https://github.com/mrousavy/nitro) (libwebsockets + mbedTLS). This package lives alongside **react-native-nitro-fetch** in the same repo; HTTP stays in nitro-fetch, sockets in nitro-websockets.

## Installation

Install **three** packages: the WebSocket module, **Nitro Modules** (required by all Nitro libraries), and **react-native-nitro-text-decoder** (a peer dependency used to decode UTF-8 text frames).

```bash
npm i react-native-nitro-websockets react-native-nitro-text-decoder react-native-nitro-modules
```

:::tip
If you already use **react-native-nitro-fetch**, just add the websockets and text-decoder packages. Keep `react-native-nitro-modules` on a compatible version.
:::

Then install native pods and rebuild:

```bash
cd ios && pod install && cd ..
npx react-native run-ios   # or run-android
```

## NitroWebSocket API

The JS surface is a small class modeled after the browser `WebSocket`.

### Constructor

```ts
import { NitroWebSocket } from 'react-native-nitro-websockets';

const ws = new NitroWebSocket(
  url: string,
  protocols?: string | string[],
  headers?: Record<string, string>,
  options?: { trust?: { certificateSha256: string[] } }
);
```

- **url** — `ws:` / `wss:` endpoint
- **protocols** — optional subprotocol string or list (`Sec-WebSocket-Protocol`)
- **headers** — optional extra HTTP headers for the upgrade request
- **options.trust** — optional certificate pin that replaces system trust for this connection. See [Trusting a specific certificate](#trusting-a-specific-certificate)

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `readyState` | `'CONNECTING' \| 'OPEN' \| 'CLOSING' \| 'CLOSED'` | Current connection state |
| `url` | `string` | The WebSocket URL |
| `protocol` | `string` | Negotiated subprotocol |
| `bufferedAmount` | `number` | Bytes queued for sending |
| `extensions` | `string` | Negotiated extensions |

### Methods

- **`send(data: string | ArrayBuffer)`** — Send text or binary data
- **`close(code?: number, reason?: string)`** — Close the connection (default code `1000`)

### Events

```ts
ws.onopen = () => void;
ws.onmessage = (e: WebSocketMessageEvent) => void;
ws.onerror = (error: string) => void;
ws.onclose = (e: { code: number; reason: string }) => void;
```

The `WebSocketMessageEvent` contains:
- `e.data` — string for text frames
- `e.isBinary` — `true` for binary frames; use `e.binaryData` (`ArrayBuffer`)

### Example

```ts
const ws = new NitroWebSocket('wss://echo.websocket.org');

ws.onopen = () => console.log('open');
ws.onmessage = (e) => console.log('message', e.data, e.isBinary);
ws.onerror = (err) => console.error(err);
ws.onclose = (e) => console.log('closed', e.code, e.reason);

ws.send('hello');
ws.close(1000, 'bye');
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
});
```

- Each entry is the SHA-256 of the DER-encoded leaf certificate as 64 hex digits, case-insensitive, with optional `:` separators. `openssl x509 -in cert.pem -noout -fingerprint -sha256` prints it in this form.
- The connection opens only if the leaf certificate matches one of the entries. The system trust store, the certificate chain, expiry and the hostname are not checked for that connection. Every connection without `trust` keeps the default validation.
- A malformed or empty list throws from the constructor. A `ws://` URL, a redirect to `ws://` or a certificate that does not match fails with `onerror` and `onclose` (code `1006`) before the upgrade request, with its headers, is sent.
- A pinned handshake never resumes a TLS session, since a resumed session skips certificate verification: TLS resumption is turned off on the iOS Network.framework transport, the URLSession transport uses an ephemeral session, and on Android pinned connections use their own libwebsockets vhost without a TLS session cache. Pinned connections never adopt a prewarmed socket.
- A native build that predates `trust` makes the constructor throw a `TypeError` instead of connecting unpinned.
- iOS: with the URLSession transport (`NitroWebSocketsUseNetworkFramework` set to `false`), App Transport Security still applies when the URL has a hostname, and the handshake fails without an ATS exception for that domain. URLs with an IP address or `localhost`, and the default Network.framework transport, are not affected.

> **Security:** only pin a certificate you received over a separate trusted channel, such as a QR code shown by the server or a value bundled with your app. Never pin the certificate a server presents on a first, unverified connection: anyone in the middle of that connection could present theirs.

## Prewarm on next app launch

Prewarming starts the TLS/WebSocket handshake **natively** on startup (before JS runs), using URLs you enqueue from JavaScript.

:::note
Prewarm uses the same NativeStorage queue as nitro-fetch, so **react-native-nitro-fetch** must be installed.
:::

### JS helpers

```ts
import {
  prewarmOnAppStart,
  removeFromPrewarmQueue,
  clearPrewarmQueue,
} from 'react-native-nitro-websockets';

// Queue or update an entry (deduped by URL)
prewarmOnAppStart('wss://api.example.com/ws', ['chat-v1'], {
  Authorization: 'Bearer ...',
});

// Remove one URL from the queue
removeFromPrewarmQueue('wss://api.example.com/ws');

// Clear the entire queue
clearPrewarmQueue();
```

### Android native hook

In `Application.onCreate`, before or after `loadReactNative`:

```kotlin
import com.margelo.nitro.nitrofetchwebsockets.NitroWebSocketAutoPrewarmer

override fun onCreate() {
  super.onCreate()
  NitroWebSocketAutoPrewarmer.prewarmOnStart(this)
  // ...
}
```

### Expo Plugin (Android)

If you use **Expo**, the plugin automatically injects `NitroWebSocketAutoPrewarmer.prewarmOnStart()` into `MainApplication.kt` during `expo prebuild` — no manual native code changes needed.

Add to your `app.json`:

```json
{
  "plugins": ["react-native-nitro-websockets"]
}
```

### Auth on cold start

If prewarmed sockets need fresh headers, register token refresh with `target: 'websocket'` or `'all'` using `registerTokenRefresh` from `react-native-nitro-fetch`. See the [Token Refresh guide](./token-refresh.md) for details.

## iOS transport

On iOS, connections run on a client built on Network.framework, which reads the socket in bulk and frames messages in-process. It is much faster for bursts of messages than `NSURLSessionWebSocketTask`. Setting `NitroWebSocketsUseNetworkFramework` to `false` in `Info.plist` switches back to `NSURLSessionWebSocketTask`, which you need for App Transport Security, `NSPinnedDomains` pinning, proxies or HTTP authentication.

```xml
<key>NitroWebSocketsUseNetworkFramework</key>
<false/>
```

With Expo, set it under `ios.infoPlist` in the app config.

App Transport Security does not apply to Network.framework, so `ws://` connects to any host and `NSPinnedDomains` pinning is not applied. `wss://` connections still validate the server certificate against the system trust store, and redirects from `wss://` to `ws://` are refused.

Other differences from `NSURLSessionWebSocketTask`:

- the system HTTP or PAC proxy may not be used
- `user:pass@` credentials and `401` challenges are not handled
- the handshake sends no `Accept`, `Accept-Language` or `Accept-Encoding` header
- messages can be up to 16 MB instead of 1 MB
- if the server does not answer `close()` within 5 seconds, `onclose` fires with code `1006`
- a close frame with a reserved code or a reason that is not valid UTF-8 fails the connection: `onerror`, then `onclose` with `1006`
- a failed send does not fire `onerror` by itself; the connection failing does
- network changes are not watched and no TCP keepalives are sent, so an idle connection can stay open after the network changes until a read or write fails

## See also

- [Prefetch & Auto-Prefetch](./prefetch.md) — HTTP prefetch; pairs conceptually with WS prewarm
- [Token Refresh](./token-refresh.md) — Auth token configuration for cold-start requests
