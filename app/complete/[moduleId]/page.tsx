"use client";

import { use, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { playLevelUp } from "@/lib/sounds";

const CONFETTI_COLORS = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b",
  "#22c55e", "#06b6d4", "#ef4444", "#f97316",
];

function createConfetti(container: HTMLDivElement) {
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.backgroundColor =
      CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    piece.style.animationDuration = `${2 + Math.random() * 3}s`;
    piece.style.animationDelay = `${Math.random() * 1.5}s`;
    piece.style.width = `${6 + Math.random() * 8}px`;
    piece.style.height = `${6 + Math.random() * 8}px`;
    piece.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
    piece.style.opacity = `${0.7 + Math.random() * 0.3}`;
    container.appendChild(piece);
  }
}

export default function CompletePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const router = useRouter();
  const confettiRef = useRef<HTMLDivElement>(null);
  const hasPlayed = useRef(false);

  useEffect(() => {
    if (!hasPlayed.current) {
      hasPlayed.current = true;
      playLevelUp();
      if (confettiRef.current) {
        createConfetti(confettiRef.current);
      }
    }
  }, []);

  return (
    <main className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      {/* Background gradient */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(135deg, #064e3b 0%, #065f46 25%, #059669 50%, #10b981 75%, #065f46 100%)",
          backgroundSize: "400% 400%",
          animation: "gradient-shift 10s ease infinite",
        }}
      />
      {/* Subtle pattern */}
      <div
        className="absolute inset-0 -z-10 opacity-[0.03]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />

      {/* Confetti container */}
      <div ref={confettiRef} className="fixed inset-0 pointer-events-none z-50" />

      <div className="max-w-md w-full text-center animate-scale-in">
        {/* Trophy icon */}
        <div className="mx-auto w-24 h-24 rounded-3xl bg-white/10 backdrop-blur border border-white/20 flex items-center justify-center mb-8 shadow-lg shadow-green-900/30 animate-float">
          <svg className="w-12 h-12 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m0 0c-.468.063-.944.096-1.5.096s-1.032-.033-1.5-.096m3 0a7.439 7.439 0 00.981-3.172M9.497 14.25a6.023 6.023 0 002.77.896" />
          </svg>
        </div>

        <h1 className="text-4xl font-bold text-white mb-3 tracking-tight">
          Module {moduleId} Complete!
        </h1>
        <p className="text-green-200/80 mb-10 text-lg leading-relaxed">
          You&apos;ve mastered all questions at exam level.
          <br />
          <span className="text-green-300/60 text-sm">Great work — keep the momentum going.</span>
        </p>

        <button
          onClick={() => router.push("/modules")}
          className="group relative bg-white text-green-800 px-8 py-4 rounded-2xl font-semibold hover:bg-green-50 transition-all shadow-xl shadow-black/20 active:scale-[0.98] text-lg"
        >
          Back to Modules
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-400 group-hover:-translate-x-1 transition-transform font-bold">
            ←
          </span>
        </button>
      </div>

      <style jsx>{`
        @keyframes gradient-shift {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </main>
  );
}
