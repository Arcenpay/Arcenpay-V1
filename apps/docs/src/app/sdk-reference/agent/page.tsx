import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function AgentSDKPage() {
  return (
    <ManagedSurfacePage
      breadcrumb="SDK Reference"
      title="Advanced Agent Tooling"
      summary="Low-level agent settlement and metered session tooling is managed by ArcenPay and is not included in the public integration guidance for the platform docs."
      related={[
        { href: '/sdk-reference/node', label: 'Node.js SDK' },
        { href: '/features/checkout', label: 'Checkout Patterns' },
        { href: '/support', label: 'Support' },
      ]}
    />
  );
}
