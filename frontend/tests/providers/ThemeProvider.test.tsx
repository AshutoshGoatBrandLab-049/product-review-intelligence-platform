import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, useTheme } from "@/providers/ThemeProvider";

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider (Phase 8 Step 1)", () => {
  beforeEach(() => {
    localStorage.removeItem("theme");
    document.documentElement.classList.remove("dark");
  });

  it("1. defaults to 'system' with no stored preference", () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
    // The global test-environment matchMedia polyfill always reports
    // matches:false, so "system" deterministically resolves to "light"
    // here — not a claim about any real OS preference.
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
  });

  it("2. reads a previously stored preference on mount", () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("3. an invalid/unrecognized stored value falls back to 'system', never throws", () => {
    localStorage.setItem("theme", "purple-haze");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme")).toHaveTextContent("system");
  });

  it("4. setTheme('dark') applies the .dark class to <html> and persists to localStorage", async () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "dark" }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
  });

  it("5. setTheme('light') removes the .dark class and persists", async () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "light" }));
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
    expect(localStorage.getItem("theme")).toBe("light");
  });

  it("6. useTheme throws outside ThemeProvider (fails loud, not silently)", () => {
    function Bare() {
      useTheme();
      return null;
    }
    expect(() => render(<Bare />)).toThrow("useTheme must be used within ThemeProvider");
  });
});
