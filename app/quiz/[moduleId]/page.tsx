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
  const [streak, setStreak] = useState(0);
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [langOverride, setLangOverride] = useState<"fr" | "en" | null>(null);

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
  
  let currentLevel = getLevel(question, qProgress.level);
  let activeLang = qProgress.level === 1 ? "fr" : "en";

  if (langOverride === "fr" && qProgress.level !== 1) {
    currentLevel = getLevel(question, 1);
    activeLang = "fr";
  } else if (langOverride === "en" && qProgress.level === 1) {
    currentLevel = getLevel(question, 2);
    activeLang = "en";
  }

  const completedCount = Object.values(progressMap).filter((p) => p.completed).length;
  const totalCount = mod.questions.length;
  const totalLevelProgress = Object.values(progressMap).reduce(
    (sum, p) => sum + (p.completed ? 3 : p.level - 1), 0
  );
  const maxLevelProgress = totalCount * 3;
  const progressPct = (totalLevelProgress / maxLevelProgress) * 100;

  function handleAnswer(optionIndex: number) {
    setSelectedAnswer(optionIndex);
    if (optionIndex === currentLevel.answer) {
      setStreak((s) => s + 1);
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
      setStreak(0);
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
    setLangOverride(null);
    const next = findNextIncomplete(currentIndex + 1);
    if (next === null) {
      router.push(`/complete/${mod!.id}`);
    } else {
      setCurrentIndex(next);
    }
  }

  async function playTTS() {
    if (isPlayingTTS) return;
    setIsPlayingTTS(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: currentLevel.text,
          languageCode: activeLang === "fr" ? "fr-FR" : "en-US",
        }),
      });

      if (!res.ok) throw new Error("TTS failed");
      
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      
      audio.onended = () => {
        setIsPlayingTTS(false);
        URL.revokeObjectURL(url);
      };
      
      audio.play();
    } catch (err) {
      console.error(err);
      setIsPlayingTTS(false);
    }
  }

  const levelLabel =
    qProgress.level === 1 ? "Français" : qProgress.level === 2 ? "Simple English" : "Exam English";

  return (
    <main className="min-h-screen bg-white p-4 flex flex-col">
      {/* Header */}
      <div className="max-w-2xl mx-auto w-full mb-8 animate-fade-in">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => router.push("/modules")}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm flex items-center gap-1"
          >
            <span>←</span> Modules
          </button>
          {streak >= 2 && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-orange-500 bg-orange-50 px-2.5 py-1 rounded-full animate-scale-in">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 23a7.5 7.5 0 01-5.138-12.963C8.204 8.774 11.5 6.5 11 1.5c6 4 9 8 3 14 1 0 2.5 0 5-2.47.27.97.5 2.08.5 3.47a7.5 7.5 0 01-7.5 7.5z"/>
              </svg>
              {streak} streak
            </div>
          )}
        </div>

        <div className="flex items-center justify-between mb-1.5">
          <h1 className="text-lg font-bold text-gray-900 tracking-tight">
            Module {mod.id}
            <span className="text-gray-400 font-normal text-sm ml-2">Question {currentIndex + 1} of {totalCount}</span>
          </h1>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
            <div
              className="h-2 rounded-full transition-all duration-700 ease-out"
              style={{
                width: `${progressPct}%`,
                background:
                  progressPct === 100
                    ? "linear-gradient(90deg, #22c55e, #16a34a)"
                    : progressPct > 60
                      ? "linear-gradient(90deg, #3b82f6, #8b5cf6)"
                      : "linear-gradient(90deg, #3b82f6, #60a5fa)",
              }}
            />
          </div>
          <span className="text-xs text-gray-400 font-medium tabular-nums">
            {completedCount}/{totalCount} mastered
          </span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto w-full animate-slide-up">
        <div className="bg-white rounded-[2rem] shadow-sm border border-gray-100 p-6 sm:p-10">
          {/* Level badge */}
          <div className="flex items-center gap-2 mb-8">
            <span
              className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                qProgress.level === 1
                  ? "bg-purple-50 text-purple-600 border border-purple-100"
                  : qProgress.level === 2
                  ? "bg-amber-50 text-amber-600 border border-amber-100"
                  : "bg-rose-50 text-rose-600 border border-rose-100"
              }`}
            >
              Lv. {qProgress.level} — {levelLabel}
            </span>
            
            {/* Lang Toggle */}
            <button
              onClick={() => setLangOverride(activeLang === "fr" ? "en" : "fr")}
              className="ml-2 flex items-center bg-gray-100 rounded-lg p-0.5"
            >
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${activeLang === "en" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>EN</span>
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-colors ${activeLang === "fr" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>FR</span>
            </button>

            {/* Level dots */}
            <div className="flex gap-1 ml-auto">
              {[1, 2, 3].map((l) => (
                <div
                  key={l}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    l <= qProgress.level ? "bg-blue-500" : "bg-gray-200"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Question text */}
          <div className="flex items-start justify-between gap-6 mb-8">
            <p className="text-xl font-medium text-gray-900 leading-relaxed max-w-[90%]">
              {currentLevel.text}
            </p>
            <button
              onClick={playTTS}
              disabled={isPlayingTTS}
              className={`flex-shrink-0 p-2.5 rounded-xl border transition-all ${
                isPlayingTTS
                  ? "bg-blue-50 border-blue-200 text-blue-500 animate-pulse"
                  : "bg-white border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50 shadow-sm active:scale-95"
              }`}
              title="Listen to question"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>
          </div>

          {/* Options */}
          <div className="space-y-4" key={`${question.id}-${attempt}`}>
            {currentLevel.options.map((opt, i) => {
              let cls =
                "w-full text-left p-4 sm:p-5 rounded-2xl border transition-all text-gray-800 text-[0.94rem] sm:text-base";
              if (phase !== "answering") {
                if (i === currentLevel.answer) {
                  cls += " border-green-400 bg-green-50 ring-1 ring-green-200";
                } else if (i === selectedAnswer) {
                  cls += " border-red-400 bg-red-50 animate-shake";
                } else {
                  cls += " border-gray-100 opacity-40";
                }
              } else {
                cls +=
                  " border-gray-100 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]";
              }
              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={phase !== "answering"}
                  className={cls}
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100/80 text-gray-500 text-xs font-bold mr-4">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {opt}
                </button>
              );
            })}
          </div>

          {/* Correct at level 3 — mastered */}
          {phase === "correct" && (
            <div className="mt-8 animate-scale-in">
              <div className="bg-green-50 border border-green-200 rounded-2xl p-6 text-center shadow-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-green-100 animate-pulse-glow">
                  <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Mastered!</h3>
                <p className="text-gray-500 mb-6 text-sm">You&apos;ve reached the maximum level for this question.</p>
                <button
                  onClick={advanceToNext}
                  className="bg-gray-900 text-white font-semibold w-full sm:w-auto px-8 py-3.5 rounded-xl flex items-center justify-center mx-auto hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                >
                  Continue <span className="ml-2 font-bold">→</span>
                </button>
              </div>
            </div>
          )}

          {/* Wrong answer */}
          {phase === "wrong" && (
            <div className="mt-8 animate-scale-in">
              <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center shadow-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-red-100 text-red-500">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Not quite</h3>
                <p className="text-gray-500 mb-6 text-sm">The correct answer is highlighted above.</p>
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
            <div
              className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in"
              onClick={(e) => { if (e.target === e.currentTarget) handleConfidence(true); }}
            >
              <div className="bg-white rounded-[2rem] p-8 text-center max-w-md w-full shadow-2xl animate-scale-in">
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
