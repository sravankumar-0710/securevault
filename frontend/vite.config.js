import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// HTTPS only applies during local dev (vite dev server).
// During production builds (vite build) no server is started,
// so we skip cert loading entirely to avoid crashing on Vercel.
const isDev = process.env.NODE_ENV !== 'production';

let httpsConfig = false;

if (isDev) {
  const certDir  = path.resolve(__dirname, '..', 'backend');
  const certFile = path.join(certDir, 'localhost+1.pem');
  const keyFile  = path.join(certDir, 'localhost+1-key.pem');

  if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
    httpsConfig = {
      cert: fs.readFileSync(certFile),
      key:  fs.readFileSync(keyFile),
    };
    console.log('✅ Vite: HTTPS enabled using mkcert certs from backend/');
  } else {
    console.log('⚠  Vite: Running HTTP — run mkcert in backend/ to enable HTTPS');
  }
}

export default defineConfig({
  plugins: [react()],
  server: {
    https: httpsConfig,
    port: 5173,
    host: 'localhost',
  }
})