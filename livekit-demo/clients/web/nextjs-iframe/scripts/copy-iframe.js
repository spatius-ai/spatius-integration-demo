/**
 * Copy the iframe app's build into the Next.js public directory, plus its own
 * public assets so paths like /public-avatar-guide.png resolve from inside the
 * iframe. Cross-platform.
 */

const fs = require('fs')
const path = require('path')

const srcDir = path.join(__dirname, '../iframe-content/dist')
const destDir = path.join(__dirname, '../public/iframe')
const iframePublicDir = path.join(__dirname, '../iframe-content/public')
const nextPublicDir = path.join(__dirname, '../public')

if (!fs.existsSync(nextPublicDir)) {
  fs.mkdirSync(nextPublicDir, { recursive: true })
}

if (fs.existsSync(destDir)) {
  fs.rmSync(destDir, { recursive: true, force: true })
}

if (fs.existsSync(srcDir)) {
  fs.cpSync(srcDir, destDir, { recursive: true })
  console.log('iframe content copied to public/iframe')
} else {
  console.error('iframe content not found. Please build iframe-content first.')
  process.exit(1)
}

// Copy iframe-content public assets to the Next.js public root, so the images the
// iframe references resolve there too.
if (fs.existsSync(iframePublicDir)) {
  fs.cpSync(iframePublicDir, nextPublicDir, { recursive: true })
  console.log('iframe public assets copied to Next.js public/')
}
