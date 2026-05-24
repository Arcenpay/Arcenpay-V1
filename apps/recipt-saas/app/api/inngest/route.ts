import { extractAndSavePDF } from "@/inngest/agent";
import { inngest } from "@/inngest/client";
import { serve } from "inngest/next";
import type { NextRequest } from "next/server";

const handler = serve({
  client: inngest,
  functions: [extractAndSavePDF],
});

type InngestRequest = Parameters<typeof handler.GET>[0];

export async function GET(request: NextRequest) {
  return handler.GET(request as unknown as InngestRequest, {});
}

export async function POST(request: NextRequest) {
  return handler.POST(request as unknown as InngestRequest, {});
}

export async function PUT(request: NextRequest) {
  return handler.PUT(request as unknown as InngestRequest, {});
}
