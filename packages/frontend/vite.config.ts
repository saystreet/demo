import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const backend = 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/health': backend,
    },
  },
  build: {
    target: 'es2022',
    // Fonts and the router are shared by every page; pages load on demand (see src/routes.tsx).
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 2 },
            { name: 'query', test: /node_modules[\\/]@tanstack[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
