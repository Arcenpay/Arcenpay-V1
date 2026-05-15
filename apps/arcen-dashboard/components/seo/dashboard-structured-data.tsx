import {
  OrganizationJsonLd,
  SoftwareApplicationJsonLd,
} from "next-seo";
import {
  DASHBOARD_APP_URL,
  DASHBOARD_DESCRIPTION,
  DASHBOARD_SITE_NAME,
  absoluteSiteUrl,
} from "@/lib/site-config";

export function DashboardStructuredData() {
  return (
    <>
      <OrganizationJsonLd
        type="Organization"
        name="ArcenPay"
        url={DASHBOARD_APP_URL}
        logo={absoluteSiteUrl("/arcenpay-logo.png")}
        description={DASHBOARD_DESCRIPTION}
      />
      <SoftwareApplicationJsonLd
        type="WebApplication"
        name={DASHBOARD_SITE_NAME}
        url={DASHBOARD_APP_URL}
        description={DASHBOARD_DESCRIPTION}
        applicationCategory="BusinessApplication"
        applicationSubCategory="SubscriptionBilling"
        operatingSystem="Any"
        featureList={[
          "Subscription catalog management",
          "Invoice and payments operations",
          "Environment-based deployment controls",
          "Protocol analytics and revenue reporting",
        ]}
      />
    </>
  );
}
