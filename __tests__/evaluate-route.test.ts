import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted ensures these are available when vi.mock factories run (hoisted above imports)
const { mockAgentSend, mockRuntimeSend } = vi.hoisted(() => ({
  mockAgentSend: vi.fn(),
  mockRuntimeSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-bedrock-agent-runtime", () => {
  return {
    BedrockAgentRuntimeClient: class {
      send = mockAgentSend;
    },
    RetrieveCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

vi.mock("@aws-sdk/client-bedrock-runtime", () => {
  return {
    BedrockRuntimeClient: class {
      send = mockRuntimeSend;
    },
    InvokeModelCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
  };
});

import { POST } from "@/app/api/evaluate/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  questionText: "What is the primary duty of a security guard?",
  correctAnswer: "Protection of property",
  userExplanation:
    "The primary duty is protection of property because the ABST manual states...",
};

const mockEvalResult = {
  english: { score: 4, feedback: "Good grammar and clarity." },
  concepts: { score: 3, feedback: "Core concept understood." },
};

describe("POST /api/evaluate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- 400 validation tests ---

  it("returns 400 when body is empty object", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Missing required fields/);
  });

  it("returns 400 when questionText is missing", async () => {
    const { questionText, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it("returns 400 when correctAnswer is missing", async () => {
    const { correctAnswer, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  it("returns 400 when userExplanation is missing", async () => {
    const { userExplanation, ...rest } = validBody;
    const res = await POST(makeRequest(rest));
    expect(res.status).toBe(400);
  });

  // --- Success path ---

  it("calls retrieve with correct KB ID and query", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [
        { content: { text: "Reference chunk 1" } },
        { content: { text: "Reference chunk 2" } },
      ],
    });
    mockRuntimeSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: JSON.stringify(mockEvalResult) }],
        })
      ),
    });

    await POST(makeRequest(validBody));

    // Verify RetrieveCommand was called
    expect(mockAgentSend).toHaveBeenCalledOnce();
    const retrieveCall = mockAgentSend.mock.calls[0][0];
    expect(retrieveCall.input.knowledgeBaseId).toBe("SBTCWY1W77");
    expect(retrieveCall.input.retrievalQuery.text).toBe(
      `${validBody.questionText} ${validBody.correctAnswer}`
    );
  });

  it("calls invoke model with correct model ID", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Some reference" } }],
    });
    mockRuntimeSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: JSON.stringify(mockEvalResult) }],
        })
      ),
    });

    await POST(makeRequest(validBody));

    expect(mockRuntimeSend).toHaveBeenCalledOnce();
    const invokeCall = mockRuntimeSend.mock.calls[0][0];
    expect(invokeCall.input.modelId).toBe("us.anthropic.claude-opus-4-6-v1");
  });

  it("returns parsed evaluation result on success", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Reference material" } }],
    });
    mockRuntimeSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: JSON.stringify(mockEvalResult) }],
        })
      ),
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockEvalResult);
    expect(data.english.score).toBe(4);
    expect(data.concepts.score).toBe(3);
    expect(data.english.feedback).toBe("Good grammar and clarity.");
    expect(data.concepts.feedback).toBe("Core concept understood.");
  });

  // --- Error handling ---

  it("returns 500 when Bedrock invoke model fails", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Reference" } }],
    });
    mockRuntimeSend.mockRejectedValueOnce(new Error("Bedrock unavailable"));

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Evaluation failed/);
  });

  it("handles KB retrieval failure gracefully and continues", async () => {
    // KB retrieval fails — should use fallback text
    mockAgentSend.mockRejectedValueOnce(new Error("KB unavailable"));
    // Model call still succeeds
    mockRuntimeSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: JSON.stringify(mockEvalResult) }],
        })
      ),
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);

    // Verify the model was still called (fallback text used)
    expect(mockRuntimeSend).toHaveBeenCalledOnce();
    const invokeCall = mockRuntimeSend.mock.calls[0][0];
    const requestBody = JSON.parse(
      new TextDecoder().decode(invokeCall.input.body)
    );
    const userMessage = requestBody.messages[0].content;
    expect(userMessage).toContain("(Reference material unavailable)");
  });

  it("handles empty KB results gracefully", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [],
    });
    mockRuntimeSend.mockResolvedValueOnce({
      body: new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: JSON.stringify(mockEvalResult) }],
        })
      ),
    });

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);

    // Verify fallback text was used
    const invokeCall = mockRuntimeSend.mock.calls[0][0];
    const requestBody = JSON.parse(
      new TextDecoder().decode(invokeCall.input.body)
    );
    const userMessage = requestBody.messages[0].content;
    expect(userMessage).toContain("(Reference material unavailable)");
  });
});
