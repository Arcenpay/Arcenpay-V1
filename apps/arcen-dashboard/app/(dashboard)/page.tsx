"use client";

import dynamic from "next/dynamic";

export type { Section } from "@/components/dashboard/dashboard-client";

// This screen verifies the session in the browser and uses wallet SDKs.
// Keep its module graph out of the Worker's server render.
const Dashboard = dynamic(
  () => import("@/components/dashboard/dashboard-client"),
  { ssr: false },
);

export default Dashboard;
