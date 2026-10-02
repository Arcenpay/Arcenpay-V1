import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'
import './index.css'
import App from './App'

// Solana's web3.js / Anchor codecs use Node's Buffer, which browsers lack.
// Polyfill it before anything renders (the Solana embed path needs it).
const g = globalThis as unknown as Record<string, unknown>
if (!g.Buffer) g.Buffer = Buffer

// Point the SDK at a non-production backend when configured. The SDK ships
// prebuilt, so its env vars can't see this app's VITE_* values — it reads this
// global instead. Omit the env var to use the default (api.arcenpay.com).
const apiUrl = (import.meta.env.VITE_ARCENPAY_API_URL as string | undefined)?.trim()
const appUrl = (import.meta.env.VITE_ARCENPAY_APP_URL as string | undefined)?.trim()
if (apiUrl) g.__ARCENPAY_API_URL__ = apiUrl
if (appUrl) g.__ARCENPAY_APP_URL__ = appUrl

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
