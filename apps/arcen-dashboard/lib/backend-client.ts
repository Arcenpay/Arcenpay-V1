import type {
  ApiResponse,
  PaginatedResponse,
  SessionResponse,
  LoginResponse,
  CatalogPlan,
  CreatePlanRequest,
  UpdatePlanRequest,
  ArcenCompany,
  CreateCompanyRequest,
} from "@arcenpay/shared-types";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || "http://localhost:3300";

class BackendClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async fetch<T>(path: string, options: RequestInit & { params?: Record<string, string | number | undefined> } = {}): Promise<T> {
    const { params, ...init } = options;
    
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined) sp.set(k, String(v));
      }
      const qs = sp.toString();
      if (qs) url += `?${qs}`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> ?? {}),
    };

    const res = await fetch(url, {
      ...init,
      headers,
      credentials: "include",
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Network error", code: "NETWORK_ERROR" }));
      throw new BackendError(res.status, err.error ?? "Request failed", err.code ?? "UNKNOWN");
    }

    return res.json();
  }

  // ── Auth ───────────────────────────────────────────────────────────────────
  // Paths: /api/v1/auth/*
  async getNonce() { return this.fetch<ApiResponse<{ nonce: string }>>("/api/v1/auth/nonce"); }
  async getSession() { return this.fetch<ApiResponse<SessionResponse>>("/api/v1/auth/session"); }
  async login(body: { message: string; signature: string; address: string; chainId: number }) {
    return this.fetch<ApiResponse<LoginResponse>>("/api/v1/auth/session", { method: "POST", body } as any);
  }
  async logout() { return this.fetch<ApiResponse<{ success: boolean }>>("/api/v1/auth/logout", { method: "DELETE" } as any); }

  // ── Catalog ────────────────────────────────────────────────────────────────
  // Paths: /api/v1/catalog/*
  async listPlans(params?: { environmentMode?: string; status?: string }) {
    return this.fetch<ApiResponse<{ plans: CatalogPlan[] }>>("/api/v1/catalog/plans", { params });
  }
  async createPlan(body: CreatePlanRequest) {
    return this.fetch<ApiResponse<{ plan: CatalogPlan }>>("/api/v1/catalog/plans", { method: "POST", body } as any);
  }
  async updatePlan(body: UpdatePlanRequest) {
    return this.fetch<ApiResponse<{ plan: CatalogPlan }>>("/api/v1/catalog/plans", { method: "PUT", body } as any);
  }
  async deletePlan(id: string) {
    return this.fetch<ApiResponse<{ success: boolean }>>("/api/v1/catalog/plans", { method: "DELETE", body: { id } } as any);
  }

  // ── Invoice ────────────────────────────────────────────────────────────────
  // Paths: /api/v1/invoices/*
  async listInvoices(params?: { limit?: number; cursor?: string }) {
    return this.fetch<ApiResponse<any>>("/api/v1/invoices", { params });
  }
  async getInvoice(id: string) {
    return this.fetch<ApiResponse<any>>(`/api/v1/invoices/${id}`);
  }

  // ── Companies (V1 SDK) ────────────────────────────────────────────────────
  // Paths: /api/v1/companies
  async listCompanies(params?: { limit?: number; cursor?: string; search?: string }) {
    return this.fetch<ApiResponse<PaginatedResponse<ArcenCompany>>>("/api/v1/companies", { params });
  }
  async createCompany(body: CreateCompanyRequest) {
    return this.fetch<ApiResponse<{ data: ArcenCompany }>>("/api/v1/companies", { method: "POST", body } as any);
  }

  // ── Billing ────────────────────────────────────────────────────────────────
  async listBillingEvents(params?: any) {
    return this.fetch<ApiResponse<any>>("/api/v1/billing/events", { params });
  }

  // ── Provider ───────────────────────────────────────────────────────────────
  async getProviderProfile() {
    return this.fetch<ApiResponse<any>>("/api/v1/provider/profile");
  }

  // ── Team ───────────────────────────────────────────────────────────────────
  async getTeam() { return this.fetch<ApiResponse<any>>("/api/v1/team"); }
  async updateTeam(body: any) { return this.fetch<ApiResponse<any>>("/api/v1/team", { method: "PUT", body } as any); }

  // ── Generic methods ────────────────────────────────────────────────────────
  async get<T>(path: string, params?: Record<string, string | number | undefined>) {
    return this.fetch<ApiResponse<T>>(path, { params });
  }
  async post<T>(path: string, body?: unknown) {
    return this.fetch<ApiResponse<T>>(path, { method: "POST", body } as any);
  }
  async put<T>(path: string, body?: unknown) {
    return this.fetch<ApiResponse<T>>(path, { method: "PUT", body } as any);
  }
  async del<T>(path: string, body?: unknown) {
    return this.fetch<ApiResponse<T>>(path, { method: "DELETE", body } as any);
  }
}

export class BackendError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string,
  ) { super(message); this.name = "BackendError"; }
}

export const backend = new BackendClient(BACKEND_URL);
