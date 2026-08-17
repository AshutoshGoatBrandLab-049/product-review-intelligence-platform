import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/**
 * Phase 8 Step 7 — Marketplace brand selector. Exact-name lookup only.
 * No brand-listing endpoint exists (§21.1 of Phase 8 architecture) — a
 * user must know or guess a brand name and type it. This is honest UX:
 * the page doesn't pretend to offer search when search infrastructure
 * doesn't exist in the backend. No autocomplete, no suggestions, no fuzzy
 * matching — only exact-match navigation to /marketplace/brands/:brand.
 */
export function BrandsIndex() {
  const navigate = useNavigate();
  const [input, setInput] = useState("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (trimmed) {
      navigate(`/marketplace/brands/${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Marketplace Comparison</h1>
        <p className="text-sm text-muted-foreground">Enter a brand name to compare its performance across Flipkart and Myntra.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Brand Lookup</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="flex gap-2">
              <Input
                type="text"
                placeholder="Enter brand name (e.g., Bluepeak, Levi's)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Brand name"
              />
              <Button type="submit" size="sm" disabled={!input.trim()}>
                <Search className="size-4" />
                <span className="hidden sm:inline ml-2">Compare</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Enter the exact brand name to compare metrics. No partial matches or suggestions are available.
            </p>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3 rounded-lg border border-dashed p-6">
        <p className="text-sm font-medium">About this tool</p>
        <ul className="space-y-2 text-xs text-muted-foreground">
          <li>• Compare a brand's performance across Flipkart and Myntra</li>
          <li>• View rating gaps, sentiment trends, and theme consistency</li>
          <li>• Exact brand names only — no partial search available</li>
          <li>• Select a time window to filter results</li>
        </ul>
      </div>
    </div>
  );
}
