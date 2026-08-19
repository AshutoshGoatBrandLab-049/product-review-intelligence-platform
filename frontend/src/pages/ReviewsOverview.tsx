import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";

export function ReviewsOverview() {
  const navigate = useNavigate();

  const marketplaces = [
    {
      name: "Myntra",
      subtitle: "Fashion & Lifestyle Reviews",
      platform: "myntra",
      gradient: "from-pink-400 via-pink-500 to-pink-600",
      icon: "👗",
      stats: "10K+ Products",
    },
    {
      name: "Flipkart",
      subtitle: "Electronics & General Reviews",
      platform: "flipkart",
      gradient: "from-blue-400 via-blue-500 to-blue-600",
      icon: "📦",
      stats: "50K+ Products",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-20 left-10 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-40 right-10 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col justify-center px-6 py-12">
        <div className="max-w-5xl mx-auto w-full">
          {/* Header */}
          <div className="text-center mb-12">
            <div className="inline-block mb-4 px-3 py-1 bg-purple-500/20 border border-purple-400/30 rounded-full">
              <p className="text-purple-300 text-xs font-semibold">Product Review Analytics</p>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white via-purple-200 to-white">
              Review Overview
            </h1>
            <p className="text-base md:text-lg text-gray-400 max-w-2xl mx-auto">
              Explore products ranked by customer sentiment. Understand what customers love and what needs improvement.
            </p>
          </div>

          {/* Marketplace Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {marketplaces.map((marketplace) => (
              <div
                key={marketplace.platform}
                onClick={() => navigate(`/reviews-overview/${marketplace.platform}`)}
                className="group cursor-pointer"
              >
                <div
                  className={`
                    relative bg-gradient-to-br ${marketplace.gradient}
                    rounded-xl shadow-lg hover:shadow-xl
                    transition-all duration-300
                    p-0.5 overflow-hidden
                    transform hover:scale-102 hover:-translate-y-1
                  `}
                >
                  {/* Border glow effect */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-xl"></div>

                  {/* Card content */}
                  <div className="relative bg-gradient-to-br from-slate-900/95 to-slate-800/95 rounded-lg p-6 backdrop-blur-sm space-y-4">
                    {/* Icon */}
                    <div className="text-5xl transform group-hover:scale-110 transition-transform duration-300">
                      {marketplace.icon}
                    </div>

                    {/* Title & Subtitle */}
                    <div className="space-y-2 border-b border-slate-700/50 pb-4">
                      <h2 className="text-2xl font-bold text-white group-hover:text-transparent group-hover:bg-clip-text group-hover:bg-gradient-to-r group-hover:from-white group-hover:to-purple-200 transition-all">
                        {marketplace.name}
                      </h2>
                      <p className="text-gray-400 text-xs leading-relaxed">{marketplace.subtitle}</p>
                    </div>

                    {/* Stats */}
                    <div className="p-3 bg-gradient-to-r from-purple-500/15 to-blue-500/15 rounded-lg border border-purple-500/30">
                      <p className="text-purple-300 font-semibold text-xs">{marketplace.stats}</p>
                    </div>

                    {/* CTA */}
                    <div className="flex items-center gap-2 text-white font-semibold text-sm group-hover:translate-x-1 transition-transform duration-300 pt-2">
                      <span>Explore</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="text-center mt-20">
            <p className="text-gray-400 text-sm">
              💡 Select a marketplace to view products ranked by customer sentiment
            </p>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
        }
        .animate-blob {
          animation: blob 7s infinite;
        }
        .animation-delay-2000 {
          animation-delay: 2s;
        }
        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}
