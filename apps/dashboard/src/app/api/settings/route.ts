// ============================================================
//  Dashboard — Provider Settings API Route
//  Handles GET/PUT for provider notification settings
//  (webhook URL, webhook secret, email address)
// ============================================================

import { NextRequest, NextResponse } from "next/server";

// In-memory store for settings (upgrade to Tableland/DB in production)
const settingsStore = new Map<string, Record<string, string>>();

function getProviderKey(request: NextRequest): string {
  // In production, derive from SIWE session wallet address
  const walletHeader = request.headers.get("x-wallet-address");
  return walletHeader || "default-provider";
}

export async function GET(request: NextRequest) {
  const key = getProviderKey(request);
  const settings = settingsStore.get(key) || {};

  return NextResponse.json({
    webhookUrl: settings.webhookUrl || "",
    webhookSecret: settings.webhookSecret ? "••••••••" : "",
    emailAddress: settings.emailAddress || "",
  });
}

export async function PUT(request: NextRequest) {
  const key = getProviderKey(request);
  const body = await request.json();

  const { webhookUrl, webhookSecret, emailAddress } = body;

  // Validate webhook URL if provided
  if (webhookUrl && typeof webhookUrl === "string" && webhookUrl.length > 0) {
    try {
      new URL(webhookUrl);
    } catch {
      return NextResponse.json(
        { error: "Invalid webhook URL" },
        { status: 400 },
      );
    }
  }

  // Validate email if provided
  if (
    emailAddress &&
    typeof emailAddress === "string" &&
    emailAddress.length > 0
  ) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 },
      );
    }
  }

  const existing = settingsStore.get(key) || {};
  settingsStore.set(key, {
    ...existing,
    webhookUrl: webhookUrl || "",
    webhookSecret: webhookSecret || existing.webhookSecret || "",
    emailAddress: emailAddress || "",
  });

  return NextResponse.json({ success: true });
}
