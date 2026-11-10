import { useState, useEffect, useCallback } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import {
  useArcenPay,
  useFlag,
  useCompanyEntitlements,
  useSolanaEmbedWallet,
  ArcenEmbed,
} from '@arcenpay/react'
import { requestAccess, isConnected } from '@stellar/freighter-api'

export default function Dashboard({ onResetComponent }: { onResetComponent?: () => void }) {
  const { session, identify } = useArcenPay()
  const hasAiFeatures = useFlag('aifetures')
  const { entitlements, loading: entsLoading } = useCompanyEntitlements()

  // Reflect the configured chain instead of a hardcoded label.
  const chainLabel = (() => {
    const raw = Number(import.meta.env.VITE_ARCENPAY_CHAIN_ID) || 677
    const labels: Record<number, string> = {
      677: 'BOT Chain Mainnet',
      968: 'BOT Chain Testnet',
      8453: 'Base Mainnet',
      84532: 'Base Sepolia',
      11155111: 'Sepolia',
      5042002: 'Arc Testnet',
      9000000: 'Stellar Mainnet',
      9000001: 'Stellar Testnet',
      9000002: 'Stellar Futurenet',
      9100000: 'Solana Mainnet',
      9100001: 'Solana Devnet',
      9100002: 'Solana Testnet',
    }
    return `${labels[raw] ?? 'Chain'} (${raw})`
  })()

  const { address: evmAddress, isConnected: isEvmConnected } = useAccount()
  const { connectAsync } = useConnect()
  const { disconnectAsync } = useDisconnect()

  const [walletAddress, setWalletAddress] = useState<string | null>(null)
  const [walletType, setWalletType] = useState<'evm' | 'stellar' | 'solana' | null>(null)
  const [walletConnecting, setWalletConnecting] = useState(false)
  const [identifyError, setIdentifyError] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'connecting' | 'connected' | 'identifying' | 'ready' | 'error'>('idle')
  const [identified, setIdentified] = useState(false)

  // Solana wallet (Phantom/Solflare via Wallet Standard) — the Solana
  // counterpart to wagmi for EVM and Freighter for Stellar.
  const solana = useSolanaEmbedWallet()

  const doIdentify = useCallback(async (address: string, type: 'evm' | 'stellar' | 'solana') => {
    setConnectionStatus('identifying')
    setWalletType(type)
    try {
      await identify({
        company: { wallet: address, name: 'Demo User' },
        user: { wallet: address },
      })
      setConnectionStatus('ready')
      setIdentified(true)
      setIdentifyError(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setIdentifyError(msg)
      setConnectionStatus('error')
    }
  }, [identify])

  const connectEVM = useCallback(async () => {
    setWalletConnecting(true)
    setConnectionStatus('connecting')
    setIdentifyError(null)
    try {
      await connectAsync({ connector: injected() })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.toLowerCase().includes('rejected') && !msg.toLowerCase().includes('cancelled')) {
        setIdentifyError(msg)
      }
      setConnectionStatus('error')
    } finally {
      setWalletConnecting(false)
    }
  }, [connectAsync])

  const connectStellar = useCallback(async () => {
    setWalletConnecting(true)
    setConnectionStatus('connecting')
    setIdentifyError(null)
    try {
      const access = await requestAccess()
      if (access.error) throw new Error(access.error)
      const publicKey = access.address
      if (!publicKey) throw new Error('No address returned from Freighter')
      setWalletAddress(publicKey)
      setWalletType('stellar')
      setConnectionStatus('connected')
      await doIdentify(publicKey, 'stellar')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setIdentifyError(msg)
      setConnectionStatus('error')
    } finally {
      setWalletConnecting(false)
    }
  }, [doIdentify])

  const connectSolana = useCallback(async () => {
    setWalletConnecting(true)
    setConnectionStatus('connecting')
    setIdentifyError(null)
    try {
      await solana.connect()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.toLowerCase().includes('rejected') && !msg.toLowerCase().includes('cancelled')) {
        setIdentifyError(msg)
      }
      setConnectionStatus('error')
    } finally {
      setWalletConnecting(false)
    }
  }, [solana])

  // Once Phantom/Solflare reports a connected address, identify with it.
  useEffect(() => {
    if (solana.address && walletType !== 'solana') {
      setWalletAddress(solana.address)
      setWalletType('solana')
      setConnectionStatus('connected')
      doIdentify(solana.address, 'solana')
    }
  }, [solana.address, walletType, doIdentify])

  useEffect(() => {
    if (isEvmConnected && evmAddress && !walletAddress) {
      setWalletAddress(evmAddress)
      setWalletType('evm')
      setConnectionStatus('connected')
      doIdentify(evmAddress, 'evm')
    }
  }, [isEvmConnected, evmAddress, walletAddress, doIdentify])

  const disconnectWallet = useCallback(async () => {
    try { await disconnectAsync() } catch {}
    try { await solana.disconnect() } catch {}
    try { localStorage.removeItem('arcenpay:embed:stellar-wallet') } catch {}
    setWalletAddress(null)
    setWalletType(null)
    setConnectionStatus('idle')
    setIdentified(false)
    setIdentifyError(null)
  }, [disconnectAsync, solana])

  useEffect(() => {
    isConnected().then((res) => {
      if (res.isConnected) {
        requestAccess().then((access) => {
          if (access.address) {
            setWalletAddress(access.address)
            setWalletType('stellar')
            setConnectionStatus('connected')
            doIdentify(access.address, 'stellar')
          }
        })
      }
    }).catch(() => {})
  }, [doIdentify])

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brand}>
            <span style={styles.brandIcon}>🔌</span>
            <span style={styles.brandText}>ArcenEmbed Demo</span>
          </div>
          <div style={styles.headerRight}>
            {walletAddress ? (
              <div style={styles.walletBadge}>
                <span style={styles.walletDot} />
                <span style={styles.walletText}>{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
                <span style={styles.walletLabel}>{walletType === 'stellar' ? 'Freighter' : walletType === 'solana' ? 'Phantom' : 'EVM'}</span>
                <button onClick={disconnectWallet} style={styles.disconnectBtn}>✕</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={connectEVM} disabled={walletConnecting} style={styles.connectBtn}>
                  {walletConnecting ? 'Connecting...' : '🦊 Connect EVM'}
                </button>
                <button onClick={connectStellar} disabled={walletConnecting} style={styles.connectBtn}>
                  {walletConnecting ? 'Connecting...' : '✦ Connect Stellar'}
                </button>
                <button onClick={connectSolana} disabled={walletConnecting} style={styles.connectBtn}>
                  {walletConnecting ? 'Connecting...' : '◎ Connect Solana'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main style={styles.main}>
        <section style={styles.section}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusBadge status={connectionStatus} />
            <span style={{ fontSize: 13, color: '#64748b' }}>
              {walletAddress ? `${walletType === 'stellar' ? 'Stellar' : walletType === 'solana' ? 'Solana' : 'EVM'}: ${walletAddress.slice(0, 8)}...` : 'No wallet connected'}
            </span>
            {session.isReady && <span style={{ fontSize: 12, color: '#22c55e' }}>✅ Session ready</span>}
          </div>
          {identifyError && (
            <div style={styles.errorBanner}><strong>Error:</strong> {identifyError}</div>
          )}
          <p style={{ fontSize: 13, color: '#94a3b8', marginTop: 8 }}>
            API: api.arcenpay.com · Chain: {chainLabel}
            {onResetComponent && (
              <button onClick={onResetComponent} style={{ marginLeft: 16, background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}>
                Change component
              </button>
            )}
          </p>
        </section>

        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Entitlements</h2>
          {entsLoading ? (
            <div style={{ color: '#94a3b8', fontSize: 14 }}>Loading entitlements...</div>
          ) : Object.keys(entitlements).length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: 14 }}>
              {identified ? 'No entitlements found.' : 'Connect wallet to load entitlements.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
              {Object.entries(entitlements).map(([key, ent]) => (
                <div key={key} style={{
                  padding: '10px 14px', borderRadius: 8, fontSize: 13,
                  background: (ent as any).enabled ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${(ent as any).enabled ? '#22c55e' : '#ef4444'}`,
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span>{(ent as any).enabled ? '✅' : '❌'}</span>
                  <span style={{ fontWeight: 600 }}>{key}</span>
                  {(ent as any).allocation !== null && (
                    <span style={{ color: '#64748b', marginLeft: 'auto' }}>
                      {(ent as any).usage}/{(ent as any).allocation}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section style={styles.section}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h2 style={styles.sectionTitle}>Feature Flags</h2>
            <span style={{ fontSize: 12, color: '#64748b' }}>useFlag(&apos;aifetures&apos;)</span>
          </div>
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: 13,
            background: hasAiFeatures ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${hasAiFeatures ? '#22c55e' : '#e2e8f0'}`,
            display: 'inline-flex', alignItems: 'center', gap: 8,
          }}>
            <span>{hasAiFeatures ? '🚀' : '🔒'}</span>
            <span style={{ fontWeight: 600 }}>AI Features ({hasAiFeatures ? 'Enabled' : 'Disabled'})</span>
          </div>
        </section>

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
                  {isEvmConnected || walletAddress
                    ? 'Identifying your session...'
                    : 'Connect your EVM or Stellar wallet to load the billing portal.'}
                </p>
              </div>
            ) : (
              <ArcenEmbed />
            )}
          </div>
        </section>
      </main>

      <footer style={styles.footer}>
        ArcenPay Demo · Built with @arcenpay/react · BOT Chain Mainnet
      </footer>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    idle: '#94a3b8', connecting: '#f59e0b', connected: '#3b82f6',
    identifying: '#8b5cf6', ready: '#22c55e', error: '#ef4444',
  }
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 4, fontSize: 12, fontWeight: 700,
      color: '#fff', background: colors[status] || '#94a3b8', textTransform: 'uppercase' as const,
    }}>{status}</span>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, sans-serif' },
  header: { background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '12px 24px' },
  headerInner: { maxWidth: 960, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  brand: { display: 'flex', alignItems: 'center', gap: 8 },
  brandIcon: { fontSize: 24 },
  brandText: { fontSize: 18, fontWeight: 700, color: '#0f172a' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 8 },
  connectBtn: { padding: '8px 16px', background: '#0f172a', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  walletBadge: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: '#f1f5f9', borderRadius: 8, fontSize: 13 },
  walletDot: { width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' },
  walletText: { fontWeight: 600, color: '#0f172a' },
  walletLabel: { fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' as const },
  disconnectBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 4 },
  main: { maxWidth: 960, margin: '0 auto', padding: '24px 24px 48px' },
  section: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 },
  errorBanner: { padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 13, color: '#dc2626', marginTop: 12 },
  embedHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap' as const, gap: 8 },
  embedBadge: { padding: '3px 10px', background: '#e0e7ff', color: '#4338ca', borderRadius: 4, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const },
  embedContainer: { background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 24 },
  embedPlaceholder: { textAlign: 'center' as const, padding: '40px 24px' },
  embedPlaceholderIcon: { fontSize: 40, marginBottom: 12 },
  embedPlaceholderText: { color: '#64748b', fontSize: 14, marginBottom: 8 },
  footer: { borderTop: '1px solid #e2e8f0', padding: 24, textAlign: 'center' as const, color: '#94a3b8', fontSize: 13 },
}
