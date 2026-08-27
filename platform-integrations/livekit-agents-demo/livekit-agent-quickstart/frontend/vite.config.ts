import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

function ensureAvatarkitAssetsDir() {
  return {
    name: 'ensure-avatarkit-assets-dir',
    closeBundle() {
      mkdirSync(path.resolve(__dirname, 'dist/assets'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), ensureAvatarkitAssetsDir(), avatarkitVitePlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/token': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
