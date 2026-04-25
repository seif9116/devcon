import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAgentSend } = vi.hoisted(() => ({
  mockAgentSend: vi.fn(),
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

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

function mockOpenRouterSuccess(result = mockEvalResult) {
  mockFetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(result) } }],
      }),
      { status: 200 }
    )
  );
}

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
    mockOpenRouterSuccess();

    await POST(makeRequest(validBody));

    expect(mockAgentSend).toHaveBeenCalledOnce();
    const retrieveCall = mockAgentSend.mock.calls[0][0];
    expect(retrieveCall.input.knowledgeBaseId).toBe("SBTCWY1W77");
    expect(retrieveCall.input.retrievalQuery.text).toBe(
      `${validBody.questionText} ${validBody.correctAnswer}`
    );
  });

  it("calls OpenRouter with correct URL and auth", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Some reference" } }],
    });
    mockOpenRouterSuccess();

    await POST(makeRequest(validBody));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("returns parsed evaluation result on success", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Reference material" } }],
    });
    mockOpenRouterSuccess();

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual(mockEvalResult);
    expect(data.english.score).toBe(4);
    expect(data.concepts.score).toBe(3);
  });

  // --- Error handling ---

  it("returns 500 when OpenRouter call fails", async () => {
    mockAgentSend.mockResolvedValueOnce({
      retrievalResults: [{ content: { text: "Reference" } }],
    });
    mockFetch.mockResolvedValueOnce(
      new Response("Service unavailable", { status: 503 })
    );

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Evaluation failed/);
  });

  it("handles KB retrieval failure gracefully and continues", async () => {
    mockAgentSend.mockRejectedValueOnce(new Error("KB unavailable"));
    mockOpenRouterSuccess();

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, options] = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(options.body);
    const userMessage = requestBody.messages[1].content;
    expect(userMessage).toContain("(Reference material unavailable)");
  });

  it("handles empty KB results gracefully", async () => {
    mockAgentSend.mockResolvedValueOnce({ retrievalResults: [] });
    mockOpenRouterSuccess();

    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(200);

    const [, options] = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(options.body);
    const userMessage = requestBody.messages[1].content;
    expect(userMessage).toContain("(Reference material unavailable)");
  });
});
