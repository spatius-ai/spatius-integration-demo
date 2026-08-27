import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineConfig } from 'vite'
import { avatarkitVitePlugin } from '@spatius/avatarkit/vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

function ensureDistAssetsDir() {
  return {
    name: 'ensure-dist-assets-dir',
    closeBundle() {
      mkdirSync(join(__dirname, 'dist/assets'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [
    ensureDistAssetsDir(),
    avatarkitVitePlugin(),
  ],
  root: __dirname,
  server: {
    // Direct Mode owns 5170-5179, Backend 5180-5189, RTC 5190-5199. The three
    // modes are meant to be run at the same time, and the ports used to collide.
    port: 5182,
    open: true,
  },
  resolve: {
    alias: {
      '@': __dirname + '/src',
    },
  },
})
