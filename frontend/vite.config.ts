
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
// Important code explanation: The plugins configuration enables both React support and Tailwind processing. We need to keep react() because our frontend uses React, and add tailwindcss() to enable Tailwind.