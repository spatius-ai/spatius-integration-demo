'use client'

import dynamic from 'next/dynamic'

/**
 * Loaded browser-side only.
 *
 * The SDK reaches for `location` and for WebGL as its module initialises, neither
 * of which exists in the prerender pass — importing it normally fails `next build`
 * with "location is not defined" before the page ever reaches a browser. `'use
 * client'` alone does not help: a client component is still rendered once on the
 * server to produce the initial HTML.
 *
 * This is the difference between the two Next demos. Here the SDK sits in the same
 * bundle as the app and has to be kept out of the server pass; the iframe demo
 * isolates it in a separate document instead, which sidesteps the problem
 * entirely — see ../nextjs-iframe.
 */
const AvatarApp = dynamic(() => import('@/views/AvatarApp'), {
  ssr: false,
  loading: () => <div className="app" />,
})

export default function Home() {
  return <AvatarApp />
}
