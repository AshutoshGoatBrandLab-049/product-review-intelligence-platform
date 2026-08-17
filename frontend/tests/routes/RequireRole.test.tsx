import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RequireRole } from "@/routes/RequireRole";
import * as AuthProviderModule from "@/providers/AuthProvider";

function mockAuth(role: "admin" | "analyst" | "viewer" | null) {
  vi.spyOn(AuthProviderModule, "useAuth").mockReturnValue({ isConfigured: role !== null, role, subject: role ? "test-user" : null });
}

describe("RequireRole (Phase 7 Step 1, §9 — client-side role gate, NOT the security boundary)", () => {
  it("renders children when the current role is in the allowed list", () => {
    mockAuth("admin");
    render(
      <RequireRole roles={["admin"]}>
        <div>Admin content</div>
      </RequireRole>,
    );
    expect(screen.getByText("Admin content")).toBeInTheDocument();
  });

  it("renders NotPermitted, not the children, when the role is not allowed", () => {
    mockAuth("viewer");
    render(
      <RequireRole roles={["admin"]}>
        <div>Admin content</div>
      </RequireRole>,
    );
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
    expect(screen.getByText("Not permitted")).toBeInTheDocument();
  });

  it("renders NotPermitted when there is no role at all", () => {
    mockAuth(null);
    render(
      <RequireRole roles={["admin"]}>
        <div>Admin content</div>
      </RequireRole>,
    );
    expect(screen.getByText("Not permitted")).toBeInTheDocument();
  });
});
