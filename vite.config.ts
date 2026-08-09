/// <reference types="vitest" />
import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'

// Wrap Vite's default logger to swallow benign SSE proxy errors. The Vite
// proxy module logs "http proxy error" via the logger directly (not just via
// proxy.on('error')), so the only reliable suppression is at the logger.
const logger = createLogger()
const originalError = logger.error.bind(logger)
logger.error = (msg, opts) => {
  // /stream connections always disconnect — case switches, navigation,
  // refresh, HMR. Suppress those entirely (they aren't failures).
  if (typeof msg === 'string' && /\/stream/.test(msg) &&
      /http proxy error|ECONNRESET|socket hang up|aborted|EPIPE|premature close/i.test(msg)) {
    return
  }
  originalError(msg, opts)
}

export default defineConfig({
  customLogger: logger,
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:49002',
        changeOrigin: true,
        // SSE: long-lived stream + don't buffer responses.
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (req.url?.includes('/stream')) {
              proxyReq.setHeader('Accept', 'text/event-stream')
              proxyReq.setHeader('Cache-Control', 'no-cache')
              proxyReq.setHeader('Connection', 'keep-alive')
            }
          })
          // Also handle at the proxy event level — some errors don't reach
          // the logger but do bubble here.
          proxy.on('error', (_err, _req, res) => {
            try { (res as { end?: () => void } | undefined)?.end?.() } catch { /* socket already gone */ }
          })
          proxy.on('proxyRes', (proxyRes, req) => {
            if (req?.url?.includes('/stream')) {
              proxyRes.on('error', () => {/* silent */})
            }
          })
        },
      },
    },
  },
  // @ts-expect-error vitest augments vite UserConfig at runtime; type mismatch due to nested vite version
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
