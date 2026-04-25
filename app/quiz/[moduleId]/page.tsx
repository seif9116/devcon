"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { QuestionsData, Question, QuestionLevel, QuestionProgress } from "@/lib/types";
import { getQuestionProgress, updateQuestionProgress } from "@/lib/progress";
import questionsData from "@/public/questions.json";

type Phase = "answering" | "correct" | "wrong" | "confidence";

function getLevel(question: Question, level: 1 | 2 | 3): QuestionLevel {
  if (level === 1) return question.level1;
  if (level === 2) return question.level2;
  return question.level3;
}

export default function QuizPage({ params }: { params: Promise<{ moduleId: string }> }) {
  const { moduleId } = use(params);
  const router = useRouter();
  const data = questionsData as QuestionsData;
  const mod = data.modules.find((m) => m.id === parseInt(moduleId));

  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("answering");
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, QuestionProgress>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!mod) return;
    const map: Record<string, QuestionProgress> = {};
    mod.questions.forEach((q) => {
      map[q.id] = getQuestionProgress(mod.id, q.id);
    });
    setProgressMap(map);
  }, [mod]);

  const findNextIncomplete = useCallback(
    (startFrom: number): number | null => {
      if (!mod) return null;
      const len = mod.questions.length;
      for (let i = 0; i < len; i++) {
        const idx = (startFrom + i) % len;
        const qId = mod.questions[idx].id;
        if (!progressMap[qId]?.completed) return idx;
      }
      return null;
    },
    [mod, progressMap]
  );

  if (!mod) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p>Module not found</p>
      </main>
    );
  }

  const question = mod.questions[currentIndex];
  const qProgress = progressMap[question.id] ?? { level: 1 as const, completed: false };
  const currentLevel = getLevel(question, qProgress.level);
  const completedCount = Object.values(progressMap).filter((p) => p.completed).length;
  const totalCount = mod.questions.length;
  // Overall progress: sum of all levels / max possible (3 per question)
  const totalLevelProgress = Object.values(progressMap).reduce(
    (sum, p) => sum + (p.completed ? 3 : p.level - 1), 0
  );
  const maxLevelProgress = totalCount * 3;

  function handleAnswer(optionIndex: number) {
    setSelectedAnswer(optionIndex);
    if (optionIndex === currentLevel.answer) {
      if (qProgress.level === 3) {
        const updated: QuestionProgress = { level: 3, completed: true };
        updateQuestionProgress(mod!.id, question.id, updated);
        setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
        setPhase("correct");
      } else {
        setPhase("confidence");
      }
    } else {
      const newLevel = Math.max(1, qProgress.level - 1) as 1 | 2 | 3;
      const updated: QuestionProgress = { level: newLevel, completed: false };
      updateQuestionProgress(mod!.id, question.id, updated);
      setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
      // Re-present the same question at the lower level immediately
      setSelectedAnswer(null);
      setPhase("answering");
      setAttempt((a) => a + 1);
    }
  }

  function handleConfidence(confident: boolean) {
    if (confident) {
      const newLevel = Math.min(3, qProgress.level + 1) as 1 | 2 | 3;
      const updated: QuestionProgress = { level: newLevel, completed: false };
      updateQuestionProgress(mod!.id, question.id, updated);
      setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
    }
    advanceToNext();
  }

  function advanceToNext() {
    setPhase("answering");
    setSelectedAnswer(null);
    const next = findNextIncomplete(currentIndex + 1);
    if (next === null) {
      router.push(`/complete/${mod!.id}`);
    } else {
      setCurrentIndex(next);
    }
  }

  const levelLabel =
    qProgress.level === 1 ? "Français" : qProgress.level === 2 ? "Simple English" : "Exam English";

  return (
    <main className="min-h-screen bg-gray-50 p-4 flex flex-col">
      <div className="max-w-xl mx-auto w-full mb-4">
        <button
          onClick={() => router.push("/modules")}
          className="text-blue-600 text-xl mb-2 hover:opacity-70"
        >
          ←
        </button>
        <h1 className="text-lg font-bold text-gray-900">Module {mod.id}</h1>
        <p className="text-sm text-gray-500 mt-1">{currentIndex + 1} / {totalCount}</p>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all"
              style={{ width: `${(totalLevelProgress / maxLevelProgress) * 100}%` }}
            />
          </div>
          <span className="text-xs text-gray-500">
            ⭐ {completedCount}/{totalCount}
          </span>
        </div>
      </div>

      <div className="max-w-xl mx-auto w-full">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span
              className={`text-xs font-medium px-2 py-1 rounded-full ${
                qProgress.level === 1
                  ? "bg-purple-100 text-purple-700"
                  : qProgress.level === 2
                  ? "bg-yellow-100 text-yellow-700"
                  : "bg-red-100 text-red-700"
              }`}
            >
              Lv. {qProgress.level} — {levelLabel}
            </span>
          </div>

          <p className="text-xl font-medium text-gray-900 mb-6">
            {currentLevel.text}
          </p>

          {/* Options — always visible, highlighted after answer */}
          <div className="space-y-2" key={`${question.id}-${attempt}`}>
            {currentLevel.options.map((opt, i) => {
              let cls =
                "w-full text-left p-3 rounded-lg border-2 transition-all text-gray-800";
              if (phase !== "answering") {
                // After answering: highlight correct/wrong
                if (i === currentLevel.answer) {
                  cls += " border-green-500 bg-green-50";
                } else if (i === selectedAnswer) {
                  cls += " border-red-500 bg-red-50";
                } else {
                  cls += " border-gray-200 opacity-50";
                }
              } else {
                cls +=
                  " border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer";
              }
              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={phase !== "answering"}
                  className={cls}
                >
                  <span className="font-medium text-gray-400 mr-2">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Correct at level 3 — mastered, next arrow */}
          {phase === "correct" && (
            <div className="text-center mt-4">
              <p className="text-2xl mb-3">⭐</p>
              <button
                onClick={advanceToNext}
                className="bg-green-600 text-white w-14 h-14 rounded-full text-2xl flex items-center justify-center mx-auto hover:bg-green-700 transition-colors active:scale-95"
              >
                →
              </button>
            </div>
          )}

          {/* Confidence overlay modal */}
          {phase === "confidence" && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100]">
              <div className="bg-white rounded-2xl p-10 text-center max-w-sm w-[85%] shadow-2xl">
                <p className="text-5xl mb-3">✅</p>
                <p className="text-gray-500 mb-6">How&apos;d you feel about this?</p>
                <div className="flex justify-center gap-12">
                  <button
                    onClick={() => handleConfidence(false)}
                    className="text-6xl hover:scale-125 transition-transform active:scale-95"
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                  >
                    😟
                  </button>
                  <button
                    onClick={() => handleConfidence(true)}
                    className="text-6xl hover:scale-125 transition-transform active:scale-95"
                    style={{ background: "none", border: "none", cursor: "pointer" }}
                  >
                    😊
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
