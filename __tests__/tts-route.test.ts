import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPollySend } = vi.hoisted(() => ({
  mockPollySend: vi.fn(),
}));

vi.mock("@aws-sdk/client-polly", () => {
  return {
    PollyClient: class {
      send = mockPollySend;
    },
    SynthesizeSpeechCommand: class {
      input: unknown;
      constructor(input: unknown) {
        this.input = input;
      }
    },
    VoiceId: {},
  };
});

import { POST } from "@/app/api/tts/route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost:3000/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as any;
}

describe("POST /api/tts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when text is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/Text is required/);
  });

  it("returns audio/mpeg stream on success", async () => {
    mockPollySend.mockResolvedValueOnce({
      AudioStream: {
        transformToWebStream: () => new ReadableStream(),
      },
    });

    const res = await POST(makeRequest({ text: "Test question text", languageCode: "en-US" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("audio/mpeg");
  });

  it("returns 500 when Polly fails", async () => {
    mockPollySend.mockRejectedValueOnce(new Error("Service unavailable"));

    const res = await POST(makeRequest({ text: "Test" }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toMatch(/Service unavailable/);
  });
});
