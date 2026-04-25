"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { QuestionsData, Question, QuestionLevel, QuestionProgress } from "@/lib/types";
import { getQuestionProgress, updateQuestionProgress } from "@/lib/progress";
import questionsData from "@/public/questions.json";
import { playDing, playClunk, playLevelUp } from "@/lib/sounds";

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
        playLevelUp();
        const updated: QuestionProgress = { level: 3, completed: true };
        updateQuestionProgress(mod!.id, question.id, updated);
        setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
        setPhase("correct");
      } else {
        playDing();
        setPhase("confidence");
      }
    } else {
      playClunk();
      const newLevel = Math.max(1, qProgress.level - 1) as 1 | 2 | 3;
      const updated: QuestionProgress = { level: newLevel, completed: false };
      updateQuestionProgress(mod!.id, question.id, updated);
      setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
      setPhase("wrong");
    }
  }

  function handleConfidence(confident: boolean) {
    if (confident) {
      playLevelUp();
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
                  " border-gray-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]";
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
            <div className="mt-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center shadow-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-green-100">
                  <span className="text-2xl mt-1">⭐</span>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">Mastered!</h3>
                <p className="text-gray-600 mb-6 text-sm">You&apos;ve reached the maximum level for this question.</p>
                <button
                  onClick={advanceToNext}
                  className="bg-gray-900 text-white font-semibold w-full sm:w-auto px-8 py-3.5 rounded-xl flex items-center justify-center mx-auto hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                >
                  Continue <span className="ml-2 font-bold">→</span>
                </button>
              </div>
            </div>
          )}

          {/* Wrong answer — show feedback and next button */}
          {phase === "wrong" && (
            <div className="mt-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center shadow-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-red-100 text-red-500">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-6">Not quite</h3>
                <button
                  onClick={advanceToNext}
                  className="bg-gray-900 text-white font-semibold w-full sm:w-auto px-8 py-3.5 rounded-xl flex items-center justify-center mx-auto hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                >
                  Try next <span className="ml-2 font-bold">→</span>
                </button>
              </div>
            </div>
          )}

          {/* Confidence overlay modal */}
          {phase === "confidence" && (
            <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4 transition-all hover:cursor-pointer" onClick={(e) => { if (e.target === e.currentTarget) handleConfidence(true); }}>
              <div className="bg-white rounded-[2rem] p-8 text-center max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-300">
                <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-4 border border-green-100 shadow-sm">
                  <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Correct!</h3>
                <p className="text-gray-500 mb-8 text-base">How confident were you with your answer?</p>
                <div className="flex flex-col sm:flex-row justify-center gap-3">
                  <button
                    onClick={() => handleConfidence(false)}
                    className="flex-1 py-3.5 px-4 rounded-2xl border-2 border-gray-100 text-gray-700 font-semibold hover:border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-all active:scale-[0.98]"
                  >
                    I guessed
                  </button>
                  <button
                    onClick={() => handleConfidence(true)}
                    className="flex-1 py-3.5 px-4 rounded-2xl bg-gray-900 text-white font-semibold hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                  >
                    I knew it
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
