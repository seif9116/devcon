import { AppProgress, ModuleProgress, QuestionProgress } from "./types";

const STORAGE_KEY = "security-flashcards-progress";

export function loadProgress(): AppProgress {
  if (typeof window === "undefined") {
    return { language: "fr", modules: {} };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { language: "fr", modules: {} };
  return JSON.parse(raw);
}

export function saveProgress(progress: AppProgress): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function getQuestionProgress(
  moduleId: number,
  questionId: string
): QuestionProgress {
  const progress = loadProgress();
  return (
    progress.modules[moduleId]?.[questionId] ?? { level: 1, completed: false }
  );
}

export function updateQuestionProgress(
  moduleId: number,
  questionId: string,
  update: QuestionProgress
): void {
  const progress = loadProgress();
  if (!progress.modules[moduleId]) {
    progress.modules[moduleId] = {};
  }
  progress.modules[moduleId][questionId] = update;
  saveProgress(progress);
}

export function getModuleProgress(moduleId: number): ModuleProgress {
  const progress = loadProgress();
  return progress.modules[moduleId] ?? {};
}

export function getModuleCompletionCount(
  moduleId: number,
  totalQuestions: number
): { completed: number; total: number } {
  const mp = getModuleProgress(moduleId);
  const completed = Object.values(mp).filter((q) => q.completed).length;
  return { completed, total: totalQuestions };
}
