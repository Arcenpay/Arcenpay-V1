const SNIPPET = `import { CheckoutModal, MEAPProvider } from "@meap/react";

// Wrap your app once
<MEAPProvider chainId={11155111}>
  <App />
</MEAPProvider>

// Add the checkout button anywhere
<CheckoutModal
  planId={1n}
  onSuccess={({ tokenId }) => grantAccess(tokenId)}
/>`;

export function IntegrationSnippet() {
  return (
    <section className="py-24 px-6">
      <div className="max-w-4xl mx-auto text-center">
        <h2 className="text-4xl font-bold text-white mb-4">
          Integrate in 3 lines
        </h2>
        <p className="text-zinc-400 text-lg mb-12 max-w-2xl mx-auto">
          Drop the CheckoutModal into any React app. It handles smart account
          deployment, autopay authorization, and subscription NFT minting
          automatically.
        </p>

        <div className="relative">
          <pre className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-left text-sm text-zinc-300 overflow-x-auto">
            <code>{SNIPPET}</code>
          </pre>
          <div className="absolute top-4 right-4 flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500/60" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <span className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
        </div>

        <div className="mt-12 flex flex-col sm:flex-row gap-4 justify-center">
          <a
            href="https://docs.arcenpay.xyz"
            className="px-6 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 font-medium hover:bg-blue-500/20 transition-colors"
          >
            Read the Docs
          </a>
          <a
            href="https://github.com/arcenpay"
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 rounded-xl bg-zinc-800 border border-zinc-700 text-white font-medium hover:bg-zinc-700 transition-colors"
          >
            View on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}
