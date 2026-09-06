import { useState, useEffect, useCallback } from 'react'
import {
  useArcenPay,
  useFlag,
  useCompanyEntitlements,
  ArcenEmbed,
} from '@arcenpay/react'
import { requestAccess, isConnected } from '@stellar/freighter-api'

/* ──────────────────────────────────────────────────────────────
   Demo dApp — Stellar-powered SaaS with ArcenPay billing
   ────────────────────────────────────────────────────────────── */

export default function Dashboard() {
  const { session, identify } = useArcenPay()
  const hasAiFeatures = useFlag('aifetures')
  const { entitlements, loading: entsLoading } = useCompanyEntitlements()

  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'identifying' | 'ready' | 'error'>('idle')

  // ── Connect Freighter wallet ──
  const connectWallet = useCallback(async () => {
    setWalletConnecting(true)
    setConnectionStatus('connecting')
    setIdentifyError(null)
    try {
      const access = await requestAccess()
      if (access.error) {
        throw new Error(access.error)
      }
      const publicKey = access.address
      if (!publicKey) {
        throw new Error('No address returned from Freighter')
      }
      setWalletAddress(publicKey)
      setConnectionStatus('connected')

      // Identify with ArcenPay using the Stellar wallet
      setConnectionStatus('identifying')
      try {
        await identify({
          company: {
            wallet: publicKey,
            name: 'Demo Stellar User',
          },
          user: {
            wallet: publicKey,
          },
        })
        setConnectionStatus('ready')
        setIdentifyError(null)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setIdentifyError(msg)
        setConnectionStatus('error')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setIdentifyError(msg)
      setConnectionStatus('error')
    } finally {
      setWalletConnecting(false)
    }
  }, [identify])

  const disconnectWallet = useCallback(() => {
    setWalletAddress(null)
    setConnectionStatus('idle')
    setIdentifyError(null)
    // Also clear ArcenEmbed's persisted Stellar wallet so it re-reads on next mount
    try {
      localStorage.removeItem('arcenpay:embed:stellar-wallet')
    } catch {
      // ignore
    }
    // Reload the page to force ArcenEmbed to re-initialize cleanly
    window.location.reload()
  }, [])

  // Auto-connect if already authorized
  useEffect(() => {
    isConnected().then((res) => {
      if (res.isConnected) {
        setConnectionStatus('connecting')
        requestAccess().then((access) => {
          if (access.address) {
            setWalletAddress(access.address)
            setConnectionStatus('identifying')
            identify({
              company: { wallet: access.address, name: 'Demo Stellar User' },
              user: { wallet: access.address },
            }).then(() => {
              setConnectionStatus('ready')
              setIdentifyError(null)
            }).catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err)
              setIdentifyError(msg)
              setConnectionStatus('error')
            })
          }
        })
      }
    })
  }, [identify])

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <span style={styles.brandIcon}>🌌</span>
            <span style={styles.brandText}>StellarAI</span>
          </div>
          <div style={styles.headerRight}>
            {walletAddress ? (
              <div style={styles.walletBadge}>
                <span style={styles.walletDot} />
                <span style={styles.walletText}>
                  {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}
                </span>
                <span style={styles.walletLabel}>Freighter</span>
                <button onClick={disconnectWallet} style={styles.disconnectBtn}>
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={walletConnecting}
                style={styles.connectBtn}
              >
                {walletConnecting ? 'Connecting...' : 'Connect Freighter'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main style={styles.main}>
        {/* Status Panel */}
        <section style={styles.section}>
          <div style={styles.statusPanel}>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Status:</span>
              <StatusBadge status={connectionStatus} />
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Wallet:</span>
              <span style={styles.statusValue}>
                {walletAddress ?? 'Not connected'}
              </span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Session:</span>
              <span style={styles.statusValue}>
                {session.isReady ? '✅ Ready' : session.isIdentifying ? '🔄 Identifying...' : '⏳ Not ready'}
              </span>
            </div>
            <div style={styles.statusRow}>
              <span style={styles.statusLabel}>Token:</span>
              <span style={styles.statusValue}>
                {session.token ? `${session.token.slice(0, 16)}...` : 'none'}
              </span>
            </div>
          </div>

          {identifyError && (
            <div style={styles.errorBanner}>
              <strong>Identify error:</strong> {identifyError}
            </div>
          )}
        </section>

        {/* Welcome */}
        <section style={styles.section}>
          <h1 style={styles.heading}>Welcome to StellarAI Demo</h1>
          <p style={styles.subheading}>
            A mini SaaS powered by ArcenPay billing on Stellar testnet.
            Connect your Freighter wallet to see feature gating in action.
          </p>
        </section>

        {/* Entitlements Grid */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Your Entitlements</h2>
          {entsLoading ? (
            <div style={styles.loading}>Loading entitlements...</div>
          ) : Object.keys(entitlements).length === 0 ? (
            <div style={styles.emptyState}>
              No entitlements loaded yet. Connect wallet and identify to load.
            </div>
          ) : (
            <div style={styles.entitlementGrid}>
              {Object.entries(entitlements).map(([key, ent]) => (
                <div
                  key={key}
                  style={{
                    ...styles.entCard,
                    borderColor: ent.enabled ? '#22c55e' : '#ef4444',
                    background: ent.enabled ? '#f0fdf4' : '#fef2f2',
                  }}
                >
                  <div style={styles.entHeader}>
                    <span
                      style={{
                        ...styles.entBadge,
                        background: ent.enabled ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {ent.enabled ? '✓ Enabled' : '✗ Disabled'}
                    </span>
                    <span style={styles.entKey}>{key}</span>
                  </div>
                  <div style={styles.entReason}>{ent.reason}</div>
                  {ent.allocation !== null && (
                    <div style={styles.entQuota}>
                      Usage: {ent.usage} / {ent.allocation}
                      {ent.exceeded && (
                        <span style={styles.quotaExceeded}> (EXCEEDED)</span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Feature: AI Image Generator (gated by aifetures) */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>AI Image Generator</h2>
          <div
            style={{
              ...styles.featureCard,
              opacity: hasAiFeatures ? 1 : 0.6,
            }}
          >
            {hasAiFeatures ? (
              <AiImageGenerator />
            ) : (
              <FeatureGate
                featureName="AI Image Generation"
                onUpgrade={() => {
                  document
                    .getElementById('billing-section')
                    ?.scrollIntoView({ behavior: 'smooth' })
                }}
              />
            )}
          </div>
        </section>

        {/* Feature: Basic Tools (always available on Free plan) */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Basic Tools (Free)</h2>
          <div style={styles.featureCard}>
            <BasicTools />
          </div>
        </section>

        {/* Billing Embed — ArcenEmbed from @arcenpay/react */}
        <section id="billing-section" style={styles.section}>
          <div style={styles.embedHeader}>
            <h2 style={styles.sectionTitle}>Billing & Plans</h2>
            <span style={styles.embedBadge}>ArcenEmbed — @arcenpay/react</span>
          </div>
          <div style={styles.embedContainer}>
            {!session.isReady ? (
              <div style={styles.embedPlaceholder}>
                <div style={styles.embedPlaceholderIcon}>💳</div>
                <p style={styles.embedPlaceholderText}>
                  ArcenEmbed will appear here once your wallet is connected
                  and the billing session is active.
                </p>
                {!walletAddress && (
                  <button onClick={connectWallet} style={styles.connectBtnSmall}>
                    Connect Wallet to Load Billing
                  </button>
                )}
              </div>
            ) : (
              <ArcenEmbed />
            )}
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <p>
          StellarAI Demo — Built with ArcenPay SDK v0.0.2 · Component{' '}
          <code>cmsdjtw440004zrv0hvifafj6</code>
        </p>
      </footer>
    </div>
  )
}

/* ──────────────────────────────
   Status Badge
   ────────────────────────────── */

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: '#94a3b8',
    connecting: '#f59e0b',
    connected: '#3b82f6',
    identifying: '#8b5cf6',
    ready: '#22c55e',
    error: '#ef4444',
  }
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        color: '#fff',
        background: colors[status] || '#94a3b8',
        textTransform: 'uppercase' as const,
      }}
    >
      {status}
    </span>
  )
}

/* ──────────────────────────────
   Sub-components
   ────────────────────────────── */

function AiImageGenerator() {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const handleGenerate = async () => {
    if (!prompt.trim()) return
    setGenerating(true)
    setResult(null)
    await new Promise((r) => setTimeout(r, 1500))
    setResult(
      `✨ Generated image for: "${prompt}"\n` +
        `(In production this would call your AI backend and deduct credits.)`
    )
    setGenerating(false)
  }

  return (
    <div>
      <p style={styles.featureDesc}>
        Enter a prompt and our AI will generate a stunning image. Powered by
        your Starter plan.
      </p>
      <div style={styles.inputRow}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="A futuristic city on Mars..."
          style={styles.textInput}
        />
        <button
          onClick={handleGenerate}
          disabled={generating || !prompt.trim()}
          style={styles.actionBtn}
        >
          {generating ? 'Generating...' : 'Generate'}
        </button>
      </div>
      {result && (
        <div style={styles.resultBox}>
          <pre style={styles.resultPre}>{result}</pre>
        </div>
      )}
    </div>
  )
}

function FeatureGate({
  featureName,
  onUpgrade,
}: {
  featureName: string
  onUpgrade: () => void
}) {
  return (
    <div style={styles.gateOverlay}>
      <div style={styles.gateIcon}>🔒</div>
      <h3 style={styles.gateTitle}>{featureName} is locked</h3>
      <p style={styles.gateText}>
        Upgrade to the <strong>Starter</strong> plan to unlock {featureName}.
      </p>
      <button onClick={onUpgrade} style={styles.upgradeBtn}>
        Upgrade to Starter
      </button>
    </div>
  )
}

function BasicTools() {
  const [text, setText] = useState('')
  const [output, setOutput] = useState('')

  const tools = [
    { name: 'Uppercase', action: () => setOutput(text.toUpperCase()) },
    { name: 'Lowercase', action: () => setOutput(text.toLowerCase()) },
    { name: 'Reverse', action: () => setOutput(text.split('').reverse().join('')) },
    {
      name: 'Word Count',
      action: () =>
        setOutput(`Words: ${text.trim().split(/\s+/).filter(Boolean).length}`),
    },
  ]

  return (
    <div>
      <p style={styles.featureDesc}>
        Simple text utilities available on every plan.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type something..."
        rows={4}
        style={styles.textarea}
      />
      <div style={styles.toolRow}>
        {tools.map((t) => (
          <button key={t.name} onClick={t.action} style={styles.toolBtn}>
            {t.name}
          </button>
        ))}
      </div>
      {output && (
        <div style={styles.outputBox}>
          <strong>Result:</strong> {output}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────
   Styles
   ────────────────────────────── */

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    color: '#1e293b',
    lineHeight: 1.5,
  },
  header: {
    background: '#ffffff',
    borderBottom: '1px solid #e2e8f0',
    position: 'sticky',
    top: 0,
    zIndex: 50,
  },
  headerInner: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  brandIcon: {
    fontSize: 24,
  },
  brandText: {
    fontSize: 20,
    fontWeight: 700,
    color: '#0f172a',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  connectBtn: {
    padding: '8px 16px',
    background: '#0f172a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  connectBtnSmall: {
    padding: '8px 16px',
    background: '#0f172a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 12,
  },
  walletBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    background: '#f1f5f9',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 500,
  },
  walletDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#22c55e',
    display: 'inline-block',
  },
  walletText: {
    fontFamily: 'monospace',
    color: '#334155',
  },
  walletLabel: {
    padding: '2px 6px',
    background: '#e0e7ff',
    color: '#4338ca',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
  },
  disconnectBtn: {
    marginLeft: 4,
    padding: '2px 6px',
    background: 'transparent',
    color: '#64748b',
    border: 'none',
    borderRadius: 4,
    fontSize: 12,
    cursor: 'pointer',
    lineHeight: 1,
  },
  main: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: '32px 24px 64px',
  },
  section: {
    marginBottom: 48,
  },
  statusPanel: {
    padding: 16,
    background: '#fff',
    borderRadius: 10,
    border: '1px solid #e2e8f0',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  statusRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
  },
  statusLabel: {
    fontWeight: 600,
    color: '#64748b',
    minWidth: 60,
  },
  statusValue: {
    color: '#334155',
    fontFamily: 'monospace',
    fontSize: 12,
  },
  heading: {
    fontSize: 32,
    fontWeight: 800,
    margin: '0 0 8px',
    color: '#0f172a',
  },
  subheading: {
    fontSize: 16,
    color: '#64748b',
    margin: '0 0 24px',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 700,
    margin: '0 0 16px',
    color: '#0f172a',
  },
  errorBanner: {
    marginTop: 16,
    padding: '12px 16px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    color: '#991b1b',
    fontSize: 14,
  },
  loading: {
    color: '#64748b',
    fontSize: 14,
  },
  emptyState: {
    padding: '24px',
    background: '#f8fafc',
    border: '1px dashed #cbd5e1',
    borderRadius: 8,
    color: '#64748b',
    textAlign: 'center' as const,
  },
  entitlementGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: 16,
  },
  entCard: {
    padding: '16px 20px',
    borderRadius: 10,
    border: '2px solid',
    background: '#fff',
  },
  entHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  entBadge: {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    color: '#fff',
  },
  entKey: {
    fontSize: 14,
    fontWeight: 700,
    color: '#0f172a',
    textTransform: 'capitalize' as const,
  },
  entReason: {
    fontSize: 12,
    color: '#64748b',
  },
  entQuota: {
    marginTop: 8,
    fontSize: 13,
    color: '#334155',
    fontWeight: 500,
  },
  quotaExceeded: {
    color: '#ef4444',
    fontWeight: 700,
  },
  featureCard: {
    padding: 24,
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  featureDesc: {
    margin: '0 0 16px',
    color: '#64748b',
    fontSize: 14,
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    marginBottom: 16,
  },
  textInput: {
    flex: 1,
    padding: '10px 14px',
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    outline: 'none',
  },
  actionBtn: {
    padding: '10px 20px',
    background: '#0f172a',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
  },
  resultBox: {
    padding: 16,
    background: '#f8fafc',
    borderRadius: 8,
    border: '1px dashed #cbd5e1',
  },
  resultPre: {
    margin: 0,
    fontSize: 13,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    color: '#334155',
  },
  gateOverlay: {
    textAlign: 'center' as const,
    padding: '32px 24px',
  },
  gateIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  gateTitle: {
    fontSize: 18,
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 8px',
  },
  gateText: {
    fontSize: 14,
    color: '#64748b',
    margin: '0 0 20px',
  },
  upgradeBtn: {
    padding: '10px 24px',
    background: '#7c3aed',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
  },
  textarea: {
    width: '100%',
    padding: 12,
    fontSize: 14,
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    resize: 'vertical' as const,
    marginBottom: 12,
    boxSizing: 'border-box' as const,
  },
  toolRow: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  toolBtn: {
    padding: '6px 14px',
    background: '#f1f5f9',
    color: '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
  outputBox: {
    marginTop: 16,
    padding: 12,
    background: '#f0fdf4',
    borderRadius: 8,
    fontSize: 14,
    color: '#166534',
  },
  embedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  embedBadge: {
    padding: '3px 10px',
    background: '#e0e7ff',
    color: '#4338ca',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
  },
  embedContainer: {
    background: '#fff',
    borderRadius: 12,
    border: '1px solid #e2e8f0',
    padding: 24,
  },
  embedPlaceholder: {
    textAlign: 'center' as const,
    padding: '40px 24px',
  },
  embedPlaceholderIcon: {
    fontSize: 40,
    marginBottom: 12,
  },
  embedPlaceholderText: {
    color: '#64748b',
    fontSize: 14,
    marginBottom: 8,
  },
  footer: {
    borderTop: '1px solid #e2e8f0',
    padding: '24px',
    textAlign: 'center' as const,
    color: '#94a3b8',
    fontSize: 13,
  },
}
