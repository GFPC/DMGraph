import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Явная привязка к IPv4: у многих обозревателей localhost → ::1, а без host Vite может
  // слушать только 127.0.0.1 — получается connection failure вместо приложения.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
})
