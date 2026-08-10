import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  // O subcaminho só é necessário no build de produção (GitHub Pages); em
  // desenvolvimento ele quebra o WebSocket do HMR e causa reloads inteiros.
  base: command === 'build' ? '/confronto-papiloscopico/' : '/',
  plugins: [react(), tailwindcss()],
}))
