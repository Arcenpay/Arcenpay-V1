// ── API Response Envelope ────────────────────────────────────────────────────

export interface ApiErrorPayload {
  ok: false;
  error: string;
  code: string;
  detail?: string;
  retryAt?: number;
}

export interface ApiSuccessPayload<T = unknown> {
  ok: true;
  data: T;
}

export type ApiResponse<T = unknown> = ApiSuccessPayload<T> | ApiErrorPayload;

// ── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  nextCursor?: string;
}

// ── Auth Types ───────────────────────────────────────────────────────────────

export interface SessionResponse {
  authenticated: boolean;
  userId?: string;
  email?: string | null;
  walletAddress?: string | null;
  currentTeamId?: string | null;
}

export interface LoginRequest {
  message: string;
  signature: string;
  address: string;
  chainId: number;
}

export interface LoginResponse {
  sessionId: string;
  userId: string;
  email: string | null;
  walletAddress: string | null;
  currentTeamId: string | null;
  expiresAt: string;
}

// ── Catalog Types ────────────────────────────────────────────────────────────

export type CatalogStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type ChainSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "NOT_APPLICABLE";
export type EnvironmentMode = "DEVELOPMENT" | "PRODUCTION";

export interface CatalogPlan {
  id: string;
  teamId: string;
  name: string;
  tier: string;
  description: string | null;
  price: string;
  annualPrice: string | null;
  billingInterval: number;
  acceptedToken: string;
  status: CatalogStatus;
  active: boolean;
  environmentMode: EnvironmentMode;
  version: number;
  chainSyncStatus: ChainSyncStatus;
  onChainPlanId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface CreatePlanRequest {
  name: string;
  tier: string;
  description?: string;
  price: number;
  annualPrice?: number;
  billingInterval: number;
  acceptedToken: string;
  metadata?: Record<string, unknown>;
  environmentMode?: EnvironmentMode;
}

export interface UpdatePlanRequest {
  id: string;
  name?: string;
  tier?: string;
  description?: string | null;
  price?: number;
  annualPrice?: number | null;
  billingInterval?: number;
  acceptedToken?: string;
  metadata?: Record<string, unknown>;
  status?: CatalogStatus;
  active?: boolean;
}

// ── Company Types ────────────────────────────────────────────────────────────

export interface ArcenCompany {
  id: string;
  name: string;
  walletAddress: string | null;
  email: string | null;
  externalId: string | null;
  activePlanId: string | null;
  logoUrl: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface CreateCompanyRequest {
  name: string;
  wallet?: string;
  email?: string;
  id?: string;
  traits?: Record<string, unknown>;
  logoUrl?: string;
}

// ── Team / Permission Types ──────────────────────────────────────────────────

export type TeamRole = "OWNER" | "ADMIN" | "FINANCE" | "DEVELOPER" | "SUPPORT" | "MEMBER";

export type Permission =
  | "catalog:read" | "catalog:write"
  | "templates:read" | "templates:write" | "templates:install"
  | "invoices:read" | "invoices:write" | "invoices:send"
  | "audit:read" | "environment:switch"
  | "support:read" | "support:write";

export interface TeamContext {
  teamId: string;
  teamRole: TeamRole;
  userId: string;
  walletAddress?: string;
}
