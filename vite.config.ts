import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
import { fileURLToPath } from 'node:url'

// The 1Q 2026 sample (real cruiser data) is only compiled in when VITE_INCLUDE_SAMPLE=1 (review builds), never in the hosted build.
const sample = process.env.VITE_INCLUDE_SAMPLE === '1' ? './src/sample/sample.ts' : './src/sample/stub.ts'

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: { alias: { '@sample': fileURLToPath(new URL(sample, import.meta.url)) } },
})
