import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// The frontend always calls /api. In development Vite proxies that to the
// Express server, so no VITE_API_URL is needed locally or on Vercel.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_DEV_API_URL || 'http://localhost:3000'
  const proxy = {
    '/api': {
      target,
      changeOrigin: true,
    },
  }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
