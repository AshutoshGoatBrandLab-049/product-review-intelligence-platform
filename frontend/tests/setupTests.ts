import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest.config.ts sets globals:false (matching the backend's own vitest
// convention), which means Testing Library's automatic per-test cleanup
// (which relies on detecting a global `afterEach`) never registers on its
// own — without this, DOM from one test leaks into the next within the
// same file. Explicit, not implicit.
afterEach(() => {
  cleanup();
});

// jsdom does not implement window.matchMedia — shadcn/ui's sidebar
// (use-mobile.ts) calls it to detect the mobile breakpoint. Minimal,
// standard test-environment polyfill; not used by any real app code path.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom does not implement ResizeObserver — Radix's Popper (used by
// Tooltip/DropdownMenu/Sheet positioning) calls it. Minimal, standard
// test-environment polyfill; not used by any real app code path.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
