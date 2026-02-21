import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

export class GenAiService {
  constructor(private readonly factory: OciClientFactory) {}

  public async chatStream(
    messages: ChatMessage[],
    onToken: (token: string) => void
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const modelName =
      cfg.get<string>("genAiLlmModelId", "").trim() || cfg.get<string>("genAiModelId", "").trim();

    if (!modelName) {
      onToken(
        "Set `ociAi.genAiLlmModelId` (model name) to call OCI Generative AI.\n\n" +
          "Echo: " +
          (messages[messages.length - 1]?.text ?? "")
      );
      return;
    }

    const module = await import("oci-generativeaiinference");
    const client = new (module as any).GenerativeAiInferenceClient({
      authenticationDetailsProvider: this.factory.createAuthenticationProvider()
    });

    const region = cfg.get<string>("region", "").trim();
    if (region) {
      client.regionId = region;
    }

    const cleanedHistory = messages
      .map(m => ({ role: m.role, text: m.text.trim() }))
      .filter(m => m.text.length > 0);
    const variants = buildRequestVariants(modelName, cleanedHistory);

    let lastError: unknown;
    let triedVariants: string[] = [];
    for (let i = 0; i < variants.length; i += 1) {
      const variant = variants[i];
      triedVariants.push(variant.name);
      const request = {
        chatDetails: {
          compartmentId: this.factory.getCompartmentId(),
          servingMode: {
            servingType: "ON_DEMAND",
            modelId: modelName
          },
          chatRequest: variant.chatRequest
        }
      };

      try {
        const result = await client.chat(request);

        // Streaming response: ReadableStream<Uint8Array>
        if (result && typeof (result as any).getReader === "function") {
          const tokenCount = await readStream(result as ReadableStream<Uint8Array>, onToken);
          if (tokenCount > 0) {
            return;
          }

          // Retry once in non-stream mode for the same request variant.
          const nonStreamRequest = {
            chatDetails: {
              ...request.chatDetails,
              chatRequest: {
                ...request.chatDetails.chatRequest,
                isStream: false
              }
            }
          };
          const nonStreamResult = await client.chat(nonStreamRequest);
          const fallbackText = extractNonStreamText(nonStreamResult);
          if (fallbackText) {
            onToken(fallbackText);
            return;
          }
        } else {
          const text = extractNonStreamText(result);
          if (text) {
            onToken(text);
            return;
          }
        }
      } catch (error) {
        lastError = error;
        if (i < variants.length - 1 && shouldTryNextVariant(error)) {
          continue;
        }
        throw enrichError(error, triedVariants);
      }
    }

    if (lastError) {
      throw enrichError(lastError, triedVariants);
    }
    onToken("OCI returned an empty response.");
  }
}

type RequestVariant = {
  name: string;
  chatRequest: {
    apiFormat: "GENERIC";
    isStream: boolean;
    messages: any[];
    maxTokens: number;
    temperature: number;
  };
};

function buildRequestVariants(modelName: string, messages: ChatMessage[]): RequestVariant[] {
  const isGoogle = /google|gemini/i.test(modelName);
  const official = buildGenericVariant("official:USER-CHATBOT:text-type", messages, "upper", "text-type");
  const google1 = buildGenericVariant("google:user-model:text-type", messages, "user-model", "text-type");
  const google2 = buildGenericVariant("google:upper:text-type", messages, "upper", "text-type");
  const google3 = buildGenericVariant("google:user-model:text-no-type", messages, "user-model", "text-no-type");
  const generic1 = buildGenericVariant("generic:upper:text-no-type", messages, "upper", "text-no-type");
  const generic2 = buildGenericVariant("generic:user-model:text-type", messages, "user-model", "text-type");

  if (isGoogle) {
    // Google/Gemini models through OCI can reject multi-turn role history; send a single USER
    // message that embeds previous turns as context to keep multi-turn behavior stable.
    const transcript = formatTranscriptPrompt(messages);
    const googleSingleUserUpper = buildSingleUserVariant(
      "google:single-user-transcript:upper:text-type",
      transcript,
      "upper",
      "text-type"
    );
    const googleSingleUserLower = buildSingleUserVariant(
      "google:single-user-transcript:user-model:text-type",
      transcript,
      "user-model",
      "text-type"
    );
    return [googleSingleUserUpper, googleSingleUserLower, official, google1, google2, google3, generic1, generic2];
  }

  return [official, generic1, generic2, google1, google3];
}

function buildGenericVariant(
  name: string,
  messages: ChatMessage[],
  roleStyle: "user-model" | "upper",
  contentStyle: "text-type" | "text-no-type"
): RequestVariant {
  return {
    name,
    chatRequest: {
      apiFormat: "GENERIC",
      isStream: true,
      messages: messages.map(m => ({
        role: mapRoleForVariant(m.role, roleStyle),
        content: toVariantContent(m.text, contentStyle)
      })),
      maxTokens: 1024,
      temperature: 0.2
    }
  };
}

function buildSingleUserVariant(
  name: string,
  prompt: string,
  roleStyle: "user-model" | "upper",
  contentStyle: "text-type" | "text-no-type"
): RequestVariant {
  const role = roleStyle === "upper" ? "USER" : "user";
  return {
    name,
    chatRequest: {
      apiFormat: "GENERIC",
      isStream: true,
      messages: [
        {
          role,
          content: toVariantContent(prompt, contentStyle)
        }
      ],
      maxTokens: 1024,
      temperature: 0.2
    }
  };
}

function formatTranscriptPrompt(messages: ChatMessage[]): string {
  const lines = messages.map(m => {
    const speaker = m.role === "model" ? "Assistant" : "User";
    return `${speaker}: ${m.text}`;
  });
  return [
    "Continue the conversation using the history below and answer the last user message.",
    "",
    ...lines
  ].join("\n");
}

function toVariantContent(
  text: string,
  contentStyle: "text-type" | "text-no-type"
): Array<{ type?: "TEXT"; text: string }> {
  if (contentStyle === "text-type") {
    return [{ type: "TEXT", text }];
  }
  return [{ text }];
}

async function readStream(
  stream: ReadableStream<Uint8Array>,
  onToken: (token: string) => void
): Promise<number> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneFromServer = false;
  let emittedCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const res = processSseLine(line, onToken);
        emittedCount += res.emittedCount;
        doneFromServer = res.done || doneFromServer;
        if (doneFromServer) {
          return emittedCount;
        }
      }
    }

    // Flush remaining decoder/buffer content so the final chunk is not dropped.
    buffer += decoder.decode();
    if (buffer) {
      const lines = buffer.split("\n");
      for (const line of lines) {
        const res = processSseLine(line, onToken);
        emittedCount += res.emittedCount;
        doneFromServer = res.done || doneFromServer;
        if (doneFromServer) {
          return emittedCount;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return emittedCount;
}

function processSseLine(
  line: string,
  onToken: (token: string) => void
): { done: boolean; emittedCount: number } {
  const normalized = line.trimEnd();
  if (!normalized.startsWith("data:")) {
    return { done: false, emittedCount: 0 };
  }
  const data = normalized.slice(5).trim();
  if (!data) {
    return { done: false, emittedCount: 0 };
  }
  if (data === "[DONE]") {
    return { done: true, emittedCount: 0 };
  }
  try {
    const chunk = JSON.parse(data);
    const raw = extractChunkToken(chunk);
    const clean = sanitizeToken(raw);
    if (clean) {
      onToken(clean);
      return { done: false, emittedCount: 1 };
    }
  } catch {
    // skip malformed SSE chunk
  }
  return { done: false, emittedCount: 0 };
}

function extractChunkToken(chunk: any): string {
  const choice = chunk?.choices?.[0];
  const fromChoices =
    choice?.delta?.content ??
    choice?.delta?.text ??
    choice?.text ??
    choice?.message?.content?.[0]?.text ??
    choice?.message?.content?.[0]?.message;
  if (typeof fromChoices === "string") {
    return fromChoices;
  }

  const chatResponse = chunk?.chatResponse;
  if (typeof chatResponse?.text === "string") {
    return chatResponse.text;
  }
  if (typeof chatResponse?.message?.content?.[0]?.text === "string") {
    return chatResponse.message.content[0].text;
  }
  if (typeof chunk?.text === "string") {
    return chunk.text;
  }
  if (typeof chunk?.message?.content?.[0]?.text === "string") {
    return chunk.message.content[0].text;
  }

  return "";
}

function sanitizeToken(token: string): string {
  return token
    .replace(/\\?u258b/gi, "")
    .replace(/▋/g, "")
    .replace(/\u258b/gi, "");
}

function mapRoleForVariant(
  role: ChatMessage["role"],
  style: "user-model" | "upper"
): "user" | "model" | "USER" | "CHATBOT" {
  if (style === "user-model") {
    return role === "model" ? "model" : "user";
  }
  return role === "model" ? "CHATBOT" : "USER";
}

function shouldTryNextVariant(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const msg = raw.toLowerCase();
  return (
    msg.includes("map is not a function") ||
    msg.includes("invalid_argument") ||
    msg.includes("correct format of request") ||
    msg.includes("model input cannot be empty") ||
    msg.includes("valid role") ||
    msg.includes("\"code\": 400") ||
    msg.includes("status code 400")
  );
}

function enrichError(error: unknown, triedVariants: string[]): Error {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const tried = triedVariants.length > 0 ? ` Tried formats: ${triedVariants.join(" -> ")}.` : "";
  return new Error(`${raw}${tried}`);
}

function extractNonStreamText(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  try {
    const chatResponse = ((response as any).chatResult as any)?.chatResponse;
    if (typeof chatResponse?.text === "string" && chatResponse.text.trim()) {
      return chatResponse.text.trim();
    }
    const v2Parts = (chatResponse?.message?.content ?? [])
      .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
      .filter(Boolean);
    if (v2Parts.length > 0) {
      const joined = v2Parts.join("").trim();
      if (joined) {
        return joined;
      }
    }

    const choices: any[] = chatResponse?.choices ?? [];
    const parts: string[] = [];
    for (const choice of choices) {
      if (typeof choice?.text === "string" && choice.text) {
        parts.push(choice.text);
      }
      const content: any[] = choice?.message?.content ?? [];
      for (const c of content) {
        if (c?.type === "TEXT" && typeof c?.text === "string" && c.text) {
          parts.push(c.text);
        }
      }
    }
    const joined = parts.join("").trim();
    return joined || undefined;
  } catch {
    return undefined;
  }
}
