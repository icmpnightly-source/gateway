import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
import path from 'path'

// https://vite.dev/config/
export default defineConfig(() => {
  // In the app, the engine serves these pages itself. While developing, the
  // dev server serves them and passes the engine's own paths on to an engine
  // started beside it (desktop: npm run engine).
  const engine: ProxyOptions = {
    target: `http://127.0.0.1:${process.env.KONGGATE_APP_PORT || '8101'}`,
    changeOrigin: true,
  }
  const proxy = { '/api': engine, '/try': engine, '/echo': engine }

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: { proxy },
    preview: { proxy },
  }
})
