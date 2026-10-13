import { type HybridObject, NitroModules } from 'react-native-nitro-modules'

export type WebSocketReadyState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'

export interface HybridWebSocketMessageEvent {
  data: ArrayBuffer
  isBinary: boolean
}

export interface WebSocketCloseEvent {
  code: number
  reason: string
  wasClean: boolean
}

export interface WebSocketTrust {
  /**
   * SHA-256 fingerprints of the DER-encoded leaf certificates to accept, as hex
   * (64 digits, case-insensitive, `:` separators allowed). When set, the server
   * is accepted only if its leaf certificate matches one of them; the system
   * trust store and hostname are not checked for this connection.
   */
  certificateSha256: string[]
}

export interface WebSocketConnectOptions {
  trust?: WebSocketTrust
}

export interface HybridWebSocket extends HybridObject<{
  ios: 'c++'
  android: 'c++'
}> {
  readonly readyState: WebSocketReadyState
  readonly url: string
  readonly bufferedAmount: number
  readonly protocol: string
  readonly extensions: string

  connect(
    url: string,
    protocols: string[],
    headers: Record<string, string>,
    options?: WebSocketConnectOptions
  ): void
  close(code: number, reason: string): void
  send(data: string): void
  sendBinary(data: ArrayBuffer): void
  onOpen: (() => void) | undefined
  onMessage: ((event: HybridWebSocketMessageEvent) => void) | undefined
  onClose: ((event: WebSocketCloseEvent) => void) | undefined
  onError: ((error: string) => void) | undefined
}

export const createWebSocket = (): HybridWebSocket =>
  NitroModules.createHybridObject<HybridWebSocket>('WebSocket')
