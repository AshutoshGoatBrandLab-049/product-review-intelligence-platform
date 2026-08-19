import { LayoutDashboard, ListOrdered, TriangleAlert, MessagesSquare, ArrowLeftRight, ShieldCheck, Sparkles, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Phase 8 Step 1 — single source of truth for the app's navigation,
 * shared by AppSidebar (renders it) and AppHeader (derives the current
 * page's context label from it). No route, label, or destination changed
 * from Phase 7 — this only groups the same 6 existing items to read as a
 * WHAT-is-happening / investigate / compare journey instead of a flat API
 * directory, per the Step 0 audit's §16 recommendation. Product Detail is
 * still reached via drill-down only, never a standalone nav item; System
 * is still admin-only, enforced here for UX only — the backend's
 * `authorize()` middleware remains the real, authoritative boundary.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Command Center",
    items: [{ to: "/dashboard", label: "Overview", icon: LayoutDashboard }],
  },
  {
    label: "Investigate",
    items: [
      { to: "/products", label: "Products", icon: ListOrdered },
      { to: "/reviews-overview", label: "Review Overview", icon: BarChart3 },
      { to: "/warnings", label: "Warnings", icon: TriangleAlert },
      { to: "/problems", label: "Problems", icon: MessagesSquare },
      { to: "/ai/analyst", label: "AI Analyst", icon: Sparkles },
    ],
  },
  {
    label: "Compare",
    items: [{ to: "/marketplace/brands", label: "Marketplace", icon: ArrowLeftRight }],
  },
];

export const SYSTEM_NAV_ITEM: NavItem = { to: "/system", label: "System", icon: ShieldCheck };

/** Longest-prefix match against every real nav destination (including the
 * admin-only System item, since an admin can still land there) — used by
 * AppHeader to show page context without every page having to pass its
 * own title prop through. Falls back to null for routes with no nav item
 * (e.g. Product Detail, reached only by drill-down). */
export function matchNavItem(pathname: string): NavItem | null {
  const all = [...NAV_GROUPS.flatMap((g) => g.items), SYSTEM_NAV_ITEM];
  const matches = all.filter((item) => pathname === item.to || pathname.startsWith(`${item.to}/`));
  if (matches.length === 0) return null;
  return matches.reduce((longest, item) => (item.to.length > longest.to.length ? item : longest));
}
