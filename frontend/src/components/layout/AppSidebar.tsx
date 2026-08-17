import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useAuth } from "@/providers/AuthProvider";
import { NAV_GROUPS, SYSTEM_NAV_ITEM } from "@/routes/navigation";

/**
 * Phase 8 Step 1 — navigation now reads from the shared NAV_GROUPS config
 * (routes/navigation.ts) instead of a flat local list, grouped to read as
 * a WHAT-is-happening / investigate / compare journey (Step 0 audit §16)
 * rather than a flat API directory. No route, destination, or item was
 * added, removed, or renamed from Phase 7 — this is presentation only.
 * Product Detail is reached via drill-down only, never a standalone nav
 * item; System is admin-only, enforced here for UX only — the backend's
 * `authorize()` middleware is the real, authoritative boundary (§18).
 */
export function AppSidebar() {
  const { role } = useAuth();
  const { pathname } = useLocation();

  function isActive(to: string) {
    return pathname === to || pathname.startsWith(`${to}/`);
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-3 py-3">
        <span className="text-sm font-semibold tracking-tight text-sidebar-primary">Product Review Intelligence</span>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive(item.to)}>
                      <NavLink to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive(SYSTEM_NAV_ITEM.to)}>
                    <NavLink to={SYSTEM_NAV_ITEM.to}>
                      <SYSTEM_NAV_ITEM.icon />
                      <span>{SYSTEM_NAV_ITEM.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
