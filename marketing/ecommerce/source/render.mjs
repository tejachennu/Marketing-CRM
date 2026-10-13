// Renders every creative in creatives.html to a PNG next to this folder.
// Usage: node marketing/ecommerce/source/render.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..')
const page = pathToFileURL(join(here, 'creatives.html')).href

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
].find(existsSync)
if (!CHROME) {
  console.error('Google Chrome was not found. Open creatives.html#hero (and the other ids) in a browser and screenshot them instead.')
  process.exit(1)
}

// id, width, height, file name
const CREATIVES = [
  ['hero', 1080, 1080, '01-storefront-square.png'],
  ['steps', 1080, 1080, '02-how-it-works-square.png'],
  ['pay', 1080, 1080, '03-pay-online-or-cod-square.png'],
  ['orders', 1080, 1080, '04-orders-dashboard-square.png'],
  ['updates', 1080, 1080, '05-order-updates-square.png'],
  ['remind', 1080, 1080, '06-reminders-square.png'],
  ['share', 1080, 1080, '07-share-products-square.png'],
  ['story', 1080, 1920, '08-storefront-story.png'],
  ['banner', 1200, 628, '09-storefront-landscape.png'],
]

mkdirSync(outDir, { recursive: true })
const only = process.argv[2]
for (const [id, width, height, file] of CREATIVES) {
  if (only && only !== id) continue
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--allow-file-access-from-files', '--virtual-time-budget=1500',
    `--window-size=${width},${height}`, `--screenshot=${join(outDir, file)}`, `${page}#${id}`,
  ], { stdio: 'ignore' })
  console.log(`${file}  ${width}x${height}`)
}
