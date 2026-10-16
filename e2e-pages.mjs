import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const R = '/tmp/claude-0/-home-claude/3338104c-431e-536d-bc4e-9324fbb63541/scratchpad/real/'
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }
// Serve dist under a sub-path like GitHub project pages: https://user.github.io/cruiser-incentive/
const srv = createServer((req, res) => {
  let p = req.url.replace(/^\/cruiser-incentive/, '') || '/'; if (p === '/') p = '/index.html'
  const f = join('dist', p); if (!existsSync(f)) { res.writeHead(404); return res.end() }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f))
}).listen(5201)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto('http://localhost:5201/cruiser-incentive/')
await page.waitForSelector('text=Start a quarter')
console.log('SAMPLE BUTTON PRESENT', await page.locator('text=Open the 1Q 2026 example').count())
await page.fill('input[aria-label="Quarter label"]', '2Q 2026'); await page.click('text=New quarter')
await page.locator('input[type=file]').nth(0).setInputFiles(R + 'spmp.xlsx'); await page.waitForSelector('text=663 entries')
await page.locator('input[type=file]').nth(1).setInputFiles(R + 'casl.xlsx'); await page.waitForSelector('text=4,776 audits')
await page.locator('input[type=file]').nth(2).setInputFiles(R + 'spmp.xlsx'); await page.waitForSelector('text=3 job(s)')
await page.click('text=Next: Review'); await page.click('text=Next: Results'); await page.waitForSelector('text=Incentive summary')
console.log('TOTAL', (await page.locator('tr.total td').allInnerTexts()).filter(Boolean).slice(-1))
console.log('ERRORS', errors)
await browser.close(); srv.close()
