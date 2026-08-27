import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), avatarkitVitePlugin()],
  root: __dirname,
  // The Next.js host serves this app under /iframe/ in both dev (rewrite to
  // :5198) and production (copied into public/iframe/). Without a matching base
  // the generated asset URLs are root-relative, so the browser asks the Next.js
  // origin for /src/main.tsx and gets a 404.
  base: '/iframe/',
  server: {
    // Direct Mode owns 5170-5179, Backend 5180-5189, RTC 5190-5199. The three
    // modes are meant to be run at the same time, and the ports used to collide.
    port: 5198,
    open: false,
    cors: true,
  },
  resolve: {
    alias: { '@': __dirname + '/src' },
  },
  build: {
    outDir: 'dist',
  },
})
