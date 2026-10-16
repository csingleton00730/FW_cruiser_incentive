// Turn the Vite build into the fragment + files the Artifact publisher expects.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
const html = readFileSync('dist/index.html', 'utf8')
const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)[1]
const css = html.match(/href="\.\/(assets\/[^"]+\.css)"/)[1]
rmSync('artifact', { recursive: true, force: true }); mkdirSync('artifact/assets', { recursive: true })
writeFileSync(`artifact/${js}`, readFileSync(`dist/${js}`, 'utf8').replaceAll('\uFFFD', '\\uFFFD')); cpSync('dist/favicon.svg', 'artifact/favicon.svg')
const page = `<title>Cruiser Incentive</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${readFileSync(`dist/${css}`, 'utf8')}
</style>
<div id="root"></div>
<script type="module" src="${js}"></script>
`
writeFileSync('artifact/index.html', page)
console.log('artifact/index.html +', js)
