import { NextRequest, NextResponse } from "next/server";
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from "@aws-sdk/client-polly";

const pollyClient = new PollyClient({
  region: "us-west-2",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  },
});

export async function POST(req: NextRequest) {
  try {
    const { text, languageCode } = await req.json();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    let voiceId: VoiceId = "Joanna";
    if (languageCode?.startsWith("fr")) {
      voiceId = "Lea"; // French female voice
    }

    const command = new SynthesizeSpeechCommand({
      Engine: "neural",
      LanguageCode: languageCode?.startsWith("fr") ? "fr-FR" : "en-US",
      OutputFormat: "mp3",
      Text: text,
      TextType: "text",
      VoiceId: voiceId,
    });

    const response = await pollyClient.send(command);

    if (response.AudioStream) {
      const webStream = response.AudioStream.transformToWebStream();
      return new NextResponse(webStream as any, {
        headers: {
          "Content-Type": "audio/mpeg",
        },
      });
    }

    return NextResponse.json(
      { error: "AudioStream is unexpectedly empty." },
      { status: 500 }
    );
  } catch (error: any) {
    console.error("Polly Error:", error);
    return NextResponse.json(
      { error: error?.message || "Error generating speech" },
      { status: 500 }
    );
  }
}
