import { mkdirSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

import { resolve } from 'node:path'

function ensureAvatarkitAssetsDir() {
  return {
    name: 'ensure-avatarkit-assets-dir',
    closeBundle() {
      mkdirSync(resolve(__dirname, 'dist/assets'), { recursive: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
    ensureAvatarkitAssetsDir(),
    avatarkitVitePlugin(),
  ],
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
