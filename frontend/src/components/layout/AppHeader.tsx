import { useLocation } from "react-router-dom";
import { UserCircle2, FlaskConical } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/providers/AuthProvider";
import { matchNavItem } from "@/routes/navigation";
import { ThemeToggle } from "./ThemeToggle";

/**
 * Phase 8 Step 1 — page context is now derived automatically from the
 * current route via the shared nav config (routes/navigation.ts) instead
 * of an optional `title` prop no page ever actually passed (dead code
 * since Phase 7 Step 1). Product Detail and Product Marketplace Comparison
 * have no nav entry (drill-down-only routes) and correctly show no
 * section label, same as before.
 *
 * A future analysis-window / marketplace-context slot and a future AI
 * entry point were both considered here (per the Phase 8 Step 0 plan
 * §16.1G) and deliberately NOT added — window/filter state lives inside
 * each page today, not the shell, so wiring it here without a real page
 * to feed it would be a placeholder pretending to be functional. Both
 * remain open for whichever step actually needs them.
 *
 * Development auth indicator + role display — display only, per §9/§10 of
 * the design doc. Never implies this is how a real deployment would work.
 */
export function AppHeader() {
  const { role, subject, isConfigured } = useAuth();
  const { pathname } = useLocation();
  const section = matchNavItem(pathname);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      {section && (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <section.icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {section.label}
        </span>
      )}
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5"
          title="Development authentication — not a production identity provider"
        >
          <FlaskConical className="size-3" aria-hidden="true" />
          Dev auth
        </span>
        {isConfigured && (
          <span className="inline-flex items-center gap-1">
            <UserCircle2 className="size-4" aria-hidden="true" />
            {subject} · <span className="font-medium capitalize">{role}</span>
          </span>
        )}
        <Separator orientation="vertical" className="h-5" />
        <ThemeToggle />
      </div>
    </header>
  );
}
