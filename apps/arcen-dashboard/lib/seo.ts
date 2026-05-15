import type { Metadata } from "next";
import {
  DASHBOARD_APP_URL,
  DASHBOARD_DESCRIPTION,
  DASHBOARD_KEYWORDS,
  DASHBOARD_OG_IMAGE_PATH,
  DASHBOARD_SITE_NAME,
  absoluteSiteUrl,
} from "@/lib/site-config";

type PageMetadataOptions = {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
};

function buildRobots(noIndex: boolean): Metadata["robots"] {
  if (noIndex) {
    return {
      index: false,
      follow: false,
      nocache: true,
      googleBot: {
        index: false,
        follow: false,
        noimageindex: true,
      },
    };
  }

  return {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  };
}

export function createPageMetadata({
  title,
  description = DASHBOARD_DESCRIPTION,
  path = "/",
  noIndex = false,
}: PageMetadataOptions = {}): Metadata {
  const resolvedTitle = title
    ? `${title} | ${DASHBOARD_SITE_NAME}`
    : DASHBOARD_SITE_NAME;
  const canonical = absoluteSiteUrl(path);

  return {
    title,
    description,
    alternates: {
      canonical,
    },
    keywords: DASHBOARD_KEYWORDS,
    openGraph: {
      type: "website",
      url: canonical,
      siteName: DASHBOARD_SITE_NAME,
      title: resolvedTitle,
      description,
      images: [
        {
          url: absoluteSiteUrl(DASHBOARD_OG_IMAGE_PATH),
          alt: DASHBOARD_SITE_NAME,
        },
      ],
    },
    twitter: {
      card: "summary",
      title: resolvedTitle,
      description,
      images: [absoluteSiteUrl(DASHBOARD_OG_IMAGE_PATH)],
    },
    robots: buildRobots(noIndex),
  };
}

export const rootMetadata: Metadata = {
  metadataBase: new URL(DASHBOARD_APP_URL),
  applicationName: DASHBOARD_SITE_NAME,
  title: {
    default: DASHBOARD_SITE_NAME,
    template: `%s | ${DASHBOARD_SITE_NAME}`,
  },
  description: DASHBOARD_DESCRIPTION,
  keywords: DASHBOARD_KEYWORDS,
  category: "finance",
  alternates: {
    canonical: DASHBOARD_APP_URL,
  },
  openGraph: {
    type: "website",
    url: DASHBOARD_APP_URL,
    siteName: DASHBOARD_SITE_NAME,
    title: DASHBOARD_SITE_NAME,
    description: DASHBOARD_DESCRIPTION,
    images: [
      {
        url: absoluteSiteUrl(DASHBOARD_OG_IMAGE_PATH),
        alt: DASHBOARD_SITE_NAME,
      },
    ],
  },
  twitter: {
    card: "summary",
    title: DASHBOARD_SITE_NAME,
    description: DASHBOARD_DESCRIPTION,
    images: [absoluteSiteUrl(DASHBOARD_OG_IMAGE_PATH)],
  },
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-light-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  manifest: "/manifest.webmanifest",
};
