import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function MigrationPlaybookPage() {
  return (
    <ManagedSurfacePage
      breadcrumb="Guides"
      title="Advanced Migration Playbook"
      summary="Legacy migration mechanics beyond the standard public setup flow are handled case by case. Use the public migration guide or contact ArcenPay support for rollout planning."
      related={[
        { href: '/guides/migrate-from-stripe', label: 'Migrate from Stripe' },
        { href: '/quickstart', label: 'Quickstart' },
        { href: '/support', label: 'Support' },
      ]}
    />
  );
}
