import { NextRequest, NextResponse } from "next/server";
import { PollyClient, SynthesizeSpeechCommand, VoiceId } from "@aws-sdk/client-polly";

const pollyClient = new PollyClient({
  region: "us-west-2",
  credentials: {
    accessKeyId: "ASIA6GBMGBROTVS236UB",
    secretAccessKey: "39QBxa9izgCIbmPaQTSgNVNUMUwtH1Hb0hEgkWx+",
    sessionToken: "IQoJb3JpZ2luX2VjENP//////////wEaCXVzLWVhc3QtMSJIMEYCIQDX2tfH0+pkiTBROgkso3DGpMqOSmpTwuPXD1j0mcAH5AIhAITdVbBTff/czyb6GtZE9TX0uc3XeI8s4sS1IGnevxksKqICCJz//////////wEQABoMOTc1MDUwMjQ3MjYxIgy9Jy3DJB4xSHeGGR0q9gHm57CXCxkPjfo2SZNz0MuNpliBeYqEO8GpVocPRmWOV8orTU2hsYQu7TZYWPTmu0l9Q6Yi2qmzbDVFKYxkecKZXLquLK8Rqoz+N/75V8/pPfRPxvzjH+U789AdK3HLFYXISG2QdyaYf2c3pG//oBGLXj4vNW3nNk/fVXYOIV8ojzQoZfcvroDR9nEFCEBpzop7gvZBPYB+VhE0+tY51YP1aam+W5Xs5gq0gJczqsChYmhQ30yZsMY/ssWhku6Z/rHBao8F5onYSSrjd8jMvni60fb/H+Aep1QcJej/AGcMF19448tb1Bq/efKxs2ctTQR3yW6W8ikwsp20zwY6nAGD19sMoRqXAK2muWfCBdw8jUE0SaxC6RcNzy76pXWgkMcryNEdaDsZ4ORNcGIo5sgx4m8Hmxac94mIo3sV3J1VzhyYtWZoyX+5nfK0trRtoh1MenZJKOZ6uzjIqP1LK5/6lpjNnft50NGAGNJ9jPUMrdRI8Pd4wiBv0MfgMfw1u6K8ZNtBwdMojNW7QxLc5rgNsTRx7OdlofXHtB8=",
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
