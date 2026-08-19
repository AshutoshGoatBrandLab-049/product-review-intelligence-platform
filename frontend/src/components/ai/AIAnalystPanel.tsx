import { useState, useRef, useEffect } from "react";
import { Send, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { analyzeProductQuestion } from "@/api/endpoints/analyst";
import { getOrCreateConversation } from "@/api/endpoints/conversation";
import { getEvidenceReviews } from "@/api/endpoints/evidence";
import type { Platform, ConversationMessage as ConvMsg, ReviewDetail } from "@/types/api";

interface LocalMessage extends ConvMsg {
  loadingReviews?: boolean;
  evidenceReviews?: ReviewDetail[];
  explorationReviews?: ReviewDetail[];
  needsClarification?: boolean;
}

interface AIAnalystPanelProps {
  platform: Platform;
  productId: string;
  showProductSelection?: boolean;
  compact?: boolean;
}

export function AIAnalystPanel({
  platform: initialPlatform,
  productId: initialProductId,
  showProductSelection = false,
  compact = false,
}: AIAnalystPanelProps) {
  const [platform, setPlatform] = useState<Platform>(initialPlatform);
  const [productId, setProductId] = useState(initialProductId);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load team-shared conversation on product change
  useEffect(() => {
    const loadConversation = async () => {
      if (!productId.trim()) {
        setMessages([]);
        setConversationId(undefined);
        return;
      }

      try {
        const conv = await getOrCreateConversation(platform, productId);
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
  }, [platform, productId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (messagesEndRef.current && typeof messagesEndRef.current.scrollIntoView === "function") {
        try {
          messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
        } catch (e) {
          // Fallback for environments where scrollIntoView isn't available
        }
      }
    }, 100);
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

      const response = await analyzeProductQuestion(platform, productId, effectiveQuestion, undefined, conversationId);

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
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {/* Product Selection (optional, shown only if enabled) */}
      {showProductSelection && (
        <Card>
          <CardHeader className={compact ? "pb-3" : ""}>
            <CardTitle className="text-sm">Select Product</CardTitle>
          </CardHeader>
          <CardContent className={compact ? "space-y-3" : "space-y-4"}>
            <div className="grid gap-4 md:grid-cols-2">
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
            </div>
            {isProductSelected && (
              <p className="text-xs text-muted-foreground">
                Analyzing: <strong>{platform} / {productId}</strong>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Conversation Area */}
      {isProductSelected && (
        <>
          <Card className="flex flex-col">
            <CardHeader className={compact ? "pb-3" : ""}>
              <CardTitle className="text-sm">Conversation</CardTitle>
            </CardHeader>
            <CardContent
              className={`flex-1 overflow-y-auto space-y-3 ${
                compact ? "min-h-64" : "min-h-96"
              }`}
            >
              {messages.length === 0 && (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground text-center">
                    {compact
                      ? "Ask a question about this product"
                      : "Start team investigation by asking a question or exploring reviews"}
                  </p>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className="space-y-2 animate-in fade-in duration-300">
                  <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-sm rounded-lg px-3 py-2 text-xs ${
                        compact
                          ? msg.role === "user"
                            ? "bg-violet-600 text-white"
                            : "bg-muted text-foreground border border-border"
                          : msg.role === "user"
                            ? "max-w-2xl rounded-lg px-4 py-2 text-sm bg-violet-600 text-white"
                            : "max-w-2xl rounded-lg px-4 py-2 text-sm bg-muted text-foreground border border-border"
                      }`}
                    >
                      <p className="break-words">{msg.content}</p>
                    </div>
                  </div>

                  {msg.role === "ai" && msg.evidenceReviews && msg.evidenceReviews.length > 0 && (
                    <div className={compact ? "ml-2 space-y-1" : "ml-4 space-y-2"}>
                      <p className="text-xs font-medium text-muted-foreground">Supporting Reviews:</p>
                      <div className={`space-y-2 max-h-64 overflow-y-auto`}>
                        {msg.evidenceReviews.map((review) => (
                          <div key={review.canonicalReviewId} className="border rounded p-1.5 bg-background text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1">
                                <div className="font-medium text-xs">{review.author || "Anonymous"}</div>
                                <div className="text-muted-foreground text-xs">★ {review.rating}</div>
                                {review.title && <div className="font-medium text-xs mt-0.5">{review.title}</div>}
                              </div>
                              {review.themes.length > 0 && (
                                <div className="flex gap-0.5 flex-wrap justify-end">
                                  {review.themes.map((t) => (
                                    <span
                                      key={t.theme}
                                      className="bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded text-xs"
                                    >
                                      {t.theme}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {review.reviewText && (
                              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                                {review.reviewText}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.role === "ai" && msg.explorationReviews && msg.explorationReviews.length > 0 && (
                    <div className={compact ? "ml-2 space-y-1" : "ml-4 space-y-2"}>
                      <p className="text-xs font-medium text-muted-foreground">Reviews:</p>
                      <div className={`space-y-2 max-h-64 overflow-y-auto`}>
                        {msg.explorationReviews.map((review) => (
                          <div key={review.canonicalReviewId} className="border rounded p-1.5 bg-background text-xs">
                            <div className="flex justify-between items-start gap-2">
                              <div className="flex-1">
                                <div className="font-medium text-xs">{review.author || "Anonymous"}</div>
                                <div className="text-muted-foreground text-xs">
                                  ★ {review.rating} • {review.reviewDate}
                                </div>
                                {review.title && <div className="font-medium text-xs mt-0.5">{review.title}</div>}
                              </div>
                            </div>
                            {review.reviewText && (
                              <p className="text-muted-foreground mt-1 line-clamp-3 text-xs">
                                {review.reviewText}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {msg.loadingReviews && (
                    <div className={`ml-2 flex gap-2 items-center text-xs text-muted-foreground`}>
                      <Loader2 className="size-3 animate-spin" />
                      Loading reviews...
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-lg bg-muted px-3 py-2 border border-border">
                    <Loader2 className="size-4 animate-spin text-violet-600" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </CardContent>
          </Card>

          {error && (
            <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <AlertCircle className="size-4 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Input Area */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input
                placeholder="Ask about this product or explore reviews..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyPress={handleKeyPress}
                disabled={loading}
                className="flex-1 text-sm"
              />
              <Button
                onClick={() => handleAnalyze()}
                disabled={loading || !question.trim()}
                className="bg-violet-600 hover:bg-violet-700"
                size={compact ? "sm" : "default"}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <Send className="size-4" />
                    {!compact && <span className="ml-2">Ask</span>}
                  </>
                )}
              </Button>
            </div>

            {/* Quick Actions */}
            {!compact && (
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
            )}
          </div>
        </>
      )}
    </div>
  );
}
