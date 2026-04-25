import { describe, it, expect } from "vitest";
import type { Question, QuestionLevel } from "@/lib/types";

/**
 * Tests for the demo page logic (app/demo/page.tsx).
 * Covers: correct/wrong flows, level transitions, TTS language selection,
 * explanation submission flow, and LLM evaluation result handling.
 */

type Phase = "answering" | "correct" | "wrong" | "confidence" | "explain" | "evaluating" | "results";

function getLevel(question: Question, level: 1 | 2 | 3): QuestionLevel {
  if (level === 1) return question.level1;
  if (level === 2) return question.level2;
  return question.level3;
}

// Replicate demo handleAnswer logic
function handleAnswer(
  optionIndex: number,
  currentLevel: QuestionLevel,
  activeLevel: 1 | 2 | 3
): { phase: Phase } {
  if (optionIndex === currentLevel.answer) {
    if (activeLevel === 3) {
      return { phase: "explain" };
    }
    return { phase: "confidence" };
  }
  return { phase: "wrong" };
}

// Replicate demo handleConfidence logic (both paths advance in demo)
function handleConfidence(
  confident: boolean,
  activeLevel: 1 | 2 | 3
): { newLevel: 1 | 2 | 3 } {
  if (confident) {
    return { newLevel: Math.min(3, activeLevel + 1) as 1 | 2 | 3 };
  }
  return { newLevel: Math.min(3, activeLevel + 1) as 1 | 2 | 3 };
}

// Replicate TTS language logic
function getTTSConfig(activeLevel: 1 | 2 | 3, langOverride: "fr" | "en" | null) {
  let activeLang = activeLevel === 1 ? "fr" : "en";
  if (langOverride === "fr" && activeLevel !== 1) activeLang = "fr";
  else if (langOverride === "en" && activeLevel === 1) activeLang = "en";
  return {
    activeLang,
    languageCode: activeLang === "fr" ? "fr-FR" : "en-US",
  };
}

// Replicate explanation result evaluation
function evaluateResult(result: {
  english: { score: number };
  concepts: { score: number };
}): boolean {
  return result.english.score >= 3 && result.concepts.score >= 3;
}

const makeQuestion = (): Question => ({
  id: "demo-q1",
  level1: { text: "Question en francais?", options: ["Vrai", "Faux", "Peut-etre", "Jamais"], answer: 0 },
  level2: { text: "Simple English question?", options: ["Yes", "No", "Maybe", "Never"], answer: 1 },
  level3: { text: "Exam English question?", options: ["Alpha", "Beta", "Gamma", "Delta"], answer: 2 },
});

// ---- Correct flow ----

describe("Demo correct answer flow", () => {
  const question = makeQuestion();

  it("L1 correct -> confidence phase", () => {
    const level = getLevel(question, 1);
    const result = handleAnswer(level.answer, level, 1);
    expect(result.phase).toBe("confidence");
  });

  it("L2 correct -> confidence phase", () => {
    const level = getLevel(question, 2);
    const result = handleAnswer(level.answer, level, 2);
    expect(result.phase).toBe("confidence");
  });

  it("L3 correct -> explain phase (not confidence)", () => {
    const level = getLevel(question, 3);
    const result = handleAnswer(level.answer, level, 3);
    expect(result.phase).toBe("explain");
  });

  it("confidence 'I knew it' at L1 advances to L2", () => {
    const result = handleConfidence(true, 1);
    expect(result.newLevel).toBe(2);
  });

  it("confidence 'I knew it' at L2 advances to L3", () => {
    const result = handleConfidence(true, 2);
    expect(result.newLevel).toBe(3);
  });

  it("confidence 'I guessed' at L1 still advances to L2 (demo behavior)", () => {
    const result = handleConfidence(false, 1);
    expect(result.newLevel).toBe(2);
  });

  it("confidence at L3 caps at L3", () => {
    const result = handleConfidence(true, 3);
    expect(result.newLevel).toBe(3);
  });
});

// ---- Wrong flow ----

describe("Demo wrong answer flow", () => {
  const question = makeQuestion();

  it("L1 wrong answer -> wrong phase", () => {
    const level = getLevel(question, 1);
    const wrongIndex = level.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level, 1);
    expect(result.phase).toBe("wrong");
  });

  it("L2 wrong answer -> wrong phase", () => {
    const level = getLevel(question, 2);
    const wrongIndex = level.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level, 2);
    expect(result.phase).toBe("wrong");
  });

  it("L3 wrong answer -> wrong phase (not explain)", () => {
    const level = getLevel(question, 3);
    const wrongIndex = level.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level, 3);
    expect(result.phase).toBe("wrong");
  });
});

// ---- TTS language selection ----

describe("TTS language config", () => {
  it("L1 defaults to French", () => {
    const config = getTTSConfig(1, null);
    expect(config.activeLang).toBe("fr");
    expect(config.languageCode).toBe("fr-FR");
  });

  it("L2 defaults to English", () => {
    const config = getTTSConfig(2, null);
    expect(config.activeLang).toBe("en");
    expect(config.languageCode).toBe("en-US");
  });

  it("L3 defaults to English", () => {
    const config = getTTSConfig(3, null);
    expect(config.activeLang).toBe("en");
    expect(config.languageCode).toBe("en-US");
  });

  it("lang override to EN on L1 switches to English", () => {
    const config = getTTSConfig(1, "en");
    expect(config.activeLang).toBe("en");
    expect(config.languageCode).toBe("en-US");
  });

  it("lang override to FR on L2 switches to French", () => {
    const config = getTTSConfig(2, "fr");
    expect(config.activeLang).toBe("fr");
    expect(config.languageCode).toBe("fr-FR");
  });

  it("lang override FR on L1 stays French (no-op)", () => {
    const config = getTTSConfig(1, "fr");
    expect(config.activeLang).toBe("fr");
  });

  it("lang override EN on L2 stays English (no-op)", () => {
    const config = getTTSConfig(2, "en");
    expect(config.activeLang).toBe("en");
  });
});

// ---- LLM evaluation results ----

describe("LLM evaluation result handling", () => {
  it("passes when both scores >= 3", () => {
    expect(evaluateResult({ english: { score: 3 }, concepts: { score: 3 } })).toBe(true);
  });

  it("passes when both scores are 5", () => {
    expect(evaluateResult({ english: { score: 5 }, concepts: { score: 5 } })).toBe(true);
  });

  it("fails when english score < 3", () => {
    expect(evaluateResult({ english: { score: 2 }, concepts: { score: 4 } })).toBe(false);
  });

  it("fails when concepts score < 3", () => {
    expect(evaluateResult({ english: { score: 4 }, concepts: { score: 2 } })).toBe(false);
  });

  it("fails when both scores < 3", () => {
    expect(evaluateResult({ english: { score: 1 }, concepts: { score: 1 } })).toBe(false);
  });

  it("boundary: english=3 concepts=2 fails", () => {
    expect(evaluateResult({ english: { score: 3 }, concepts: { score: 2 } })).toBe(false);
  });

  it("boundary: english=2 concepts=3 fails", () => {
    expect(evaluateResult({ english: { score: 2 }, concepts: { score: 3 } })).toBe(false);
  });
});

// ---- Full flow integration ----

describe("Full demo flow: L1 -> L2 -> L3 -> explain -> evaluate", () => {
  const question = makeQuestion();

  it("complete correct flow through all levels ending in pass", () => {
    // L1: answer correctly -> confidence
    let result = handleAnswer(question.level1.answer, question.level1, 1);
    expect(result.phase).toBe("confidence");

    // Confident -> advance to L2
    let levelResult = handleConfidence(true, 1);
    expect(levelResult.newLevel).toBe(2);

    // L2: answer correctly -> confidence
    result = handleAnswer(question.level2.answer, question.level2, 2);
    expect(result.phase).toBe("confidence");

    // Confident -> advance to L3
    levelResult = handleConfidence(true, 2);
    expect(levelResult.newLevel).toBe(3);

    // L3: answer correctly -> explain
    result = handleAnswer(question.level3.answer, question.level3, 3);
    expect(result.phase).toBe("explain");

    // Evaluation passes
    const passed = evaluateResult({ english: { score: 4 }, concepts: { score: 3 } });
    expect(passed).toBe(true);
  });

  it("complete correct flow through all levels ending in fail", () => {
    // L1 -> L2 -> L3 -> explain
    let result = handleAnswer(question.level1.answer, question.level1, 1);
    expect(result.phase).toBe("confidence");
    handleConfidence(true, 1);

    result = handleAnswer(question.level2.answer, question.level2, 2);
    expect(result.phase).toBe("confidence");
    handleConfidence(true, 2);

    result = handleAnswer(question.level3.answer, question.level3, 3);
    expect(result.phase).toBe("explain");

    // Evaluation fails
    const passed = evaluateResult({ english: { score: 2 }, concepts: { score: 4 } });
    expect(passed).toBe(false);
  });
});
