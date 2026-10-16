import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
const svg = readFileSync('public/favicon.svg', 'utf8')
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 240, height: 264 }, deviceScaleFactor: 1 })
await page.setContent(`<body style="margin:0;background:transparent">${svg.replace('<svg ', '<svg width="240" height="264" ')}</body>`)
const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: 240, height: 264 } })
writeFileSync('src/export/logo.ts', `// F&W shield, 240×264 PNG, rendered from the brand SVG.\nexport const LOGO_PNG_BASE64 = '${buf.toString('base64')}'\n`)
await browser.close(); console.log('logo', buf.length, 'bytes')
