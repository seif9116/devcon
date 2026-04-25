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
const MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";

const SYSTEM_PROMPT =
  "You are a STRICT AND RIGOROUS evaluator for security guard exam preparation. " +
  "You will receive reference material from the ABST modules, an exam question, " +
  "the correct answer, and a candidate's explanation of why that answer is correct.\n\n" +
  "Evaluate the candidate rigorously on two dimensions. HARSHLY PENALIZE low-effort answers. " +
  "If the candidate writes 'idk', 'I don't know', or gives a one-word lazy answer, they MUST receive a score of 1 for both categories.\n\n" +
  "1. **English Proficiency (1-5):** Assess grammar, sentence structure, spelling, " +
  "and overall clarity. A score of 3 means acceptable with minor errors.\n\n" +
  "2. **Conceptual Understanding (1-5):** Assess whether the candidate demonstrates " +
  "correct concepts and uses proper ABST terminology. A score of 3 means the core " +
  "concept is understood with mostly correct terminology.\n\n" +
  "You MUST incorporate feedback from the provided module reference material in your explanation. " +
  "Please limit your total feedback text to a maximum of 350 words.\n\n" +
  "You MUST respond with ONLY valid JSON in exactly this format — no extra text, " +
  "no markdown fences:\n" +
  '{"english":{"score":N,"feedback":"..."},"concepts":{"score":N,"feedback":"..."}}';

if (!process.env.AWS_ACCESS_KEY_ID) {
  console.warn("⚠️ AWS credentials not found in env variables! TTS and Evaluate will fail unless you exported them or set them in .env.local");
}

const credentialsConfig = {
  credentials: {
    accessKeyId: "ASIA6GBMGBROTVS236UB",
    secretAccessKey: "39QBxa9izgCIbmPaQTSgNVNUMUwtH1Hb0hEgkWx+",
    sessionToken: "IQoJb3JpZ2luX2VjENP//////////wEaCXVzLWVhc3QtMSJIMEYCIQDX2tfH0+pkiTBROgkso3DGpMqOSmpTwuPXD1j0mcAH5AIhAITdVbBTff/czyb6GtZE9TX0uc3XeI8s4sS1IGnevxksKqICCJz//////////wEQABoMOTc1MDUwMjQ3MjYxIgy9Jy3DJB4xSHeGGR0q9gHm57CXCxkPjfo2SZNz0MuNpliBeYqEO8GpVocPRmWOV8orTU2hsYQu7TZYWPTmu0l9Q6Yi2qmzbDVFKYxkecKZXLquLK8Rqoz+N/75V8/pPfRPxvzjH+U789AdK3HLFYXISG2QdyaYf2c3pG//oBGLXj4vNW3nNk/fVXYOIV8ojzQoZfcvroDR9nEFCEBpzop7gvZBPYB+VhE0+tY51YP1aam+W5Xs5gq0gJczqsChYmhQ30yZsMY/ssWhku6Z/rHBao8F5onYSSrjd8jMvni60fb/H+Aep1QcJej/AGcMF19448tb1Bq/efKxs2ctTQR3yW6W8ikwsp20zwY6nAGD19sMoRqXAK2muWfCBdw8jUE0SaxC6RcNzy76pXWgkMcryNEdaDsZ4ORNcGIo5sgx4m8Hmxac94mIo3sV3J1VzhyYtWZoyX+5nfK0trRtoh1MenZJKOZ6uzjIqP1LK5/6lpjNnft50NGAGNJ9jPUMrdRI8Pd4wiBv0MfgMfw1u6K8ZNtBwdMojNW7QxLc5rgNsTRx7OdlofXHtB8=",
  },
};

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
    max_tokens: 512,
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
