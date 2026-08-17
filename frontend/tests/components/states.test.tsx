import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingState } from "@/components/states/LoadingState";
import { ErrorState } from "@/components/states/ErrorState";
import { EmptyState } from "@/components/states/EmptyState";
import { InsufficientDataState } from "@/components/states/InsufficientDataState";
import { NotReadyState } from "@/components/states/NotReadyState";
import { NoMappingState } from "@/components/states/NoMappingState";
import { ApiClientError } from "@/api/errors";

describe("Generic state components (Phase 7 Step 1, §13/§16)", () => {
  it("LoadingState announces itself to assistive tech via aria-busy", () => {
    const { container } = render(<LoadingState />);
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("EmptyState renders a title, never implies an error", () => {
    render(<EmptyState title="No products match these filters" />);
    expect(screen.getByText("No products match these filters")).toBeInTheDocument();
  });

  it("InsufficientDataState renders the exact honest message, never a fabricated zero", () => {
    render(<InsufficientDataState />);
    expect(screen.getByText("Not enough review data to make a reliable assessment.")).toBeInTheDocument();
  });

  it("NotReadyState renders the exact honest message for a permanently stubbed signal", () => {
    render(<NotReadyState />);
    expect(screen.getByText("Not available yet — this signal is not currently implemented.")).toBeInTheDocument();
  });

  it("NoMappingState renders the exact honest message for an unmapped product", () => {
    render(<NoMappingState />);
    expect(screen.getByText("This product is not linked to a corresponding product on the other marketplace.")).toBeInTheDocument();
  });

  it("ErrorState renders a distinct message per real ApiClientError kind — unauthorized", () => {
    render(<ErrorState error={new ApiClientError("unauthorized", "no token")} />);
    expect(screen.getByText("Session expired")).toBeInTheDocument();
  });

  it("ErrorState renders a distinct message for kind forbidden (never the same copy as unauthorized)", () => {
    render(<ErrorState error={new ApiClientError("forbidden", "no role")} />);
    expect(screen.getByText("Not permitted")).toBeInTheDocument();
  });

  it("ErrorState renders a distinct message for kind rate_limited", () => {
    render(<ErrorState error={new ApiClientError("rate_limited", "slow down")} />);
    expect(screen.getByText("Too many requests")).toBeInTheDocument();
  });

  it("ErrorState renders a distinct message for kind network", () => {
    render(<ErrorState error={new ApiClientError("network", "offline")} />);
    expect(screen.getByText("Can't reach the API")).toBeInTheDocument();
  });

  it("ErrorState falls back to a generic message for an error that isn't an ApiClientError", () => {
    render(<ErrorState error={new Error("boom")} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });
});
