"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QuestionsData } from "@/lib/types";
import { getModuleCompletionCount } from "@/lib/progress";
import questionsData from "@/public/questions.json";

export default function ModulesPage() {
  const router = useRouter();
  const data = questionsData as QuestionsData;
  const [completions, setCompletions] = useState<
    { completed: number; total: number }[]
  >([]);

  useEffect(() => {
    setCompletions(
      data.modules.map((m) =>
        getModuleCompletionCount(m.id, m.questions.length)
      )
    );
  }, [data.modules]);

  const totalCompleted = completions.reduce((s, c) => s + c.completed, 0);
  const totalQuestions = completions.reduce((s, c) => s + c.total, 0);
  const overallPct = totalQuestions > 0 ? (totalCompleted / totalQuestions) * 100 : 0;

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="animate-slide-up mb-8">
          <button
            onClick={() => router.push("/")}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm mb-4 flex items-center gap-1"
          >
            <span>←</span> Home
          </button>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight mb-1">
            Modules
          </h1>
          <p className="text-gray-500 mb-4">Pick a module to study</p>

          {/* Overall progress */}
          <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Overall Progress</span>
              <span className="text-sm font-bold text-gray-900">
                {totalCompleted}/{totalQuestions}
              </span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
              <div
                className="h-2.5 rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${overallPct}%`,
                  background:
                    overallPct === 100
                      ? "linear-gradient(90deg, #22c55e, #16a34a)"
                      : overallPct > 50
                        ? "linear-gradient(90deg, #3b82f6, #8b5cf6)"
                        : "linear-gradient(90deg, #3b82f6, #60a5fa)",
                }}
              />
            </div>
          </div>
        </div>

        {/* Module cards */}
        <div className="space-y-3 stagger-children">
          {data.modules.map((mod, i) => {
            const comp = completions[i] ?? {
              completed: 0,
              total: mod.questions.length,
            };
            const pct =
              comp.total > 0 ? (comp.completed / comp.total) * 100 : 0;
            const isDone = comp.completed === comp.total && comp.total > 0;
            return (
              <button
                key={mod.id}
                onClick={() => router.push(`/quiz/${mod.id}`)}
                className="animate-slide-up w-full bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:border-blue-300 hover:shadow-md hover:-translate-y-0.5 transition-all text-left group"
              >
                <div className="flex items-start gap-4">
                  {/* Module number badge */}
                  <div
                    className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center font-bold text-sm
                    ${isDone
                        ? "bg-green-100 text-green-600"
                        : "bg-blue-50 text-blue-600 group-hover:bg-blue-100"
                      } transition-colors`}
                  >
                    {isDone ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      mod.id
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <h2 className="font-semibold text-gray-900 truncate pr-2">
                        Module {mod.id}
                      </h2>
                      {isDone && (
                        <span className="flex-shrink-0 text-xs font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                          Complete
                        </span>
                      )}
                    </div>
                    <p className="text-gray-500 text-sm mb-3 truncate">
                      {mod.name}
                    </p>
                    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="h-1.5 rounded-full transition-all duration-700 ease-out"
                        style={{
                          width: `${pct}%`,
                          background: isDone
                            ? "linear-gradient(90deg, #22c55e, #16a34a)"
                            : "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                        }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1.5">
                      {comp.completed}/{comp.total} mastered
                    </p>
                  </div>

                  {/* Arrow */}
                  <span className="flex-shrink-0 text-gray-300 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all self-center">
                    →
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
