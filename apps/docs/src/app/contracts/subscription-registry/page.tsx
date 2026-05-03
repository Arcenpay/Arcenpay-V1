import ManagedSurfacePage from '@/app/_components/ManagedSurfacePage';

export default function Page() {
  return (
    <ManagedSurfacePage
      breadcrumb="Platform"
      title="SubscriptionRegistry"
      summary="Subscription state is exposed through the supported APIs and SDKs. Direct registry implementation details are not part of the public integration surface."
    />
  );
}
