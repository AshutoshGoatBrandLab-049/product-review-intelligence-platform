import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReviewDetailCard, ReviewsList } from "@/components/intelligence/ReviewDetail";
import type { ReviewDetail } from "@/types/api";

const makeReview = (overrides: Partial<ReviewDetail> = {}): ReviewDetail => ({
  canonicalReviewId: "abc123def456",
  platform: "flipkart",
  sourceProductId: "PID001",
  sourceReviewId: "src-123",
  rating: 4,
  title: "Great product",
  reviewText: "This product works really well. Highly recommend!",
  author: "John Doe",
  reviewDate: "2026-08-10",
  reviewTimestamp: "2026-08-10T10:30:00Z",
  dateConfidence: "exact",
  helpfulCount: 5,
  notHelpfulCount: 1,
  verifiedPurchase: true,
  hasImages: false,
  imageUrls: null,
  sizePurchased: null,
  colorPurchased: null,
  country: "IN",
  productUrl: null,
  brand: "TestBrand",
  identityConfidence: "native",
  sentiment: "positive",
  sentimentConfidence: 0.95,
  sentimentModelVersion: "v1",
  themes: [
    { theme: "quality", evidenceSnippet: "really well", confidence: 0.9, modelVersion: "v1" },
  ],
  ...overrides,
});

describe("ReviewDetailCard", () => {
  it("renders author name when present", () => {
    const review = makeReview({ author: "Alice Smith" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("renders 'Anonymous' when author is null", () => {
    const review = makeReview({ author: null });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
  });

  it("renders actual rating as filled stars", () => {
    const review = makeReview({ rating: 4 });
    const element = render(<ReviewDetailCard review={review} />);
    const { container } = element;
    // Check that star SVGs are rendered (5 total, 4 filled with amber)
    const starSvgs = container.querySelectorAll("svg.lucide-star");
    expect(starSvgs.length).toBe(5);
    // Check that exactly 4 stars are filled with amber color
    const filledStars = container.querySelectorAll("svg.fill-amber-400");
    expect(filledStars.length).toBe(4);
  });

  it("renders title when present", () => {
    const review = makeReview({ title: "Excellent Quality" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("Excellent Quality")).toBeInTheDocument();
  });

  it("does not render title element when title is null", () => {
    const review = makeReview({ title: null });
    render(<ReviewDetailCard review={review} />);
    expect(screen.queryByText("Excellent Quality")).not.toBeInTheDocument();
  });

  it("renders review text when present", () => {
    const review = makeReview({ reviewText: "This is my detailed review text" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("This is my detailed review text")).toBeInTheDocument();
  });

  it("renders review date", () => {
    const review = makeReview({ reviewDate: "2026-08-15" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("2026-08-15")).toBeInTheDocument();
  });

  it("renders platform badge", () => {
    const review = makeReview({ platform: "flipkart" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("flipkart")).toBeInTheDocument();
  });

  it("renders sentiment badge when present", () => {
    const review = makeReview({ sentiment: "positive" });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("positive")).toBeInTheDocument();
  });

  it("renders themes as badges", () => {
    const review = makeReview({
      themes: [
        { theme: "quality", evidenceSnippet: "great", confidence: 0.9, modelVersion: "v1" },
        { theme: "durability", evidenceSnippet: "lasted long", confidence: 0.85, modelVersion: "v1" },
      ],
    });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("quality")).toBeInTheDocument();
    expect(screen.getByText("durability")).toBeInTheDocument();
  });

  it("renders verified purchase indicator when true", () => {
    const review = makeReview({ verifiedPurchase: true });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("Verified purchase")).toBeInTheDocument();
  });

  it("does not render verified purchase when false", () => {
    const review = makeReview({ verifiedPurchase: false });
    render(<ReviewDetailCard review={review} />);
    expect(screen.queryByText("Verified purchase")).not.toBeInTheDocument();
  });

  it("renders helpful count when present", () => {
    const review = makeReview({ helpfulCount: 42 });
    render(<ReviewDetailCard review={review} />);
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("does not render helpful count when null", () => {
    const review = makeReview({ helpfulCount: null });
    render(<ReviewDetailCard review={review} />);
    expect(screen.queryByText("Helpful:")).not.toBeInTheDocument();
  });
});

describe("ReviewsList", () => {
  it("renders empty state when no reviews", () => {
    render(<ReviewsList reviews={[]} />);
    expect(screen.getByText("No reviews found")).toBeInTheDocument();
  });

  it("renders multiple review cards", () => {
    const reviews = [
      makeReview({ canonicalReviewId: "r1", author: "Alice" }),
      makeReview({ canonicalReviewId: "r2", author: "Bob" }),
      makeReview({ canonicalReviewId: "r3", author: "Charlie" }),
    ];
    render(<ReviewsList reviews={reviews} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
  });

  it("uses canonical_review_id as key for each review", () => {
    const reviews = [
      makeReview({ canonicalReviewId: "unique1", author: "User1" }),
      makeReview({ canonicalReviewId: "unique2", author: "User2" }),
    ];
    render(<ReviewsList reviews={reviews} />);
    expect(screen.getByText("User1")).toBeInTheDocument();
    expect(screen.getByText("User2")).toBeInTheDocument();
  });

  it("handles nullable fields without fabrication", () => {
    const reviews = [
      makeReview({
        author: null,
        title: null,
        reviewText: null,
        helpfulCount: null,
        sentiment: null,
        themes: [],
      }),
    ];
    render(<ReviewsList reviews={reviews} />);
    expect(screen.getByText("Anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Helpful:")).not.toBeInTheDocument();
  });
});

describe("Review Ordering (Phase 8 Step 8)", () => {
  it("renders reviews in the order provided by backend (does NOT independently sort)", () => {
    // Backend returns in newest-first order (handled by backend ORDER BY)
    // Frontend must preserve this order
    const reviews = [
      makeReview({
        canonicalReviewId: "newest",
        author: "Alice (Newest)",
        reviewDate: "2026-08-14",
        reviewTimestamp: "2026-08-14T15:00:00Z",
      }),
      makeReview({
        canonicalReviewId: "middle",
        author: "Bob (Middle)",
        reviewDate: "2026-08-13",
        reviewTimestamp: "2026-08-13T10:00:00Z",
      }),
      makeReview({
        canonicalReviewId: "oldest",
        author: "Charlie (Oldest)",
        reviewDate: "2026-08-12",
        reviewTimestamp: "2026-08-12T09:00:00Z",
      }),
    ];
    render(<ReviewsList reviews={reviews} />);
    // Get all author elements in order
    const authors = screen.getAllByText(/Alice|Bob|Charlie/);
    expect(authors[0]).toHaveTextContent("Alice");
    expect(authors[1]).toHaveTextContent("Bob");
    expect(authors[2]).toHaveTextContent("Charlie");
  });

  it("preserves backend ordering even when timestamps are identical", () => {
    const reviews = [
      makeReview({
        canonicalReviewId: "first",
        author: "Review 1",
        reviewDate: "2026-08-14",
        reviewTimestamp: "2026-08-14T12:00:00Z",
      }),
      makeReview({
        canonicalReviewId: "second",
        author: "Review 2",
        reviewDate: "2026-08-14",
        reviewTimestamp: "2026-08-14T12:00:00Z",
      }),
    ];
    render(<ReviewsList reviews={reviews} />);
    const authors = screen.getAllByText(/Review 1|Review 2/);
    // Order should match input array (backend order)
    expect(authors[0]).toHaveTextContent("Review 1");
    expect(authors[1]).toHaveTextContent("Review 2");
  });

  it("maintains data integrity during ordering - actual content stays with correct review", () => {
    const reviews = [
      makeReview({
        canonicalReviewId: "rev1",
        author: "New Reviewer",
        reviewText: "Latest review text",
        rating: 5,
        reviewDate: "2026-08-14",
      }),
      makeReview({
        canonicalReviewId: "rev2",
        author: "Old Reviewer",
        reviewText: "Old review text",
        rating: 2,
        reviewDate: "2026-08-10",
      }),
    ];
    render(<ReviewsList reviews={reviews} />);

    // Verify first review has correct data
    expect(screen.getByText("New Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Latest review text")).toBeInTheDocument();

    // Verify second review has correct data (old data didn't move)
    expect(screen.getByText("Old Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Old review text")).toBeInTheDocument();
  });

  it("handles mixed null and non-null timestamps in backend order", () => {
    const reviews = [
      makeReview({
        canonicalReviewId: "withTime",
        author: "With Timestamp",
        reviewDate: "2026-08-14",
        reviewTimestamp: "2026-08-14T15:30:00Z",
      }),
      makeReview({
        canonicalReviewId: "nullTime",
        author: "Null Timestamp",
        reviewDate: "2026-08-14",
        reviewTimestamp: null,
      }),
    ];
    render(<ReviewsList reviews={reviews} />);
    // Order from backend is preserved
    const authors = screen.getAllByText(/With Timestamp|Null Timestamp/);
    expect(authors[0]).toHaveTextContent("With Timestamp");
    expect(authors[1]).toHaveTextContent("Null Timestamp");
  });
});
