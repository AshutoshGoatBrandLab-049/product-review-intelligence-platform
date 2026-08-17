import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { System } from "@/pages/System";
import { RequireRole } from "@/routes/RequireRole";
import { ApiClientError } from "@/api/errors";
import * as AuthProviderModule from "@/providers/AuthProvider";
import type { IngestionStatusResponse, AiUsageResponse, IngestionWatermarkRow, AiProcessingRunRow } from "@/types/api";

const { getIngestionStatusMock, getAiUsageMock } = vi.hoisted(() => ({
  getIngestionStatusMock: vi.fn(),
  getAiUsageMock: vi.fn(),
}));
vi.mock("@/api/endpoints/system", () => ({
  getIngestionStatus: getIngestionStatusMock,
  getAiUsage: getAiUsageMock,
}));

function mockAuth(role: "admin" | "analyst" | "viewer" | null) {
  vi.spyOn(AuthProviderModule, "useAuth").mockReturnValue({ isConfigured: role !== null, role, subject: role ? "test-user" : null });
}

function makeWatermark(overrides: Partial<IngestionWatermarkRow> = {}): IngestionWatermarkRow {
  return {
    platform: "flipkart",
    last_seen_source_id: "50123",
    last_reconciliation_run_at: "2026-01-15T02:00:00.000Z",
    last_reconciliation_rows_scanned: 1200,
    last_reconciliation_rows_changed: 4,
    status: "idle",
    lock_acquired_at: null,
    updated_at: "2026-01-15T02:05:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<AiProcessingRunRow> = {}): AiProcessingRunRow {
  return {
    id: "run-1",
    job_id: "job-abc123",
    platform: "myntra",
    provider: "gemini",
    model_version: "gemini-2.0-flash",
    dry_run: false,
    candidate_count: 10,
    already_classified_count: 2,
    stale_count: 1,
    new_count: 7,
    processed_count: 10,
    success_count: 9,
    failure_count: 1,
    retry_count: 2,
    started_at: "2026-01-15T01:00:00.000Z",
    finished_at: "2026-01-15T01:05:00.000Z",
    duration_ms: 300000,
    status: "success",
    ...overrides,
  };
}

function renderSystem() {
  mockAuth("admin");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/system"]}>
        <System />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderSystemGated(role: "admin" | "analyst" | "viewer" | null) {
  mockAuth(role);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/system"]}>
        <RequireRole roles={["admin"]}>
          <System />
        </RequireRole>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("System (Phase 7 Step 9)", () => {
  beforeEach(() => {
    getIngestionStatusMock.mockReset();
    getAiUsageMock.mockReset();
  });

  it("1. renders successfully for an admin with real mocked data", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [makeWatermark()] } satisfies IngestionStatusResponse);
    getAiUsageMock.mockResolvedValue({ runs: [makeRun()] } satisfies AiUsageResponse);
    renderSystem();
    expect(await screen.findByRole("heading", { name: "System / Admin", level: 1 })).toBeInTheDocument();
  });

  it("2. renders both real sections: ingestion status and AI usage", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [makeWatermark()] });
    getAiUsageMock.mockResolvedValue({ runs: [makeRun()] });
    renderSystem();
    expect(await screen.findByRole("heading", { name: "Ingestion status" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AI usage" })).toBeInTheDocument();
  });

  it("3. shows exact backend-returned ingestion watermark values", async () => {
    getIngestionStatusMock.mockResolvedValue({
      watermarks: [makeWatermark({ platform: "flipkart", last_seen_source_id: "99887", status: "running", last_reconciliation_rows_scanned: 555, last_reconciliation_rows_changed: 12 })],
    });
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystem();
    await screen.findByText("99887");
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("555")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("4. shows exact backend-returned AI usage run values", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({
      runs: [makeRun({ job_id: "job-xyz999", provider: "anthropic", model_version: "claude-x", candidate_count: 42, success_count: 40, failure_count: 2, retry_count: 3 })],
    });
    renderSystem();
    await screen.findByText("job-xyz999");
    expect(screen.getByText("anthropic / claude-x")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("5. renders the loading state before both queries resolve", async () => {
    getIngestionStatusMock.mockReturnValue(new Promise(() => {}));
    getAiUsageMock.mockReturnValue(new Promise(() => {}));
    renderSystem();
    expect(await screen.findAllByRole("status")).not.toHaveLength(0);
  });

  it("6. renders an honest empty state for zero watermarks and zero AI runs independently", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystem();
    expect(await screen.findByText("No ingestion watermarks recorded yet")).toBeInTheDocument();
    expect(screen.getByText("No AI processing runs yet")).toBeInTheDocument();
  });

  it("7. renders null reconciliation/lock fields as '—', never a fabricated value", async () => {
    getIngestionStatusMock.mockResolvedValue({
      watermarks: [makeWatermark({ last_reconciliation_run_at: null, last_reconciliation_rows_scanned: null, last_reconciliation_rows_changed: null, lock_acquired_at: null })],
    });
    getAiUsageMock.mockResolvedValue({ runs: [makeRun({ finished_at: null, duration_ms: null, platform: null })] });
    renderSystem();
    await screen.findByText("job-abc123");
    // 4 dashes from the watermark row + finished/duration dashes from the run row + platform dash.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(6);
  });

  it("8. renders 401 as the session-expired state on both sections independently", async () => {
    getIngestionStatusMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    getAiUsageMock.mockRejectedValue(new ApiClientError("unauthorized", "no token"));
    renderSystem();
    expect(await screen.findAllByText("Session expired")).toHaveLength(2);
  });

  it("9. renders 403 as the not-permitted state (a real backend denial, distinct from the client-side gate)", async () => {
    getIngestionStatusMock.mockRejectedValue(new ApiClientError("forbidden", "no role"));
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystem();
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
  });

  it("10. renders a generic error for a real 500/network failure", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockRejectedValue(new ApiClientError("server", "boom"));
    renderSystem();
    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
  });

  it("11. retry re-issues the failed request independently per section", async () => {
    getIngestionStatusMock.mockRejectedValueOnce(new ApiClientError("server", "boom"));
    getIngestionStatusMock.mockResolvedValueOnce({ watermarks: [makeWatermark()] });
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystem();
    await screen.findByText("Something went wrong");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("50123");
    expect(getIngestionStatusMock).toHaveBeenCalledTimes(2);
  });

  it("12. an admin can access /system (RequireRole allows it, real content renders)", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystemGated("admin");
    expect(await screen.findByRole("heading", { name: "System / Admin", level: 1 })).toBeInTheDocument();
  });

  it("13. a viewer is denied /system and no admin-only request is ever sent", async () => {
    renderSystemGated("viewer");
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "System / Admin" })).not.toBeInTheDocument();
    expect(getIngestionStatusMock).not.toHaveBeenCalled();
    expect(getAiUsageMock).not.toHaveBeenCalled();
  });

  it("14. an analyst is denied /system and no admin-only request is ever sent", async () => {
    renderSystemGated("analyst");
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
    expect(getIngestionStatusMock).not.toHaveBeenCalled();
    expect(getAiUsageMock).not.toHaveBeenCalled();
  });

  it("unauthenticated (no role at all) access is rejected", async () => {
    renderSystemGated(null);
    expect(await screen.findByText("Not permitted")).toBeInTheDocument();
    expect(getIngestionStatusMock).not.toHaveBeenCalled();
    expect(getAiUsageMock).not.toHaveBeenCalled();
  });

  it("15. requests both endpoints with no query parameters — the real, exact contract", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({ runs: [] });
    renderSystem();
    await waitFor(() => {
      expect(getIngestionStatusMock).toHaveBeenCalledTimes(1);
      expect(getAiUsageMock).toHaveBeenCalledTimes(1);
    });
    // Each is called with exactly one argument (the AbortSignal) — no
    // invented window/platform/other filter parameter.
    expect(getIngestionStatusMock.mock.calls[0]).toHaveLength(1);
    expect(getAiUsageMock.mock.calls[0]).toHaveLength(1);
  });

  it("16. never fabricates a health/cost score or status value not literally present in the response", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [makeWatermark({ status: "idle" })] });
    getAiUsageMock.mockResolvedValue({ runs: [makeRun({ status: "partial_failure" })] });
    renderSystem();
    await screen.findByText("job-abc123");
    // Real literal enum values are shown as-is (case-formatted only)...
    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.getByText("partial failure")).toBeInTheDocument();
    // ...never the unrelated SystemStatusBadge vocabulary, which doesn't
    // correspond to either real backend enum.
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Warning$/)).not.toBeInTheDocument();
    // No fabricated dollar cost figure — the backend response has no cost
    // field at all, only raw counts/durations.
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
  });

  it("17. performs no client-side calculations — every number shown is exactly the backend's", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({ runs: [makeRun({ duration_ms: 123456 })] });
    renderSystem();
    // Raw milliseconds, never converted/derived into seconds or a rate.
    expect(await screen.findByText("123456 ms")).toBeInTheDocument();
  });

  it("18. renders the AI usage table in the exact order the backend already returned (no client re-sort)", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [] });
    getAiUsageMock.mockResolvedValue({
      runs: [makeRun({ id: "run-a", job_id: "job-a", started_at: "2026-01-14T00:00:00.000Z" }), makeRun({ id: "run-b", job_id: "job-b", started_at: "2026-01-15T00:00:00.000Z" })],
    });
    renderSystem();
    await screen.findByText("job-a");
    const rows = screen.getAllByRole("row").slice(1);
    const jobIds = rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent);
    expect(jobIds).toEqual(["job-a", "job-b"]);
  });

  it("does not render any raw bearer token or 'Bearer' string on the page", async () => {
    getIngestionStatusMock.mockResolvedValue({ watermarks: [makeWatermark()] });
    getAiUsageMock.mockResolvedValue({ runs: [makeRun()] });
    renderSystem();
    await screen.findByText("job-abc123");
    expect(document.body.textContent).not.toMatch(/Bearer\s/);
  });
});
