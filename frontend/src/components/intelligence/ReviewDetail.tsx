import { Star, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReviewDetail } from "@/types/api";

interface ReviewDetailProps {
  review: ReviewDetail;
}

export function ReviewDetailCard({ review }: ReviewDetailProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{review.author || "Anonymous"}</span>
              <Badge variant="outline" className="text-xs capitalize">
                {review.platform}
              </Badge>
            </div>
            {review.title && <p className="mt-1 text-xs text-muted-foreground italic">{review.title}</p>}
          </div>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`size-4 ${i < review.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
              />
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {review.reviewText && <p className="whitespace-pre-wrap text-sm leading-relaxed">{review.reviewText}</p>}

        <div className="grid gap-3 border-t pt-3 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Review date:</span>
            <span>{review.reviewDate}</span>
          </div>

          {review.sentiment && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sentiment:</span>
              <Badge variant="secondary" className="capitalize">
                {review.sentiment}
              </Badge>
            </div>
          )}

          {review.themes.length > 0 && (
            <div>
              <span className="text-muted-foreground">Themes:</span>
              <div className="mt-1 flex flex-wrap gap-1">
                {review.themes.map((t) => (
                  <Badge key={t.theme} variant="outline" className="capitalize">
                    {t.theme}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {review.verifiedPurchase && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Verified purchase</span>
              <span className="size-2 rounded-full bg-green-500" />
            </div>
          )}

          {review.helpfulCount !== null && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Helpful:</span>
              <span>{review.helpfulCount}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function ReviewsList({ reviews }: { reviews: ReviewDetail[] }) {
  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center">
        <AlertCircle className="mx-auto size-4 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">No reviews found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <ReviewDetailCard key={review.canonicalReviewId} review={review} />
      ))}
    </div>
  );
}
