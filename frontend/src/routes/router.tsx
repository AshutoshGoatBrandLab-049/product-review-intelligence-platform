import { createBrowserRouter, Navigate, type RouteObject } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Dashboard } from "@/pages/Dashboard";
import { Products } from "@/pages/Products";
import { ProductDetail } from "@/pages/ProductDetail";
import { Warnings } from "@/pages/Warnings";
import { Problems } from "@/pages/Problems";
import { BrandsIndex } from "@/pages/BrandsIndex";
import { BrandComparison } from "@/pages/BrandComparison";
import { ProductComparison } from "@/pages/ProductComparison";
import { System } from "@/pages/System";
import AIProductAnalyst from "@/pages/AIProductAnalyst";
import { RequireRole } from "./RequireRole";

/**
 * Phase 7 Step 1 — exactly the approved routes (§7 of the design doc),
 * plus one justified addition (/marketplace/brands, see BrandsIndex.tsx's
 * own comment). No /login route (dev-token only, §10). No /ai-insights
 * route (no catalog-wide AI-insights-list endpoint exists — AI insights
 * stay embedded in Product Detail, per your explicit decision).
 */
/** Exported separately from the router instance so tests can reuse the
 * exact same route tree with createMemoryRouter instead of duplicating it. */
export const routeConfig: RouteObject[] = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: "dashboard", element: <Dashboard /> },
      { path: "products", element: <Products /> },
      { path: "products/:platform/:sourceProductId", element: <ProductDetail /> },
      { path: "warnings", element: <Warnings /> },
      { path: "problems", element: <Problems /> },
      { path: "marketplace/brands", element: <BrandsIndex /> },
      { path: "marketplace/brands/:brand", element: <BrandComparison /> },
      { path: "marketplace/products/:familyId", element: <ProductComparison /> },
      { path: "ai/analyst", element: <AIProductAnalyst /> },
      {
        path: "system",
        element: (
          <RequireRole roles={["admin"]}>
            <System />
          </RequireRole>
        ),
      },
    ],
  },
];

export const router = createBrowserRouter(routeConfig);
