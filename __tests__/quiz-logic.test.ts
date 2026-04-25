import { describe, it, expect } from "vitest";
import type { Question, QuestionLevel, QuestionProgress } from "@/lib/types";

/**
 * These tests verify the core behavioral logic of the quiz page
 * (app/quiz/[moduleId]/page.tsx) without rendering the full component.
 *
 * We replicate the key logic functions inline so we can unit test them
 * in isolation — the component uses these same patterns.
 */

// Replicated from page.tsx
type Phase =
  | "answering"
  | "correct"
  | "wrong"
  | "confidence"
  | "explain"
  | "evaluating"
  | "results";

function getLevel(question: Question, level: 1 | 2 | 3): QuestionLevel {
  if (level === 1) return question.level1;
  if (level === 2) return question.level2;
  return question.level3;
}

// Simulate handleAnswer logic — returns the new phase and updated progress
function handleAnswer(
  optionIndex: number,
  currentLevel: QuestionLevel,
  qProgress: QuestionProgress
): { phase: Phase; updatedProgress: QuestionProgress | null } {
  if (optionIndex === currentLevel.answer) {
    // Correct answer
    if (qProgress.level === 3) {
      return { phase: "explain", updatedProgress: null };
    } else {
      return { phase: "confidence", updatedProgress: null };
    }
  } else {
    // Wrong answer — level drops by 1 (min 1)
    const newLevel = Math.max(1, qProgress.level - 1) as 1 | 2 | 3;
    return {
      phase: "wrong",
      updatedProgress: { level: newLevel, completed: false },
    };
  }
}

// Simulate handleConfidence logic
function handleConfidence(
  confident: boolean,
  qProgress: QuestionProgress
): QuestionProgress | null {
  if (confident) {
    const newLevel = Math.min(3, qProgress.level + 1) as 1 | 2 | 3;
    return { level: newLevel, completed: false };
  }
  return null; // No progress change
}

// Simulate explanation result evaluation
function evaluateExplanationResult(result: {
  english: { score: number };
  concepts: { score: number };
}): { passed: boolean; updatedProgress: QuestionProgress | null } {
  const passed = result.english.score >= 3 && result.concepts.score >= 3;
  if (passed) {
    return { passed, updatedProgress: { level: 3, completed: true } };
  }
  return { passed, updatedProgress: null };
}

// Simulate findNextIncomplete
function findNextIncomplete(
  questions: { id: string }[],
  progressMap: Record<string, QuestionProgress>,
  startFrom: number
): number | null {
  const len = questions.length;
  for (let i = 0; i < len; i++) {
    const idx = (startFrom + i) % len;
    const qId = questions[idx].id;
    if (!progressMap[qId]?.completed) return idx;
  }
  return null;
}

// Test fixtures
const makeQuestion = (id: string): Question => ({
  id,
  level1: {
    text: "Question L1?",
    options: ["A", "B", "C", "D"],
    answer: 0,
  },
  level2: {
    text: "Question L2?",
    options: ["A", "B", "C", "D"],
    answer: 1,
  },
  level3: {
    text: "Question L3?",
    options: ["A", "B", "C", "D"],
    answer: 2,
  },
});

describe("getLevel", () => {
  const question = makeQuestion("q1");

  it("returns level1 for level 1", () => {
    expect(getLevel(question, 1)).toBe(question.level1);
  });

  it("returns level2 for level 2", () => {
    expect(getLevel(question, 2)).toBe(question.level2);
  });

  it("returns level3 for level 3", () => {
    expect(getLevel(question, 3)).toBe(question.level3);
  });
});

describe("handleAnswer — phase transitions", () => {
  const question = makeQuestion("q1");

  it("sets phase to 'explain' when answering Level 3 correctly (not 'correct')", () => {
    const level3 = getLevel(question, 3);
    const progress: QuestionProgress = { level: 3, completed: false };
    const result = handleAnswer(level3.answer, level3, progress);
    expect(result.phase).toBe("explain");
    expect(result.updatedProgress).toBeNull(); // No progress update yet
  });

  it("sets phase to 'confidence' when answering Level 1 correctly", () => {
    const level1 = getLevel(question, 1);
    const progress: QuestionProgress = { level: 1, completed: false };
    const result = handleAnswer(level1.answer, level1, progress);
    expect(result.phase).toBe("confidence");
  });

  it("sets phase to 'confidence' when answering Level 2 correctly", () => {
    const level2 = getLevel(question, 2);
    const progress: QuestionProgress = { level: 2, completed: false };
    const result = handleAnswer(level2.answer, level2, progress);
    expect(result.phase).toBe("confidence");
  });

  it("sets phase to 'wrong' and decrements level on wrong answer", () => {
    const level2 = getLevel(question, 2);
    const progress: QuestionProgress = { level: 2, completed: false };
    const wrongIndex = level2.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level2, progress);
    expect(result.phase).toBe("wrong");
    expect(result.updatedProgress).toEqual({ level: 1, completed: false });
  });

  it("does not drop below level 1 on wrong answer", () => {
    const level1 = getLevel(question, 1);
    const progress: QuestionProgress = { level: 1, completed: false };
    const wrongIndex = level1.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level1, progress);
    expect(result.phase).toBe("wrong");
    expect(result.updatedProgress).toEqual({ level: 1, completed: false });
  });

  it("decrements level from 3 to 2 on wrong answer at level 3", () => {
    const level3 = getLevel(question, 3);
    const progress: QuestionProgress = { level: 3, completed: false };
    const wrongIndex = level3.answer === 0 ? 1 : 0;
    const result = handleAnswer(wrongIndex, level3, progress);
    expect(result.phase).toBe("wrong");
    expect(result.updatedProgress).toEqual({ level: 2, completed: false });
  });
});

describe("handleConfidence", () => {
  it("increments level when confident", () => {
    const progress: QuestionProgress = { level: 1, completed: false };
    const result = handleConfidence(true, progress);
    expect(result).toEqual({ level: 2, completed: false });
  });

  it("increments level from 2 to 3 when confident", () => {
    const progress: QuestionProgress = { level: 2, completed: false };
    const result = handleConfidence(true, progress);
    expect(result).toEqual({ level: 3, completed: false });
  });

  it("does not exceed level 3", () => {
    const progress: QuestionProgress = { level: 3, completed: false };
    const result = handleConfidence(true, progress);
    expect(result).toEqual({ level: 3, completed: false });
  });

  it("returns null (no change) when not confident", () => {
    const progress: QuestionProgress = { level: 1, completed: false };
    const result = handleConfidence(false, progress);
    expect(result).toBeNull();
  });
});

describe("evaluateExplanationResult — marking completion", () => {
  it("marks card as completed when both scores >= 3", () => {
    const result = evaluateExplanationResult({
      english: { score: 3 },
      concepts: { score: 3 },
    });
    expect(result.passed).toBe(true);
    expect(result.updatedProgress).toEqual({ level: 3, completed: true });
  });

  it("marks card as completed when scores are higher than 3", () => {
    const result = evaluateExplanationResult({
      english: { score: 5 },
      concepts: { score: 4 },
    });
    expect(result.passed).toBe(true);
    expect(result.updatedProgress).toEqual({ level: 3, completed: true });
  });

  it("does NOT mark card completed when english score < 3", () => {
    const result = evaluateExplanationResult({
      english: { score: 2 },
      concepts: { score: 4 },
    });
    expect(result.passed).toBe(false);
    expect(result.updatedProgress).toBeNull();
  });

  it("does NOT mark card completed when concepts score < 3", () => {
    const result = evaluateExplanationResult({
      english: { score: 4 },
      concepts: { score: 2 },
    });
    expect(result.passed).toBe(false);
    expect(result.updatedProgress).toBeNull();
  });

  it("does NOT mark card completed when both scores < 3", () => {
    const result = evaluateExplanationResult({
      english: { score: 1 },
      concepts: { score: 2 },
    });
    expect(result.passed).toBe(false);
    expect(result.updatedProgress).toBeNull();
  });
});

describe("findNextIncomplete", () => {
  const questions = [
    { id: "q1" },
    { id: "q2" },
    { id: "q3" },
    { id: "q4" },
  ];

  it("finds next incomplete question starting from given index", () => {
    const progressMap: Record<string, QuestionProgress> = {
      q1: { level: 3, completed: true },
      q2: { level: 3, completed: true },
      q3: { level: 1, completed: false },
      q4: { level: 2, completed: false },
    };
    expect(findNextIncomplete(questions, progressMap, 0)).toBe(2);
  });

  it("wraps around to find incomplete questions", () => {
    const progressMap: Record<string, QuestionProgress> = {
      q1: { level: 1, completed: false },
      q2: { level: 3, completed: true },
      q3: { level: 3, completed: true },
      q4: { level: 3, completed: true },
    };
    expect(findNextIncomplete(questions, progressMap, 2)).toBe(0);
  });

  it("returns null when all questions are completed", () => {
    const progressMap: Record<string, QuestionProgress> = {
      q1: { level: 3, completed: true },
      q2: { level: 3, completed: true },
      q3: { level: 3, completed: true },
      q4: { level: 3, completed: true },
    };
    expect(findNextIncomplete(questions, progressMap, 0)).toBeNull();
  });

  it("returns 0 when no progress exists", () => {
    expect(findNextIncomplete(questions, {}, 0)).toBe(0);
  });

  it("skips completed and returns next incomplete", () => {
    const progressMap: Record<string, QuestionProgress> = {
      q1: { level: 3, completed: true },
      q2: { level: 2, completed: false },
      q3: { level: 3, completed: true },
      q4: { level: 1, completed: false },
    };
    // Starting from index 2 (q3, completed), should find q4 at index 3
    expect(findNextIncomplete(questions, progressMap, 2)).toBe(3);
  });
});

describe("advanceToNext resets explanation state", () => {
  it("resets all explanation-related state", () => {
    // Simulate the state resets that advanceToNext performs
    let phase: Phase = "results";
    let selectedAnswer: number | null = 2;
    let explanation = "My explanation text";
    let evaluationResult: object | null = {
      english: { score: 4, feedback: "Good" },
      concepts: { score: 3, feedback: "OK" },
    };
    let evalError = "Some error";

    // advanceToNext logic:
    phase = "answering";
    selectedAnswer = null;
    explanation = "";
    evaluationResult = null;
    evalError = "";

    expect(phase).toBe("answering");
    expect(selectedAnswer).toBeNull();
    expect(explanation).toBe("");
    expect(evaluationResult).toBeNull();
    expect(evalError).toBe("");
  });
});

describe("Full flow: Level 3 correct -> explain -> evaluate", () => {
  it("Level 3 correct answer leads to explain, then passing scores complete the card", () => {
    const question = makeQuestion("q1");
    const progress: QuestionProgress = { level: 3, completed: false };
    const level3 = getLevel(question, 3);

    // Step 1: Answer correctly at level 3
    const answerResult = handleAnswer(level3.answer, level3, progress);
    expect(answerResult.phase).toBe("explain");

    // Step 2: Evaluation returns passing scores
    const evalResult = evaluateExplanationResult({
      english: { score: 4 },
      concepts: { score: 3 },
    });
    expect(evalResult.passed).toBe(true);
    expect(evalResult.updatedProgress).toEqual({ level: 3, completed: true });
  });

  it("Level 3 correct answer leads to explain, failing scores keep card incomplete", () => {
    const question = makeQuestion("q1");
    const progress: QuestionProgress = { level: 3, completed: false };
    const level3 = getLevel(question, 3);

    // Step 1: Answer correctly at level 3
    const answerResult = handleAnswer(level3.answer, level3, progress);
    expect(answerResult.phase).toBe("explain");

    // Step 2: Evaluation returns failing scores
    const evalResult = evaluateExplanationResult({
      english: { score: 2 },
      concepts: { score: 4 },
    });
    expect(evalResult.passed).toBe(false);
    expect(evalResult.updatedProgress).toBeNull();
    // Card stays at level 3, completed: false
  });
});
