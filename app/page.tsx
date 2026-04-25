"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  function enter() {
    localStorage.setItem("security-flashcards-language", "fr");
    router.push("/modules");
  }

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      {/* Animated gradient background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e3a5f 25%, #1e40af 50%, #7c3aed 75%, #1e3a5f 100%)",
          backgroundSize: "400% 400%",
          animation: "gradient-shift 12s ease infinite",
        }}
      />
      {/* Subtle grid overlay */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="max-w-md w-full text-center animate-slide-up">
        {/* Logo / icon */}
        <div className="mx-auto w-20 h-20 rounded-3xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center mb-8 animate-float shadow-lg shadow-blue-500/20">
          <svg
            className="w-10 h-10 text-white"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
            />
          </svg>
        </div>

        <h1 className="text-5xl font-bold text-white mb-3 tracking-tight">
          GuardPrep Pro
        </h1>
        <p className="text-blue-200/80 mb-10 text-lg leading-relaxed">
          Alberta Basic Security Training
          <br />
          <span className="text-blue-300/60 text-sm">
            Adaptive flashcards &middot; Spaced repetition &middot; Multilingual
          </span>
        </p>

        <button
          onClick={enter}
          className="group relative w-full bg-white text-gray-900 rounded-2xl py-4 px-6 text-lg font-semibold hover:bg-blue-50 transition-all shadow-xl shadow-black/20 active:scale-[0.98]"
        >
          <span className="flex items-center justify-center gap-3">
            <span className="text-2xl">🇫🇷</span>
            Commencer en Français
          </span>
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 group-hover:translate-x-1 transition-transform font-bold">
            →
          </span>
        </button>

        <p className="text-blue-300/40 text-xs mt-8">
          Built for hackathon by the DevCon team
        </p>
      </div>

      <style jsx>{`
        @keyframes gradient-shift {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
      `}</style>
    </main>
  );
}
