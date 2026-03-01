// ============================================================
//  Dashboard — Provider Settings API Route
//  Handles GET/PUT for provider notification settings
//  (webhook URL, webhook secret, email address)
//
//  Persistence: file-based JSON scoped by SIWE session address
//  Location: .data/settings/<address>.json
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import { sessionOptions, type SessionData } from "@/lib/session";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";

const SETTINGS_DIR = path.join(process.cwd(), ".data", "settings");

async function getProviderAddress(
  request: NextRequest,
): Promise<string | null> {
  try {
    const session = await getIronSession<SessionData>(
      await cookies(),
      sessionOptions,
    );
    if (session.isLoggedIn && session.address) {
      return session.address.toLowerCase();
    }
  } catch {
    // Fall through
  }
  return null;
}

function settingsPath(address: string): string {
  // Sanitize address to prevent path traversal
  const safe = address.replace(/[^a-f0-9x]/gi, "");
  return path.join(SETTINGS_DIR, `${safe}.json`);
}

async function loadSettings(
  address: string,
): Promise<Record<string, string>> {
  try {
    const raw = await readFile(settingsPath(address), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveSettings(
  address: string,
  settings: Record<string, string>,
): Promise<void> {
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(settingsPath(address), JSON.stringify(settings, null, 2));
}

export async function GET(request: NextRequest) {
  const address = await getProviderAddress(request);
  if (!address) {
    return NextResponse.json(
      { error: "Unauthorized — SIWE session required" },
      { status: 401 },
    );
  }

  const settings = await loadSettings(address);

  return NextResponse.json({
    webhookUrl: settings.webhookUrl || "",
    webhookSecret: settings.webhookSecret ? "••••••••" : "",
    emailAddress: settings.emailAddress || "",
  });
}

export async function PUT(request: NextRequest) {
  const address = await getProviderAddress(request);
  if (!address) {
    return NextResponse.json(
      { error: "Unauthorized — SIWE session required" },
      { status: 401 },
    );
  }

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

  const existing = await loadSettings(address);
  const updated = {
    ...existing,
    webhookUrl: webhookUrl || "",
    webhookSecret: webhookSecret || existing.webhookSecret || "",
    emailAddress: emailAddress || "",
    updatedAt: new Date().toISOString(),
  };

  await saveSettings(address, updated);

  return NextResponse.json({ success: true });
}
