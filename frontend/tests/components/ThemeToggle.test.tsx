import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ThemeToggle } from "@/components/layout/ThemeToggle";

function renderToggle() {
  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle (Phase 8 Step 1)", () => {
  beforeEach(() => {
    localStorage.removeItem("theme");
    document.documentElement.classList.remove("dark");
  });

  it("1. renders an accessible, labeled trigger button", () => {
    renderToggle();
    expect(screen.getByRole("button", { name: "Change theme" })).toBeInTheDocument();
  });

  it("2. opens a menu with all three real options: Light, Dark, System", async () => {
    renderToggle();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    expect(await screen.findByRole("menuitemradio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /System/ })).toBeInTheDocument();
  });

  it("3. selecting Dark applies the .dark class and persists the choice", async () => {
    renderToggle();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change theme" }));
    await user.click(await screen.findByRole("menuitemradio", { name: "Dark" }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("4. is keyboard-operable — Tab reaches the trigger, Enter opens the menu", async () => {
    renderToggle();
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Change theme" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("menuitemradio", { name: "Light" })).toBeInTheDocument();
  });
});
