import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Deployed as a GitHub Pages project site: https://<user>.github.io/Closet/
export default defineConfig({
  base: '/Closet/',
  plugins: [react()],
  server: {
    fs: {
      // Seed notes are imported from the repo-root /notes folder, one level up.
      allow: ['..'],
    },
  },
})
