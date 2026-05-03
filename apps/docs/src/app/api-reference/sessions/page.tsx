import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function SessionsApiPage() {
  return (
    <ManagedSurfacePage
      breadcrumb="API Reference"
      title="Advanced Sessions API"
      summary="Advanced metered-session infrastructure is managed by ArcenPay and is not part of the public product integration surface documented here."
      related={[
        { href: '/sdk-reference', label: 'SDK Overview' },
        { href: '/webhooks', label: 'Webhooks' },
        { href: '/support', label: 'Support' },
      ]}
    />
  );
}
