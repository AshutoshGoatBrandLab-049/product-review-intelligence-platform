import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CircleCheck } from "lucide-react";
import { StatusBadge } from "@/components/intelligence/StatusBadge";

describe("StatusBadge (Phase 8 Step 1 — shared badge primitive)", () => {
  it("1. renders the exact label text passed in, never a tone-derived label", () => {
    render(<StatusBadge tone="success" icon={CircleCheck} label="High confidence" />);
    expect(screen.getByText("High confidence")).toBeInTheDocument();
  });

  it("2. applies token-based classes for each tone, never a hardcoded literal Tailwind color", () => {
    const { container } = render(<StatusBadge tone="warning" icon={CircleCheck} label="Marketplace-specific" />);
    const span = container.querySelector("span")!;
    expect(span.className).toContain("bg-warning-bg");
    expect(span.className).toContain("text-warning-fg");
    expect(span.className).toContain("border-warning-border");
    expect(span.className).not.toMatch(/amber-|emerald-|slate-|orange-|red-/);
  });

  it("3. every tone renders without crashing and pairs an icon with the text label (never color-only)", () => {
    const tones = ["success", "warning", "info", "neutral", "danger"] as const;
    for (const tone of tones) {
      const { container, unmount } = render(<StatusBadge tone={tone} icon={CircleCheck} label={`label-${tone}`} />);
      expect(screen.getByText(`label-${tone}`)).toBeInTheDocument();
      expect(container.querySelector("svg")).toBeInTheDocument();
      unmount();
    }
  });
});
