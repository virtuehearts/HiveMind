import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const isCodespaces = Boolean(process.env.CODESPACES)
const port = Number(process.env.PORT) || 5173

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port,
    strictPort: true,
    // Ensure HMR works over forwarded HTTPS ports in Codespaces
    hmr: isCodespaces
      ? {
          protocol: 'wss',
          host: process.env.CODESPACE_NAME
            ? `${process.env.CODESPACE_NAME}-${port}.app.github.dev`
            : undefined,
          clientPort: 443
        }
      : undefined
  },
  preview: {
    host: '0.0.0.0',
    port,
    strictPort: true
  }
})
