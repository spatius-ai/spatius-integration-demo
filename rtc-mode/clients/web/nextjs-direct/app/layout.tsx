import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AvatarKit RTC Mode Demo',
  description: 'The avatar joins the LiveKit call itself — audio and motion over RTC',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
