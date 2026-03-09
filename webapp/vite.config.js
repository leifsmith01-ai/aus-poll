import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/aus-poll/',   // for GitHub Pages deployment under leifsmith01-ai/aus-poll
})
