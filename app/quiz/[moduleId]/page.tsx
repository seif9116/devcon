"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { QuestionsData, Question, QuestionLevel, QuestionProgress } from "@/lib/types";
import { getQuestionProgress, updateQuestionProgress } from "@/lib/progress";
import questionsData from "@/public/questions.json";

type Phase = "answering" | "correct" | "wrong" | "confidence" | "explain" | "evaluating" | "results";

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
  const [explanation, setExplanation] = useState("");
  const [evaluationResult, setEvaluationResult] = useState<{
    english: { score: number; feedback: string };
    concepts: { score: number; feedback: string };
  } | null>(null);
  const [evalError, setEvalError] = useState("");

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
        setPhase("explain");
      } else {
        setPhase("confidence");
      }
    } else {
      const newLevel = Math.max(1, qProgress.level - 1) as 1 | 2 | 3;
      const updated: QuestionProgress = { level: newLevel, completed: false };
      updateQuestionProgress(mod!.id, question.id, updated);
      setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
      setPhase("wrong");
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

  async function handleExplanationSubmit() {
    if (!explanation.trim()) return;
    setPhase("evaluating");
    setEvalError("");
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionText: currentLevel.text,
          correctAnswer: currentLevel.options[currentLevel.answer],
          userExplanation: explanation,
        }),
      });
      if (!res.ok) throw new Error("Evaluation failed");
      const data = await res.json();
      setEvaluationResult(data);
      const passed = data.english.score >= 3 && data.concepts.score >= 3;
      if (passed) {
        const updated: QuestionProgress = { level: 3, completed: true };
        updateQuestionProgress(mod!.id, question.id, updated);
        setProgressMap((prev) => ({ ...prev, [question.id]: updated }));
      }
      setPhase("results");
    } catch {
      setEvalError("Something went wrong. Please try again.");
      setPhase("explain");
    }
  }

  function advanceToNext() {
    setPhase("answering");
    setSelectedAnswer(null);
    setExplanation("");
    setEvaluationResult(null);
    setEvalError("");
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

          {/* Wrong answer — show feedback and next button */}
          {phase === "wrong" && (
            <div className="text-center mt-4">
              <p className="text-red-600 font-medium mb-3">Wrong answer!</p>
              <button
                onClick={advanceToNext}
                className="bg-blue-600 text-white w-14 h-14 rounded-full text-2xl flex items-center justify-center mx-auto hover:bg-blue-700 transition-colors active:scale-95"
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

          {/* Explain phase — Level 3 explain your answer */}
          {phase === "explain" && (
            <div className="mt-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <p className="text-blue-800 font-medium">Explain your answer</p>
                <p className="text-blue-600 text-sm mt-1">
                  Why is &ldquo;{currentLevel.options[currentLevel.answer]}&rdquo; the correct answer? Use proper terminology.
                </p>
              </div>
              <textarea
                value={explanation}
                onChange={(e) => setExplanation(e.target.value)}
                placeholder="Type your explanation here..."
                className="w-full border-2 border-gray-200 rounded-lg p-3 text-gray-800 min-h-[120px] focus:border-blue-400 focus:outline-none resize-y"
              />
              {evalError && (
                <p className="text-red-600 text-sm mt-2">{evalError}</p>
              )}
              <button
                onClick={handleExplanationSubmit}
                disabled={!explanation.trim()}
                className="mt-3 w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit Explanation
              </button>
            </div>
          )}

          {/* Evaluating phase — spinner */}
          {phase === "evaluating" && (
            <div className="mt-6 text-center">
              <div className="inline-block w-10 h-10 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mb-3" />
              <p className="text-gray-600 font-medium">Evaluating your explanation...</p>
            </div>
          )}

          {/* Results phase — show scores and feedback */}
          {phase === "results" && evaluationResult && (
            <div className="mt-4">
              {evaluationResult.english.score >= 3 && evaluationResult.concepts.score >= 3 ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4 text-center">
                  <p className="text-2xl mb-1">⭐</p>
                  <p className="text-green-800 font-medium">Passed!</p>
                </div>
              ) : (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 mb-4 text-center">
                  <p className="text-orange-800 font-medium">Not quite — this card will come back around.</p>
                </div>
              )}

              <div className="space-y-3">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-gray-900">English Proficiency</p>
                    <span className={`font-bold text-lg ${evaluationResult.english.score >= 3 ? "text-green-600" : "text-red-600"}`}>
                      {evaluationResult.english.score}/5
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm">{evaluationResult.english.feedback}</p>
                </div>

                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-gray-900">Conceptual Understanding</p>
                    <span className={`font-bold text-lg ${evaluationResult.concepts.score >= 3 ? "text-green-600" : "text-red-600"}`}>
                      {evaluationResult.concepts.score}/5
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm">{evaluationResult.concepts.feedback}</p>
                </div>
              </div>

              <div className="text-center mt-4">
                <button
                  onClick={advanceToNext}
                  className="bg-blue-600 text-white w-14 h-14 rounded-full text-2xl flex items-center justify-center mx-auto hover:bg-blue-700 transition-colors active:scale-95"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
