import { TESTNET_NETWORK_ROWS } from '@/lib/testnet-deployments';

const CONTRACT_KEYS = [
  'subscriptionRegistry',
  'planFactory',
  'sessionVault',
  'feeCollector',
  'autopayModule',
  'zkUsageVerifier',
] as const;

export default function ContractAddressesPage() {
  return (
    <div className="flex items-start justify-center gap-[18px] flex-1 px-4 lg:px-0">
      <article className="flex-1 max-w-[860px] min-w-0 py-10 px-4 lg:px-[60px] pb-24">
        <div className="text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground mb-3">Resources</div>
        <div className="flex items-center justify-between gap-4 mb-3.5"><h1>Contract Addresses</h1></div>

        <p className="text-[16.5px] text-muted-foreground leading-relaxed mb-7 max-w-[740px]" id="contract-addresses">
          The SDK resolves ArcenPay deployment addresses from the published
          chain config. These are the currently exposed testnet addresses used
          by the public docs stack.
        </p>

        <h2 id="testnets">Testnet deployments</h2>
        {TESTNET_NETWORK_ROWS.map((network) => (
          <div key={network.chainId} className="mb-8">
            <h3 className="text-[17px] font-bold tracking-[-0.02em] mb-3">
              {network.label} <span className="text-muted-foreground font-medium">(chain {network.chainId})</span>
            </h3>
            <table className="docs-table">
              <thead>
                <tr>
                  <th>Contract</th>
                  <th>Address</th>
                </tr>
              </thead>
              <tbody>
                {CONTRACT_KEYS.map((key) => (
                  <tr key={`${network.chainId}-${key}`}>
                    <td><code>{key}</code></td>
                    <td><code>{network.contracts[key] ?? '—'}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <h2 id="usage">How to use them</h2>
        <p className="text-[15px] text-muted-foreground leading-relaxed mb-[15px]">
          Prefer reading addresses through <code>@arcenpay/sdk</code> instead of
          hardcoding them in your application. That keeps docs, SDK, and
          environment-specific deployments aligned.
        </p>
        <div className="docs-codeblock">
          <div className="docs-codeblock-header">
            <span className="docs-codeblock-lang">ts</span>
          </div>
          <pre>
            <code>{`import { getContractAddresses } from '@arcenpay/sdk';

const baseSepolia = getContractAddresses(84532);
console.log(baseSepolia.subscriptionRegistry);`}</code>
          </pre>
        </div>
      </article>

      <nav className="hidden xl:block w-[232px] shrink-0 sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-8 pr-5 pl-1.5">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.09em] text-muted-foreground mb-3.5">On this page</div>
        <ul className="border-l-[1.5px] border-border flex flex-col gap-0.5 py-1">
          <li className="toc-item active"><a className="block text-[12.5px] text-foreground font-semibold py-1 pl-[13px] -ml-[1.5px] border-l-2 border-foreground" href="#contract-addresses">Contract Addresses</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#testnets">Testnet deployments</a></li>
          <li className="toc-item"><a className="block text-[12.5px] text-muted-foreground hover:text-foreground py-1 pl-[13px] -ml-[1.5px] border-l-2 border-transparent transition-colors" href="#usage">How to use them</a></li>
        </ul>
      </nav>
    </div>
  );
}
