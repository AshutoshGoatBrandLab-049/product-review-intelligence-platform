import { Outlet } from "react-router-dom";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./AppSidebar";
import { AppHeader } from "./AppHeader";

/**
 * Main dashboard shell (§8 of the design doc): sidebar + header + content
 * area. Responsive via shadcn's own SidebarProvider (collapses to a sheet
 * below the mobile breakpoint automatically) — no separate mobile nav was
 * hand-built, reusing the primitive instead of duplicating it.
 */
export function AppShell() {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="flex-1 overflow-auto p-6">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
