// One self-contained HTML file that works when opened from a folder (file://) — no server needed.
import { readFileSync, writeFileSync } from 'node:fs'
const html = readFileSync('dist/index.html', 'utf8')
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1]
const css = html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1]
const favicon = 'data:image/svg+xml;base64,' + readFileSync('public/favicon.svg').toString('base64')
let script = readFileSync(`dist/${js}`, 'utf8').replace(/<\/script/gi, '<\\/script')
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Cruiser Incentive — F&W Forestry</title>
<link rel="icon" href="${favicon}" />
<style>
${readFileSync(`dist/${css}`, 'utf8')}
</style>
</head>
<body>
<div id="root"></div>
<script type="module">
${script}
</script>
</body>
</html>
`
writeFileSync('/home/claude/Cruiser_Incentive.html', page)
console.log('standalone', (page.length / 1024).toFixed(0), 'KB')
