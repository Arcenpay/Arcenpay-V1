import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function Page() {
  return (
    <ManagedSurfacePage
      breadcrumb="Platform"
      title="Contract Reference"
      summary="Underlying contracts are managed infrastructure inside ArcenPay. Public integrations should use the dashboard, SDKs, and documented APIs instead of direct contract coupling."
    />
  );
}
