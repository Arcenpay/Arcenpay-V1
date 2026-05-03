import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function Page() {
  return (
    <ManagedSurfacePage
      breadcrumb="Platform"
      title="Architecture"
      summary="ArcenPay's deployment architecture, chain topology, and internal services are managed by the platform and are not part of the supported public integration surface."
    />
  );
}
