"use client";

import { use } from "react";
import { useRouter } from "next/navigation";

export default function CompletePage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const router = useRouter();

  return (
    <main className="min-h-screen bg-gradient-to-br from-green-600 to-green-800 flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-3xl font-bold text-white mb-2">
          Module {moduleId} Complete!
        </h1>
        <p className="text-green-200 mb-8">
          You&apos;ve mastered all questions at exam level. Great work!
        </p>
        <button
          onClick={() => router.push("/modules")}
          className="bg-white text-green-800 px-8 py-3 rounded-xl font-semibold hover:bg-green-50 transition-colors"
        >
          Back to Modules
        </button>
      </div>
    </main>
  );
}
