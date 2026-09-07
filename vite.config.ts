import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base must match the GitHub Pages project path: https://<user>.github.io/Tally/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/Tally/' : '/',
  plugins: [react()],
})
