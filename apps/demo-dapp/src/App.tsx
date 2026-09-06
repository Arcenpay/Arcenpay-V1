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

function App() {
  return (
    <ArcenPayProvider
      publishableKey={PUBLISHABLE_KEY}
      componentId={COMPONENT_ID}
    >
      <Dashboard />
    </ArcenPayProvider>
  )
}

export default App
