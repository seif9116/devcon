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

  return (
    <main className="min-h-screen bg-gray-50 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Modules</h1>
        <p className="text-gray-500 mb-6">Pick a module to study</p>
        <div className="space-y-3">
          {data.modules.map((mod, i) => {
            const comp = completions[i] ?? { completed: 0, total: mod.questions.length };
            const pct = comp.total > 0 ? (comp.completed / comp.total) * 100 : 0;
            const isDone = comp.completed === comp.total && comp.total > 0;
            return (
              <button
                key={mod.id}
                onClick={() => router.push(`/quiz/${mod.id}`)}
                className="w-full bg-white rounded-xl p-4 shadow-sm border border-gray-200 hover:border-blue-400 transition-colors text-left"
              >
                <div className="flex items-center justify-between mb-2">
                  <h2 className="font-semibold text-gray-900">
                    Module {mod.id}
                  </h2>
                  {isDone && (
                    <span className="text-green-600 text-sm font-medium">
                      Complete
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-sm mb-3">{mod.name}</p>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {comp.completed}/{comp.total} questions mastered
                </p>
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
