import { Platform } from 'react-native';

// Base URL of the local httpbin-compatible Express server (test-server/) that
// CI starts on the runner host before the harness suites run. The emulator and
// simulator reach the host through different loopback aliases:
//   - Android emulator -> 10.0.2.2
//   - iOS simulator    -> 127.0.0.1 (shares the host network namespace)
const PORT = 9876;
const HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

export const BASE = `http://${HOST}:${PORT}`;
export const WS_BASE = `ws://${HOST}:${PORT}`;
export const WS_PAUSED_URL = `ws://${HOST}:${PORT + 1}`;

// Same server over TLS with a self-signed certificate (test-server/tls) for
// the certificate pinning tests. `${BASE}/tls/fingerprint` serves its SHA-256.
export const TLS_BASE = `https://${HOST}:${PORT + 2}`;
export const WSS_TLS_BASE = `wss://${HOST}:${PORT + 2}`;
