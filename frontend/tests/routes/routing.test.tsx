import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { routeConfig } from "@/routes/router";
import { ThemeProvider } from "@/providers/ThemeProvider";
import * as AuthProviderModule from "@/providers/AuthProvider";

function renderAt(path: string, role: "admin" | "analyst" | "viewer" = "admin") {
  vi.spyOn(AuthProviderModule, "useAuth").mockReturnValue({ isConfigured: true, role, subject: `test-${role}` });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const memoryRouter = createMemoryRouter(routeConfig, { initialEntries: [path] });
  render(
    // Phase 8 Step 1: AppHeader's ThemeToggle needs ThemeProvider in the
    // tree — the real App.tsx already provides it; this test renders the
    // router directly, so it must supply the same context.
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <RouterProvider router={memoryRouter} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/**
 * Phase 7 Step 1 — proves every approved route (§7 of the design doc)
 * actually resolves to a rendered page through the real router tree, the
 * real AppShell, and the real sidebar — not just that the component
 * functions exist. Role is mocked to "admin" so /system (role-gated) is
 * also provably reachable in this smoke test; RequireRole's own gating
 * logic is separately, directly tested in RequireRole.test.tsx.
 */
describe("Application routing (Phase 7 Step 1, §7/§8)", () => {
  it("/ redirects to /dashboard", () => {
    renderAt("/");
    expect(screen.getByText("Executive Dashboard")).toBeInTheDocument();
  });

  it("/dashboard renders the Dashboard stub", () => {
    renderAt("/dashboard");
    expect(screen.getByText("Executive Dashboard")).toBeInTheDocument();
  });

  it("/products renders the Products stub", () => {
    renderAt("/products");
    expect(screen.getByText("Product Rankings")).toBeInTheDocument();
  });

  it("/products/flipkart/PID001 renders Product Detail with real path params", () => {
    // Phase 7 Step 3 replaced the stub with the real page — this checks the
    // real, immediately-rendered (URL-derived, not API-data-dependent)
    // header content, not the old placeholder text.
    renderAt("/products/flipkart/PID001");
    expect(screen.getByText("PID001")).toBeInTheDocument();
    expect(screen.getByText("flipkart")).toBeInTheDocument();
  });

  it("/warnings renders the Warnings stub", () => {
    renderAt("/warnings");
    expect(screen.getByText("Early Warnings")).toBeInTheDocument();
  });

  it("/problems renders the Problems stub", () => {
    renderAt("/problems");
    // getByText("Problems") would ambiguously match both the sidebar nav
    // label and the page heading (both say exactly "Problems") — scoping
    // to the heading role is what actually disambiguates the page content.
    expect(screen.getByRole("heading", { name: "Problems" })).toBeInTheDocument();
  });

  it("/marketplace/brands renders the brands index stub", () => {
    renderAt("/marketplace/brands");
    expect(screen.getByText("Marketplace Comparison")).toBeInTheDocument();
  });

  it("/marketplace/brands/:brand renders Brand Comparison with the real brand param", () => {
    // Phase 7 Step 7 replaced the stub with the real page — this checks the
    // real, immediately-rendered (URL-derived, not API-data-dependent)
    // header content, not the old placeholder text (same pattern as the
    // Product Detail route check above).
    renderAt("/marketplace/brands/Bluepeak");
    expect(screen.getByRole("heading", { name: "Bluepeak", level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to marketplace/i })).toBeInTheDocument();
  });

  it("/marketplace/products/:familyId renders Product Comparison with the real familyId param", () => {
    // Phase 7 Step 8 replaced the stub with the real page — this checks the
    // real, immediately-rendered (URL-derived, not API-data-dependent)
    // header content, not the old placeholder text (same pattern as the
    // Product Detail and Brand Comparison route checks above).
    renderAt("/marketplace/products/00000000-0000-0000-0000-000000000000");
    expect(screen.getByRole("heading", { name: "Product Comparison", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("00000000-0000-0000-0000-000000000000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to marketplace/i })).toBeInTheDocument();
  });

  it("/system renders for an admin role", () => {
    renderAt("/system");
    expect(screen.getByText("System / Admin")).toBeInTheDocument();
  });

  it("the sidebar renders the System nav item for an admin role", () => {
    renderAt("/dashboard");
    expect(screen.getByText("System")).toBeInTheDocument();
  });

  it("the sidebar hides the System nav item for a viewer role (role-aware navigation, §9)", () => {
    renderAt("/dashboard", "viewer");
    expect(screen.queryByText("System")).not.toBeInTheDocument();
  });

  it("a viewer navigating directly to /system sees Not Permitted, not the System page", () => {
    renderAt("/system", "viewer");
    expect(screen.getByText("Not permitted")).toBeInTheDocument();
    expect(screen.queryByText("System / Admin")).not.toBeInTheDocument();
  });

  /**
   * Phase 8 Step 1 — the sidebar now groups the same routes under journey-
   * oriented labels (Step 0 audit §16) instead of one flat "Navigate"
   * group. These checks prove every existing destination is still
   * reachable under its new group, not that any route/label changed.
   */
  it("the sidebar groups navigation into Command Center / Investigate / Compare sections, all items still present", () => {
    renderAt("/dashboard");
    expect(screen.getByText("Command Center")).toBeInTheDocument();
    expect(screen.getByText("Investigate")).toBeInTheDocument();
    expect(screen.getByText("Compare")).toBeInTheDocument();
    // Exact (not regex/substring) names — Phase 8 Step 2's real Dashboard
    // content added its own real links ("View all warnings", "View all
    // problems", "Compare marketplaces", "Rankings") whose accessible
    // names would otherwise ambiguously match a loose /warnings/i-style
    // pattern too. The sidebar's own link text is always exactly the nav
    // item label alone.
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "Products" })).toHaveAttribute("href", "/products");
    expect(screen.getByRole("link", { name: "Warnings" })).toHaveAttribute("href", "/warnings");
    expect(screen.getByRole("link", { name: "Problems" })).toHaveAttribute("href", "/problems");
    expect(screen.getByRole("link", { name: "Marketplace" })).toHaveAttribute("href", "/marketplace/brands");
  });

  it("the sidebar shows an 'Admin' group label only for an admin role", () => {
    renderAt("/dashboard", "admin");
    expect(screen.getByText("Admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "System" })).toHaveAttribute("href", "/system");
  });

  it("the sidebar shows no 'Admin' group label for a viewer role", () => {
    renderAt("/dashboard", "viewer");
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("the header shows the current section's context label, derived from the route", () => {
    renderAt("/warnings");
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("Warnings");
  });

  it("the header shows the parent section's label for a drill-down route nested under it", () => {
    // /products/:platform/:id has no nav item of its own, but is genuinely
    // nested under the real "/products" destination — same parent-match
    // logic the sidebar already uses for its own active-state highlight.
    renderAt("/products/flipkart/PID001");
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent("Products");
  });

  it("the header shows no section label for a route with no matching nav entry at all", () => {
    // /marketplace/products/:familyId is a real route, but no nav item
    // points at it or a parent of it (only /marketplace/brands does) —
    // the header must not fabricate a section label for it.
    renderAt("/marketplace/products/00000000-0000-0000-0000-000000000000");
    const header = screen.getByRole("banner");
    expect(header).not.toHaveTextContent(/Marketplace|Overview|Products|Warnings|Problems/);
  });

  it("the header renders an accessible theme control", () => {
    renderAt("/dashboard");
    expect(screen.getByRole("button", { name: "Change theme" })).toBeInTheDocument();
  });
});
