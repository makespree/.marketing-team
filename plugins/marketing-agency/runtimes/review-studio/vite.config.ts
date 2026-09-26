import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import project from './project.json' with { type: 'json' };
export default defineConfig({ plugins: [react()], publicDir: false, server: { host: '127.0.0.1', port: project.local.ports.web, strictPort: true, proxy: { '/api': { target: `http://127.0.0.1:${project.local.ports.api}`, changeOrigin: true } } }, build: { outDir: 'dist', target: ['es2020', 'safari15'] } });
