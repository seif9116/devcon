import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

const KB_ID = "SBTCWY1W77";
const REGION = process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION || "us-west-2";
const MODEL_ID = "anthropic.claude-sonnet-4-20250514-v1:0";

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
  "3. **Teaching:** ALWAYS provide a teaching explanation. " +
  "If the candidate's explanation has errors or gaps, explain what is wrong and why, " +
  "then explain the correct concept according to the ABST modules. " +
  "If the candidate's explanation is good but not perfect, acknowledge what they got right " +
  "and explain how it could be stronger or more precise. " +
  "If the explanation is excellent, confirm it and add any deeper insight from the modules. " +
  "Reference specific ABST terminology and concepts.\n\n" +
  "You MUST incorporate feedback from the provided module reference material in your explanation. " +
  "Please limit your total feedback text to a maximum of 350 words.\n\n" +
  "You MUST respond with ONLY valid JSON in exactly this format — no extra text, " +
  "no markdown fences:\n" +
  '{"english":{"score":N,"feedback":"..."},"concepts":{"score":N,"feedback":"..."},"teaching":"..."}';

if (!process.env.AWS_ACCESS_KEY_ID) {
  console.warn("⚠️ AWS credentials not found in env variables! TTS and Evaluate will fail unless you exported them or set them in .env.local");
}

const credentialsConfig = process.env.AWS_ACCESS_KEY_ID
  ? {
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN } : {}),
      },
    }
  : {};

const agentClient = new BedrockAgentRuntimeClient({ region: REGION, ...credentialsConfig });
const runtimeClient = new BedrockRuntimeClient({ region: REGION, ...credentialsConfig });

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
  } catch {
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

  const requestBody = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: new TextEncoder().encode(requestBody),
  });

  const response = await runtimeClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  let assistantText = responseBody.content[0].text.trim();
  
  // Strip markdown fences in case Claude returns them despite the prompt
  assistantText = assistantText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/i, "").trim();

  return JSON.parse(assistantText);
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
