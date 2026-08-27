import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
// The backend calls, SDK lifecycle and scene logic the framework clients share.
// Consumed as source, so there is no build step before `pnpm dev`.
const directCore = resolve(__dirname, '../../../shared/src')

export default defineConfig({
  plugins: [
    react(),
    avatarkitVitePlugin(),
  ],
  root: __dirname,
  // The Next.js host serves this app under /iframe/ in both dev (rewrite to
  // :5178) and production (copied into public/iframe/). Without a matching base
  // the generated asset URLs are root-relative, so the browser asks the Next.js
  // origin for /src/main.tsx and gets a 404.
  base: '/iframe/',
  server: {
    port: 5178,
    open: false,
    cors: true,
    // The shared core lives outside this project's root, which the dev server
    // refuses to serve from by default.
    fs: { allow: [__dirname, directCore] },
  },
  resolve: {
    alias: {
      '@': __dirname + '/src',
      '@direct-core': directCore,
    },
  },
  build: {
    outDir: 'dist',
  },
})
