import { useState } from 'react'
import { ArcenPayProvider } from '@arcenpay/react'
import Dashboard from './Dashboard'

const PUBLISHABLE_KEY =
  (import.meta.env.VITE_ARCENPAY_PUBLISHABLE_KEY as string | undefined) ||
  (import.meta.env.VITE_PUBLISHABLE_KEY as string | undefined) ||
  '';
const COMPONENT_ID =
  (import.meta.env.VITE_ARCENPAY_COMPONENT_ID as string | undefined) ||
  (import.meta.env.VITE_COMPONENT_ID as string | undefined) ||
  '';
const CHAIN_ID =
  Number((import.meta.env.VITE_ARCENPAY_CHAIN_ID as string | undefined) || '677') || 677;

function App() {
  const [componentId, setComponentId] = useState(COMPONENT_ID)
  const [showConfig, setShowConfig] = useState(!COMPONENT_ID)

  // If no component ID is configured, show a config screen so the user can
  // paste one from Dashboard → Settings → Components.
  if (showConfig || !componentId) {
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', background: '#f8fafc', fontFamily: 'system-ui, sans-serif', padding: 24,
      }}>
        <div style={{ maxWidth: 480, width: '100%', background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>🔌 ArcenEmbed Demo</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 20, lineHeight: 1.6 }}>
            Enter the <strong>Component ID</strong> from your ArcenPay dashboard
            (Settings → Components → your component). This tells the embed which
            billing component to render.
          </p>
          <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
            Component ID (cms_...)
          </label>
          <input
            value={componentId}
            onChange={(e) => setComponentId(e.target.value.trim())}
            placeholder="cmt_xxxxxxxxxxxx"
            style={{
              width: '100%', padding: '10px 12px', fontSize: 14, border: '1px solid #cbd5e1',
              borderRadius: 8, boxSizing: 'border-box', marginBottom: 12, outline: 'none',
            }}
          />
          <button
            onClick={() => componentId && setShowConfig(false)}
            disabled={!componentId}
            style={{
              width: '100%', padding: '12px', background: '#0f172a', color: '#fff',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
              opacity: componentId ? 1 : 0.5,
            }}
          >
            Load ArcenEmbed
          </button>
          <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
            Chain: BOT Chain Mainnet (677) · API: api.arcenpay.com
          </p>
        </div>
      </div>
    )
  }

  return (
    <ArcenPayProvider
      publishableKey={PUBLISHABLE_KEY}
      componentId={componentId}
      chainId={CHAIN_ID}
    >
      <Dashboard onResetComponent={() => setShowConfig(true)} />
    </ArcenPayProvider>
  )
}

export default App
