import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Send, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { analyzeProductQuestion } from "@/api/endpoints/analyst";
import { getOrCreateConversation } from "@/api/endpoints/conversation";
import { getEvidenceReviews } from "@/api/endpoints/evidence";
import type { Platform, NamedWindow, ConversationMessage as ConvMsg, ReviewDetail } from "@/types/api";

/**
 * Phase 10 Step 2 — AI Product Analyst with team-shared conversation persistence.
 * Team members select a product and share investigation history via conversations.
 * One conversation per (platform, product, window) — visible to all authorized team members.
 *
 * Phase 10 AI Product Analyst intent/context correction: collapsed to a
 * SINGLE code path. Both typed questions and quick-action buttons now go
 * through the same (now intent-branching) analyzeProductQuestion() call,
 * passing conversationId so ambiguous follow-ups resolve against real
 * prior-turn state. The server owns ALL natural-language -> intent/filter
 * derivation now — the regex-based handleExploreReviews() NLU that used to
 * live here (duplicating and diverging from the backend classifier) has
 * been removed.
 */

interface LocalMessage extends ConvMsg {
  loadingReviews?: boolean;
  evidenceReviews?: ReviewDetail[];
  explorationReviews?: ReviewDetail[];
  needsClarification?: boolean;
}

export default function AIProductAnalyst() {
  const [searchParams] = useSearchParams();
  const [platform, setPlatform] = useState<Platform>((searchParams.get("platform") as Platform) || "flipkart");
  const [productId, setProductId] = useState(searchParams.get("productId") || "");
  const [window, setWindow] = useState<NamedWindow>("30d");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load team-shared conversation on product/window change
  useEffect(() => {
    const loadConversation = async () => {
      if (!productId.trim()) {
        setMessages([]);
        setConversationId(undefined);
        return;
      }

      try {
        // Fetch team-shared conversation for this product/window
        const conv = await getOrCreateConversation(platform, productId, window);
        setConversationId(conv.id);
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


  const handleAnalyze = async (overrideQuestion?: string) => {
    const effectiveQuestion = overrideQuestion ?? question;
    if (!effectiveQuestion.trim() || !productId.trim()) {
      setError("Please enter both a product ID and a question.");
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const userMessage: ConvMsg = {
        role: "user",
        content: effectiveQuestion,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
      setQuestion("");

      const response = await analyzeProductQuestion(platform, productId, effectiveQuestion, window, conversationId);

      // Clarification: server judged the question too ambiguous even with
      // conversation context — render plainly, no fabricated analysis.
      if (response.needsClarification) {
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: response.clarificationPrompt ?? response.answer,
            timestamp: new Date().toISOString(),
            needsClarification: true,
          },
        ]);
        return;
      }

      // RETRIEVAL response: real DB-backed reviews, rendered directly —
      // never routed through the narrator/evidence-linking path.
      if (response.reviews) {
        setMessages((prev) => [
          ...prev,
          {
            role: "ai",
            content: response.answer,
            timestamp: new Date().toISOString(),
            explorationReviews: response.reviews,
          },
        ]);
        return;
      }

      // ANALYSIS response: existing FLOW A evidence-linking rendering.
      const aiMessage: LocalMessage = {
        role: "ai",
        content: response.answer,
        timestamp: new Date().toISOString(),
        analysis: response.analysis ?? undefined,
        loadingReviews: true,
      };
      setMessages((prev) => [...prev, aiMessage]);

      const evidenceIds = response.analysis
        ? response.analysis.rootCause
            .flatMap((rc: any) => rc.evidenceReviewIds)
            .concat(response.analysis.recommendations.flatMap((r: any) => r.evidenceReviewIds))
        : [];

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
                onClick={() => handleAnalyze()}
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

            {/* Quick Actions — all go through the single analyzeProductQuestion
                path now; the server resolves retrieval vs analysis intent. */}
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Quick investigation requests:</p>
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {[
                  "What's wrong with this product?",
                  "Show me the latest 20 reviews",
                  "Show me negative reviews",
                  "Show me bad reviews",
                  "What are customers complaining about?",
                  "Show me 1-star reviews",
                  "What's the biggest issue?",
                ].map((q, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => handleAnalyze(q)}
                    disabled={loading}
                    className="text-xs"
                  >
                    {q}
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
