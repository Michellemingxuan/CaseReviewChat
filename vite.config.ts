/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // @ts-expect-error vitest augments vite UserConfig at runtime; type mismatch due to nested vite version
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: [],
  },
})
