import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Point the SDK at a non-production backend when configured. The SDK ships
// prebuilt, so its env vars can't see this app's VITE_* values — it reads this
// global instead. Omit the env var to use the default (api.arcenpay.com).
const apiUrl = (import.meta.env.VITE_ARCENPAY_API_URL as string | undefined)?.trim()
const appUrl = (import.meta.env.VITE_ARCENPAY_APP_URL as string | undefined)?.trim()
const g = globalThis as unknown as Record<string, string | undefined>
if (apiUrl) g.__ARCENPAY_API_URL__ = apiUrl
if (appUrl) g.__ARCENPAY_APP_URL__ = appUrl

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
