import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  server: {
    watch: {
      // miniflare persists Durable Object SQLite state here; watching it
      // causes a full-reload loop on every game tick
      ignored: ['**/.wrangler/**'],
    },
  },
});
