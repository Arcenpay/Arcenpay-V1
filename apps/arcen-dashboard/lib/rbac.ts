import type { TeamRole } from "@/lib/auth";

export type Permission =
  | "catalog:read"
  | "catalog:write"
  | "templates:read"
  | "templates:write"
  | "templates:install"
  | "invoices:read"
  | "invoices:write"
  | "invoices:send"
  | "audit:read"
  | "environment:switch";

const ALL_PERMISSIONS: Permission[] = [
  "catalog:read",
  "catalog:write",
  "templates:read",
  "templates:write",
  "templates:install",
  "invoices:read",
  "invoices:write",
  "invoices:send",
  "audit:read",
  "environment:switch",
];

const ROLE_PERMISSIONS: Record<TeamRole, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  ADMIN: [
    "catalog:read",
    "catalog:write",
    "templates:read",
    "templates:write",
    "templates:install",
    "invoices:read",
    "invoices:write",
    "invoices:send",
    "audit:read",
    "environment:switch",
  ],
  FINANCE: ["invoices:read", "invoices:write", "invoices:send", "audit:read"],
  DEVELOPER: [
    "catalog:read",
    "catalog:write",
    "templates:read",
    "templates:write",
    "templates:install",
    "invoices:read",
  ],
  SUPPORT: ["catalog:read", "templates:read", "invoices:read", "audit:read"],
  MEMBER: ["catalog:read", "templates:read", "invoices:read"],
};

export function hasPermission(role: TeamRole, permission: Permission): boolean {
  const permissions = ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.MEMBER;
  return permissions.includes(permission);
}
