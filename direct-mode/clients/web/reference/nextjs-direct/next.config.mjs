import { withAvatarkit } from '@spatius/avatarkit/next'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The shared core is consumed as TypeScript source, linked in as a `file:`
  // dependency. Next only compiles sources from inside the project root, so a
  // path alias pointing up out of it does not work here the way it does under
  // Vite — the package has to come in through node_modules, and be named here so
  // Next transpiles it instead of expecting prebuilt JavaScript.
  transpilePackages: ['@spatius-demo/direct-mode-core'],
}

export default withAvatarkit(nextConfig)
