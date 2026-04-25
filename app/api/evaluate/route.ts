import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

const KB_ID = "FCF1GEJPXT";
const REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "us-west-2";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3-haiku";

const SYSTEM_PROMPT =
  "You are a STRICT AND RIGOROUS evaluator and tutor for security guard exam preparation. " +
  "You will receive reference material from the ABST modules, an exam question, " +
  "the correct answer, and a candidate's explanation of why that answer is correct.\n\n" +
  "Evaluate the candidate rigorously on two dimensions. HARSHLY PENALIZE low-effort answers. " +
  "If the candidate writes 'idk', 'I don't know', or gives a one-word lazy answer, they MUST receive a score of 1 for both categories.\n\n" +
  "1. **English Proficiency (1-5):** Assess grammar, sentence structure, spelling, " +
  "and overall clarity. A score of 3 means acceptable with minor errors.\n\n" +
  "2. **Conceptual Understanding (1-5):** Assess whether the candidate demonstrates " +
  "correct concepts and uses proper ABST terminology. A score of 3 means the core " +
  "concept is understood with mostly correct terminology.\n\n" +
  "3. **Teaching (MANDATORY — this is the most important field):** " +
  "Regardless of the candidate's answer quality, you MUST use the provided reference material " +
  "to explain the correct answer and the underlying concept. " +
  "Start by stating what the correct answer is and WHY it is correct, " +
  "citing specific facts, rules, or definitions from the ABST reference material. " +
  "Then, if the candidate got something wrong, explain what was wrong about their reasoning. " +
  "If their answer was good, explain how it could be even more precise using ABST terminology. " +
  "This field must ALWAYS contain a real explanation from the reference material — never leave it vague.\n\n" +
  "Please limit your total feedback text to a maximum of 350 words.\n\n" +
  "You MUST respond with ONLY valid JSON in exactly this format — no extra text, " +
  "no markdown fences:\n" +
  '{"english":{"score":N,"feedback":"..."},"concepts":{"score":N,"feedback":"..."},"teaching":"..."}';

if (!OPENROUTER_API_KEY) {
  console.warn("⚠️ OPENROUTER_API_KEY not found in env variables! Evaluate will fail unless you set it in .env.local");
}

const agentClient = new BedrockAgentRuntimeClient({ region: REGION });

async function retrieveContext(query: string): Promise<string> {
  try {
    const command = new RetrieveCommand({
      knowledgeBaseId: KB_ID,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: 5 },
      },
    });
    const response = await agentClient.send(command);
    const results = response.retrievalResults ?? [];
    if (results.length === 0) return "(Reference material unavailable)";

    const chunks: string[] = [];
    results.forEach((result, i) => {
      const text = result.content?.text?.trim();
      if (text) chunks.push(`[Reference ${i + 1}]\n${text}`);
    });

    return chunks.length > 0 ? chunks.join("\n\n") : "(Reference material unavailable)";
  } catch (err) {
    console.error("KB retrieval failed:", err);
    return "(Reference material unavailable)";
  }
}

async function evaluate(
  reference: string,
  question: string,
  correctAnswer: string,
  explanation: string
) {
  const userMessage =
    `## Reference Material from ABST Manual\n${reference}\n\n` +
    `## Exam Question\n${question}\n\n` +
    `## Correct Answer\n${correctAnswer}\n\n` +
    `## Candidate's Explanation\n${explanation}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`OpenRouter API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  let assistantText = data.choices[0].message.content.trim();

  // Strip markdown fences in case the model returns them despite the prompt
  assistantText = assistantText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/i, "").trim();

  const jsonMatch = assistantText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("LLM response did not contain valid JSON");

  return JSON.parse(jsonMatch[0]);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { questionText, correctAnswer, userExplanation } = body;

    if (!questionText || !correctAnswer || !userExplanation) {
      return Response.json(
        { error: "Missing required fields: questionText, correctAnswer, userExplanation" },
        { status: 400 }
      );
    }

    const searchQuery = `${questionText} ${correctAnswer}`;
    const reference = await retrieveContext(searchQuery);
    const result = await evaluate(reference, questionText, correctAnswer, userExplanation);

    return Response.json(result);
  } catch (error) {
    console.error("Evaluation error:", error);
    return Response.json(
      { error: `Evaluation failed: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
