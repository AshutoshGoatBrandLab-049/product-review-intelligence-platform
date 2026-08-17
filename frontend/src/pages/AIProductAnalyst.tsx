import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Send, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { analyzeProductQuestion } from "@/api/endpoints/analyst";
import { getOrCreateConversation } from "@/api/endpoints/conversation";
import { getProductReviews } from "@/api/endpoints/reviews";
import { getEvidenceReviews } from "@/api/endpoints/evidence";
import type { Platform, NamedWindow, ConversationMessage as ConvMsg, ReviewDetail } from "@/types/api";

/**
 * Phase 10 Step 2 — AI Product Analyst with team-shared conversation persistence.
 * Team members select a product and share investigation history via conversations.
 * One conversation per (platform, product, window) — visible to all authorized team members.
 * Supports both FLOW A (AI evidence linking) and FLOW B (review exploration).
 */

interface LocalMessage extends ConvMsg {
  loadingReviews?: boolean;
  evidenceReviews?: ReviewDetail[];
  explorationReviews?: ReviewDetail[];
}

export default function AIProductAnalyst() {
  const [searchParams] = useSearchParams();
  const [platform, setPlatform] = useState<Platform>((searchParams.get("platform") as Platform) || "flipkart");
  const [productId, setProductId] = useState(searchParams.get("productId") || "");
  const [window, setWindow] = useState<NamedWindow>("30d");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load team-shared conversation on product/window change
  useEffect(() => {
    const loadConversation = async () => {
      if (!productId.trim()) {
        setMessages([]);
        return;
      }

      try {
        // Fetch team-shared conversation for this product/window
        const conv = await getOrCreateConversation(platform, productId, window);
        setMessages(
          conv.messages.map((m) => ({
            ...m,
            timestamp: new Date(m.timestamp).toISOString(),
          })),
        );
      } catch (err) {
        console.error("Failed to load investigation history:", err);
        setError("Failed to load investigation history");
      }
    };

    loadConversation();
  }, [platform, productId, window]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);


  const handleAnalyze = async () => {
    if (!question.trim() || !productId.trim()) {
      setError("Please enter both a product ID and a question.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const userMessage: ConvMsg = {
        role: "user",
        content: question,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setQuestion("");

      const response = await analyzeProductQuestion(platform, productId, question, window);

      const aiMessage: LocalMessage = {
        role: "ai",
        content: response.answer,
        timestamp: new Date().toISOString(),
        analysis: response.analysis,
        loadingReviews: true,
      };
      setMessages((prev) => [...prev, aiMessage]);

      // FLOW A: Fetch evidence reviews if AI cited any IDs
      const evidenceIds = response.analysis.rootCause.flatMap((rc: any) => rc.evidenceReviewIds).concat(
        response.analysis.recommendations.flatMap((r: any) => r.evidenceReviewIds),
      );

      if (evidenceIds.length > 0) {
        try {
          const reviewsResp = await getEvidenceReviews(evidenceIds);
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 1
                ? { ...m, evidenceReviews: reviewsResp.reviews, loadingReviews: false }
                : m,
            ),
          );
        } catch (err) {
          console.error("Failed to load evidence reviews:", err);
          setMessages((prev) =>
            prev.map((m, i) => (i === prev.length - 1 ? { ...m, loadingReviews: false } : m)),
          );
        }
      } else {
        setMessages((prev) =>
          prev.map((m, i) => (i === prev.length - 1 ? { ...m, loadingReviews: false } : m)),
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to analyze product";
      setError(errorMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: `Error: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Handle review exploration requests
  const handleExploreReviews = async (exploreQuestion: string) => {
    console.log("handleExploreReviews called with:", exploreQuestion);
    if (!productId.trim()) {
      setError("Please select a product first");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // For now, we're adding to local state only
      // Note: Persistence to conversation table would require a PUT/POST endpoint
      // which is out of scope for Phase 10 Step 2 (read-only endpoints only per Phase 6)
      const userMessage: LocalMessage = {
        role: "user",
        content: exploreQuestion,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Semantic analysis: Extract meaning from natural language using regex patterns
      const q = exploreQuestion.toLowerCase();
      const params: ReviewsParams = {};

      // Extract count: "latest 20", "top 5", "show me 10", etc.
      const countMatch = q.match(/(\d+)\s*(reviews?|reviews?)/i) || q.match(/(?:latest|top|get|show me)\s+(\d+)/i);
      if (countMatch) {
        params.limit = Math.min(parseInt(countMatch[1]), 100);
      } else if (q.includes("latest") || q.includes("recent") || q.includes("newest")) {
        params.limit = 20;
      }

      // Extract rating: "1-star", "1 star", "1 star", etc.
      const ratingMatch = q.match(/(\d)\s*-?\s*star/i);
      if (ratingMatch) {
        params.rating = parseInt(ratingMatch[1]);
      }

      // Extract sentiment using semantic keyword matching (handles ANY related word)
      // Negative indicators: bad, poor, terrible, awful, hate, complain, issue, problem, broken, useless, disappointing, crash, faulty, malfunction, etc.
      const negativeKeywords = /\b(bad|poor|terrible|awful|horrible|hate|hated|complain|complaint|issue|issues|problem|problems|broken|useless|waste|disappointed|disappointing|wrong|worse|worst|concern|concerns|negative|unhappy|unsatisfied|defect|defective|crash|crashed|faulty|fail|failed|malfunction|bug|bugs|bugged|error|errors|failure|failures|fail|failed)\b/i;

      // Positive indicators: good, great, excellent, love, amazing, perfect, wonderful, fantastic, awesome, satisfied, etc.
      const positiveKeywords = /\b(good|great|excellent|love|loved|amazing|perfect|wonderful|fantastic|awesome|impressed|satisfying|satisfied|happy|happiest|best|better|impressive|impressed|amazing|reliable|quality|worth|valuable|excellent|superb|outstanding|brilliant|nice|lovely)\b/i;

      if (negativeKeywords.test(exploreQuestion)) {
        params.sentiment = "negative";
      } else if (positiveKeywords.test(exploreQuestion)) {
        params.sentiment = "positive";
      } else if (q.includes("neutral")) {
        params.sentiment = "neutral";
      }

      // Extract theme: quality, packaging, delivery, size, fit, comfort, color, durability, value, material
      const themes = ["quality", "packaging", "delivery", "size", "fit", "comfort", "color", "durability", "value", "material", "product_mismatch"];
      for (const theme of themes) {
        if (q.includes(theme)) {
          params.theme = theme;
          break;
        }
      }

      console.log("Parsed parameters:", { ...params, window });

      const reviewsResp = await getProductReviews(platform, productId, { window, ...params });
      console.log("getProductReviews response:", reviewsResp);

      const exploreMessage: LocalMessage = {
        role: "ai",
        content: `Found ${reviewsResp.count} review${reviewsResp.count !== 1 ? "s" : ""} matching your request.`,
        timestamp: new Date().toISOString(),
        explorationReviews: reviewsResp.reviews,
      };
      console.log("Setting exploration message with reviews:", reviewsResp.reviews);
      setMessages((prev) => [...prev, exploreMessage]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to retrieve reviews";
      console.error("handleExploreReviews error:", err);
      setError(errorMessage);
      setMessages((prev) => [
        ...prev,
        {
          role: "ai",
          content: `Error: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !loading) {
      e.preventDefault();
      handleAnalyze();
    }
  };

  const isProductSelected = productId.trim().length > 0;

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <Sparkles className="size-5 text-violet-600" />
          <h1 className="text-2xl font-bold">AI Product Analyst</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Team investigation workspace. All authorized team members see the same product analysis and reviews.
        </p>
      </div>

      {/* Product Selection Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Select Product</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Marketplace</label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as Platform)}
                disabled={loading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="flipkart">Flipkart</option>
                <option value="myntra">Myntra</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Product ID</label>
              <Input
                placeholder="e.g., FKPID000001"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Time Window</label>
              <select
                value={window}
                onChange={(e) => setWindow(e.target.value as NamedWindow)}
                disabled={loading}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="60d">Last 60 days</option>
                <option value="90d">Last 90 days</option>
                <option value="6m">Last 6 months</option>
                <option value="12m">Last year</option>
              </select>
            </div>
          </div>
          {isProductSelected && (
            <p className="text-xs text-muted-foreground">
              Analyzing: <strong>{platform} / {productId}</strong>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Conversation Area */}
      {isProductSelected && (
        <>
          <Card className="flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm">Conversation</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-4 min-h-96">
              {messages.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center">
                    Start team investigation by asking a question or exploring reviews
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className="space-y-2">
                  {/* Message bubble */}
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-2xl rounded-lg px-4 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-violet-600 text-white"
                          : "bg-muted text-foreground border border-border"
                      }`}
                    >
                      <p className="break-words">{msg.content}</p>
                    </div>
                  </div>

                  {/* Evidence reviews (FLOW A) */}
                  {msg.role === "ai" && msg.evidenceReviews && msg.evidenceReviews.length > 0 && (
                    <div className="ml-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Supporting Reviews:</p>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {msg.evidenceReviews.map((review) => (
                          <div key={review.canonicalReviewId} className="border rounded p-2 bg-background text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1">
                                <div className="font-medium">{review.author || "Anonymous"}</div>
                                <div className="text-muted-foreground">★ {review.rating}</div>
                                {review.title && <div className="font-medium text-sm mt-1">{review.title}</div>}
                              </div>
                              {review.themes.length > 0 && (
                                <div className="flex gap-1 flex-wrap justify-end">
                                  {review.themes.map((t) => (
                                    <span key={t.theme} className="bg-violet-100 text-violet-800 px-2 py-1 rounded">
                                      {t.theme}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {review.reviewText && (
                              <p className="text-muted-foreground mt-2 line-clamp-2">{review.reviewText}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Exploration reviews (FLOW B) */}
                  {msg.role === "ai" && msg.explorationReviews && msg.explorationReviews.length > 0 && (
                    <div className="ml-4 space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">Reviews:</p>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {msg.explorationReviews.map((review) => (
                          <div key={review.canonicalReviewId} className="border rounded p-2 bg-background text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1">
                                <div className="font-medium">{review.author || "Anonymous"}</div>
                                <div className="text-muted-foreground">★ {review.rating} • {review.reviewDate}</div>
                                {review.title && <div className="font-medium text-sm mt-1">{review.title}</div>}
                              </div>
                            </div>
                            {review.reviewText && (
                              <p className="text-muted-foreground mt-2 line-clamp-3">{review.reviewText}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Loading indicator for reviews */}
                  {msg.loadingReviews && (
                    <div className="ml-4 flex gap-2 items-center text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Loading reviews...
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-muted px-4 py-2 border border-border">
                    <Loader2 className="size-4 animate-spin text-violet-600" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </CardContent>
          </Card>

          {/* Error Message */}
          {error && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="size-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Input Area */}
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Ask about this product or explore reviews..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                className="flex-1"
              />
              <Button
                onClick={handleAnalyze}
                disabled={loading || !question.trim()}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Send className="size-4" />
                    <span className="ml-2">Ask</span>
                  </>
                )}
              </Button>
            </div>

            {/* Quick Actions */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Quick investigation requests:</p>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {[
                  { q: "What's wrong with this product?", explore: false },
                  { q: "Show me the latest 20 reviews", explore: true },
                  { q: "Show me negative reviews", explore: true },
                  { q: "Show me bad reviews", explore: true },
                  { q: "What are customers complaining about?", explore: false },
                  { q: "Show me 1-star reviews", explore: true },
                  { q: "What's the biggest issue?", explore: false },
                ].map((item, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => (item.explore ? handleExploreReviews(item.q) : setQuestion(item.q))}
                    disabled={loading}
                    className="text-xs"
                  >
                    {item.q}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
