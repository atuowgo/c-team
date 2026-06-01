/// <reference types="vite/client" />

interface ElectronAPI {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>
  send(channel: string, ...args: unknown[]): void
  on(channel: string, listener: (...args: unknown[]) => void): () => void
  once(channel: string, listener: (...args: unknown[]) => void): void
  removeAllListeners(channel: string): void
}

interface Window {
  electron: ElectronAPI
}