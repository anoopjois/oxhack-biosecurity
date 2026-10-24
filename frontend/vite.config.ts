import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Ports come from the repo-root .env (see .env.example); /api is proxied to FastAPI.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '..', '')
  const backendPort = env.BACKEND_PORT || '8000'
  return {
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT || 5173),
      proxy: { '/api': `http://localhost:${backendPort}` },
    },
  }
})
