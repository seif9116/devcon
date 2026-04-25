"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { QuestionsData, Question, QuestionLevel } from "@/lib/types";
import questionsData from "@/public/questions.json";
import { playDing, playClunk, playLevelUp } from "@/lib/sounds";

type Phase = "answering" | "correct" | "wrong" | "confidence";

function getLevel(question: Question, level: 1 | 2 | 3): QuestionLevel {
  if (level === 1) return question.level1;
  if (level === 2) return question.level2;
  return question.level3;
}

export default function DemoPage() {
  const router = useRouter();
  const data = questionsData as QuestionsData;
  const question = data.modules[0].questions[0]; // Just grab first question from module 1

  const [activeLevel, setActiveLevel] = useState<1 | 2 | 3>(1);
  const [phase, setPhase] = useState<Phase>("answering");
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [isPlayingTTS, setIsPlayingTTS] = useState(false);
  const [langOverride, setLangOverride] = useState<"fr" | "en" | null>(null);

  let currentLevel = getLevel(question, activeLevel);
  let activeLang = activeLevel === 1 ? "fr" : "en";

  if (langOverride === "fr" && activeLevel !== 1) {
    currentLevel = getLevel(question, 1);
    activeLang = "fr";
  } else if (langOverride === "en" && activeLevel === 1) {
    currentLevel = getLevel(question, 2);
    activeLang = "en";
  }

  function handleAnswer(optionIndex: number) {
    setSelectedAnswer(optionIndex);
    if (optionIndex === currentLevel.answer) {
      if (activeLevel === 3) {
        playLevelUp();
        setPhase("correct");
      } else {
        playDing();
        setPhase("confidence");
      }
    } else {
      playClunk();
      setPhase("wrong");
    }
  }

  function handleConfidence(confident: boolean) {
    if (confident) {
      playLevelUp();
      const newLevel = Math.min(3, activeLevel + 1) as 1 | 2 | 3;
      setActiveLevel(newLevel);
    } else {
      // Stay on same level or go down? Let's just go up slowly or stay
      setActiveLevel(Math.min(3, activeLevel + 1) as 1 | 2 | 3);
    }
    resetPhase();
  }

  function resetPhase() {
    setPhase("answering");
    setSelectedAnswer(null);
    setLangOverride(null);
  }

  function forceLevel(level: 1 | 2 | 3) {
    setActiveLevel(level);
    resetPhase();
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
    activeLevel === 1 ? "Français" : activeLevel === 2 ? "Simple English" : "Exam English";

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center p-4 sm:p-8">
      <div className="max-w-2xl w-full">
        {/* Header Setup */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <button
            onClick={() => router.push("/modules")}
            className="text-gray-400 hover:text-gray-600 transition-colors text-sm flex items-center gap-1"
          >
            <span>←</span> Back to Modules
          </button>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-medium">Demo Level Controller:</span>
            <div className="bg-white rounded-lg p-1 border shadow-sm flex items-center">
              {[1, 2, 3].map((l) => (
                <button
                  key={l}
                  onClick={() => forceLevel(l as 1 | 2 | 3)}
                  className={`px-3 py-1 text-sm font-semibold rounded-md transition-colors ${
                    activeLevel === l
                      ? "bg-blue-50 text-blue-600"
                      : "text-gray-400 hover:text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  L{l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Similar widget to quiz/page.tsx */}
        <div className="bg-white rounded-[2rem] shadow-lg border border-gray-100/50 p-6 sm:p-10 animate-fade-in relative overflow-hidden">
          {/* Level badge */}
          <div className="flex items-center gap-2 mb-8">
            <span
              className={`text-xs font-bold px-3 py-1.5 rounded-full ${
                activeLevel === 1
                  ? "bg-purple-50 text-purple-600 border border-purple-100"
                  : activeLevel === 2
                  ? "bg-amber-50 text-amber-600 border border-amber-100"
                  : "bg-rose-50 text-rose-600 border border-rose-100"
              }`}
            >
              Lv. {activeLevel} — {levelLabel}
            </span>
            
            {/* Lang Toggle */}
            <button
              onClick={() => setLangOverride(activeLang === "fr" ? "en" : "fr")}
              className="ml-2 flex items-center bg-gray-100 rounded-lg p-0.5"
            >
              <span className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${activeLang === "en" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>EN</span>
              <span className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${activeLang === "fr" ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"}`}>FR</span>
            </button>
          </div>

          {/* Question text */}
          <div className="flex items-start justify-between gap-4 mb-8">
            <p className="text-xl font-medium text-gray-900 leading-relaxed">
              {currentLevel.text}
            </p>
            <button
              onClick={playTTS}
              disabled={isPlayingTTS}
              className={`flex-shrink-0 p-3 rounded-xl border transition-all ${
                isPlayingTTS
                  ? "bg-blue-50 border-blue-200 text-blue-500 animate-pulse"
                  : "bg-white border-gray-200 text-gray-400 hover:text-blue-500 hover:border-blue-200 hover:bg-blue-50 shadow-sm hover:scale-105 active:scale-95"
              }`}
              title="Listen to question"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            </button>
          </div>

          {/* Options */}
          <div className="space-y-4 relative z-10">
            {currentLevel.options.map((opt, i) => {
              let cls =
                "w-full text-left p-4 sm:p-5 rounded-2xl border transition-all text-gray-800 text-[0.94rem] sm:text-base";
              if (phase !== "answering") {
                if (i === currentLevel.answer) {
                  cls += " border-green-400 bg-green-50/80 ring-2 ring-green-100 shadow-sm";
                } else if (i === selectedAnswer) {
                  cls += " border-red-400 bg-red-50/80 animate-shake shadow-sm";
                } else {
                  cls += " border-gray-100 opacity-30 grayscale";
                }
              } else {
                cls +=
                  " border-gray-200 hover:border-blue-300 hover:bg-blue-50/50 cursor-pointer shadow-sm hover:shadow hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]";
              }
              return (
                <button
                  key={i}
                  onClick={() => handleAnswer(i)}
                  disabled={phase !== "answering"}
                  className={cls}
                >
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-gray-100/80 shadow-sm border border-gray-100 text-gray-500 text-xs font-bold mr-4">
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
              <div className="bg-green-50/80 border border-green-200 rounded-2xl p-6 text-center shadow-sm relative overflow-hidden backdrop-blur-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-green-100 animate-pulse-glow z-10 relative">
                  <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1 relative z-10">Demo Mastered!</h3>
                <p className="text-gray-500 mb-6 text-sm relative z-10">You've reached Level 3 on this demo question.</p>
                <button
                  onClick={resetPhase}
                  className="bg-gray-900 text-white font-semibold w-full sm:w-auto px-8 py-3.5 rounded-xl flex items-center justify-center mx-auto hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all relative z-10"
                >
                  Restart Demo <span className="ml-2 font-bold">↺</span>
                </button>
              </div>
            </div>
          )}

          {/* Wrong answer */}
          {phase === "wrong" && (
            <div className="mt-8 animate-scale-in">
              <div className="bg-red-50/80 border border-red-200 rounded-2xl p-6 text-center shadow-sm backdrop-blur-sm">
                <div className="mx-auto flex items-center justify-center w-14 h-14 rounded-full bg-white mb-4 shadow-sm border border-red-100 text-red-500">
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Not quite</h3>
                <p className="text-gray-500 mb-6 text-sm">The correct answer is highlighted above.</p>
                <button
                  onClick={resetPhase}
                  className="bg-gray-900 text-white font-semibold w-full sm:w-auto px-8 py-3.5 rounded-xl flex items-center justify-center mx-auto hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                >
                  Reset Demo <span className="ml-2 font-bold">↺</span>
                </button>
              </div>
            </div>
          )}

          {/* Confidence overlay modal */}
          {phase === "confidence" && (
            <div
              className="absolute inset-0 bg-white/60 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-fade-in"
              onClick={(e) => { if (e.target === e.currentTarget) handleConfidence(true); }}
            >
              <div className="bg-white rounded-3xl p-8 text-center max-w-sm w-full shadow-2xl animate-scale-in border border-gray-100">
                <div className="mx-auto flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-5 border border-green-100 shadow-sm">
                  <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Correct!</h3>
                <p className="text-gray-500 mb-8 text-sm">How confident were you with your answer?</p>
                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => handleConfidence(false)}
                    className="w-full py-3.5 px-4 rounded-xl border-2 border-gray-100 text-gray-700 font-semibold hover:border-gray-200 hover:bg-gray-50 active:bg-gray-100 transition-all active:scale-[0.98]"
                  >
                    I guessed 😅
                  </button>
                  <button
                    onClick={() => handleConfidence(true)}
                    className="w-full py-3.5 px-4 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-800 shadow-md active:scale-[0.98] transition-all"
                  >
                    I knew it! 🧠
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
