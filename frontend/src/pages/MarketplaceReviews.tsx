import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ArrowRight } from "lucide-react";

export function MarketplaceReviews() {
  const navigate = useNavigate();
  const { platform } = useParams<{ platform: string }>();

  const platformLabel = platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : "Unknown";
  const platformIcon = platform === "myntra" ? "👗" : "📦";

  const sentimentTypes = [
    {
      type: "negative",
      title: "Most Bad Reviews",
      description: "Products customers complain most about",
      icon: "📉",
      color: "from-red-500 to-orange-600",
      bgGradient: "from-red-500/10 to-orange-500/10",
      borderColor: "border-red-500/30",
      textColor: "text-red-300",
    },
    {
      type: "positive",
      title: "Most Good Reviews",
      description: "Products customers love most",
      icon: "📈",
      color: "from-green-500 to-emerald-600",
      bgGradient: "from-green-500/10 to-emerald-500/10",
      borderColor: "border-green-500/30",
      textColor: "text-green-300",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Back button */}
        <button
          onClick={() => navigate("/reviews-overview")}
          className="flex items-center gap-2 text-purple-300 hover:text-purple-200 mb-12 font-semibold transition-colors group"
        >
          <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform" />
          <span>Back to Overview</span>
        </button>

        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className="text-4xl">{platformIcon}</span>
            <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">
              {platformLabel}
            </h1>
          </div>
          <p className="text-gray-400 text-base">
            Choose sentiment type to explore ranked products
          </p>
        </div>

        {/* Sentiment Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {sentimentTypes.map((sentiment) => (
            <div
              key={sentiment.type}
              onClick={() =>
                navigate(`/reviews-overview/${platform}/${sentiment.type}`)
              }
              className="group cursor-pointer"
            >
              <div
                className={`
                  relative bg-gradient-to-br ${sentiment.color}
                  rounded-xl shadow-lg hover:shadow-xl
                  transition-all duration-300
                  p-0.5 overflow-hidden
                  transform hover:scale-102 hover:-translate-y-1
                `}
              >
                {/* Inner card */}
                <div className={`
                  relative bg-gradient-to-br ${sentiment.bgGradient}
                  border ${sentiment.borderColor}
                  rounded-lg p-6 backdrop-blur-sm space-y-4
                `}>
                  {/* Icon */}
                  <div className="text-5xl transform group-hover:scale-120 transition-transform duration-300">
                    {sentiment.icon}
                  </div>

                  {/* Title & Description */}
                  <div className="space-y-2 border-b border-slate-700/40 pb-4">
                    <h2 className="text-xl font-bold text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-purple-200 transition-all">
                      {sentiment.title}
                    </h2>
                    <p className="text-gray-400 text-xs leading-relaxed">{sentiment.description}</p>
                  </div>

                  {/* Stats box */}
                  <div className={`p-3 rounded-lg bg-gradient-to-r ${sentiment.bgGradient} border ${sentiment.borderColor}`}>
                    <p className={`${sentiment.textColor} font-semibold text-xs`}>
                      {sentiment.type === "negative"
                        ? "⚠️ View problematic products"
                        : "✨ View highly rated products"}
                    </p>
                  </div>

                  {/* CTA */}
                  <div className="flex items-center gap-2 text-white font-semibold text-sm group-hover:translate-x-1 transition-transform duration-300 pt-2">
                    <span>View</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Info section */}
        <div className="mt-20 p-8 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-xl">
          <p className="text-gray-300 text-center">
            <span className="font-semibold">💡 Tip:</span> Each product is ranked based on the sentiment distribution in its latest 10 customer reviews
          </p>
        </div>
      </div>
    </div>
  );
}
