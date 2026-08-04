import { ArcenPayProvider } from '@arcenpay/react'
import Dashboard from './Dashboard'

const PUBLISHABLE_KEY = 'api__bM8SiVSGe6UcNRcOrYN-iEyJjBU_ypMvvOkN_ruNdY'
const COMPONENT_ID = 'cmsdjtw440004zrv0hvifafj6'

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
