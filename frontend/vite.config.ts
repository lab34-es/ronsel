import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

// The UI ships inside the package, and is always built from this same
// checkout, so the package's version is baked into the bundle at build time
// rather than fetched from the API at runtime. One source of truth: the
// root package.json, the same file the CLI reads for `--version`.
const require = createRequire(import.meta.url)
const packageVersion: string = require('../package.json').version

// Only `npm run dev` uses what follows: the built bundle talks to whatever
// origin served it (see src/services/api.ts and src/services/socket.ts), so
// no port is ever baked into it.
//
// In development the API is a second process, and it reads PORT the same way
// this does -- so `PORT=3005 npm run dev` moves the API and this proxy
// together. The API takes its port as a starting point and moves on when it
// is busy, printing where it landed; if it had to move, restart `npm run dev`
// with PORT naming a free one so the proxy follows.
const apiPort = Number(process.env.PORT) || 3001
const apiTarget = `http://localhost:${apiPort}`

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(rootDir, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
