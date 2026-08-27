import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
// The backend calls, SDK lifecycle and scene logic the framework clients share.
// Consumed as source, so there is no build step before `pnpm dev`.
const directCore = resolve(__dirname, '../../shared/src')

export default defineConfig({
  plugins: [
    vue(),
    avatarkitVitePlugin(),
  ],
  root: __dirname,
  server: {
    // Direct Mode owns 5170-5179, Backend 5180-5189, RTC 5190-5199. The three
    // modes are meant to be run at the same time, and the ports used to collide.
    port: 5174,
    open: true,
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
})
