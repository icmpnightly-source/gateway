import { defineConfig, loadEnv, type Connect, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from "@tailwindcss/vite";
import path from 'path'

// Tells a page which address it is being opened from, for the "my IP" button
// on a rule's destination. The packaged app's web server answers the same
// question (nginx.conf.template).
function whoAmI(): Plugin {
  const answer: Connect.NextHandleFunction = (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ client: req.socket.remoteAddress }))
  }

  return {
    name: 'konggate-whoami',
    configureServer: (server) => void server.middlewares.use('/whoami', answer),
    configurePreviewServer: (server) => void server.middlewares.use('/whoami', answer),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The gateway's host ports live in the bundle's root .env, next to
  // docker-compose.yml, so the UI and the containers can't disagree.
  const env = loadEnv(mode, path.resolve(__dirname, '..'), ['KONG_', 'JAEGER_'])
  const adminPort = env.KONG_ADMIN_PORT || '8001'
  const proxyPort = env.KONG_PROXY_PORT || '8000'
  const jaegerPort = env.JAEGER_UI_PORT || '16686'

  // Same-origin doors to Kong, so the browser needs no CORS setup.
  const toKong = (prefix: string, port: string): ProxyOptions => ({
    target: `http://127.0.0.1:${port}`,
    changeOrigin: true,
    rewrite: (url) => url.slice(prefix.length) || '/',
  })
  const proxy = {
    '/kong-admin': toKong('/kong-admin', adminPort),
    '/kong-proxy': toKong('/kong-proxy', proxyPort),
  }

  return {
    plugins: [react(), tailwindcss(), whoAmI()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    define: {
      // Where clients call the gateway and where Jaeger shows the traces, for
      // the addresses the UI displays. The packaged app is told these by its
      // web server instead (nginx.conf.template), so they are only a fallback there.
      'import.meta.env.VITE_GATEWAY_PORT': JSON.stringify(proxyPort),
      'import.meta.env.VITE_JAEGER_PORT': JSON.stringify(jaegerPort),
    },
    server: { proxy },
    preview: { proxy },
  }
})
