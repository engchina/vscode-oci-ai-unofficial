import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

const successfulVariantByModel = new Map<string, string>();
const MAX_TRANSCRIPT_TURNS = 12;
const MAX_TRANSCRIPT_CHARS = 6000;

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
    const modelKey = buildModelKey(modelName, region);
    const variants = prioritizeVariants(
      buildRequestVariants(modelName, cleanedHistory),
      successfulVariantByModel.get(modelKey)
    );

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
            rememberSuccessfulVariant(modelKey, variant.name);
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
            rememberSuccessfulVariant(modelKey, variant.name);
            onToken(fallbackText);
            return;
          }
        } else {
          const text = extractNonStreamText(result);
          if (text) {
            rememberSuccessfulVariant(modelKey, variant.name);
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
  chatRequest: GenericChatRequestPayload;
};

type ModelFamily = "google" | "xai" | "meta" | "generic";

type GenericChatMessage = {
  role: "USER" | "ASSISTANT";
  content: Array<{ type: "TEXT"; text: string }>;
};

type GenericChatRequestPayload = {
  apiFormat: "GENERIC";
  isStream: boolean;
  messages: GenericChatMessage[];
  maxTokens: number;
  temperature: number;
  topK?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
};

function buildModelKey(modelName: string, region: string): string {
  return `${region || "auto"}::${modelName.toLowerCase()}`;
}

function prioritizeVariants(variants: RequestVariant[], preferredName?: string): RequestVariant[] {
  if (!preferredName) {
    return variants;
  }
  const idx = variants.findIndex(v => v.name === preferredName);
  if (idx <= 0) {
    return variants;
  }
  const preferred = variants[idx];
  return [preferred, ...variants.slice(0, idx), ...variants.slice(idx + 1)];
}

function rememberSuccessfulVariant(modelKey: string, variantName: string): void {
  successfulVariantByModel.set(modelKey, variantName);
}

function buildRequestVariants(modelName: string, messages: ChatMessage[]): RequestVariant[] {
  const family = detectModelFamily(modelName);
  const primary = buildRoleHistoryVariant(`${family}:role-history`, family, messages);
  const transcript = buildSingleUserTranscriptVariant(`${family}:single-user-transcript`, family, messages);
  return [primary, transcript];
}

function detectModelFamily(modelName: string): ModelFamily {
  const normalized = modelName.toLowerCase();
  if (normalized.includes("google") || normalized.includes("gemini")) {
    return "google";
  }
  if (normalized.includes("xai") || normalized.includes("xar") || normalized.includes("grok")) {
    return "xai";
  }
  if (normalized.includes("meta") || normalized.includes("llama")) {
    return "meta";
  }
  return "generic";
}

function buildRoleHistoryVariant(
  name: string,
  family: ModelFamily,
  messages: ChatMessage[],
): RequestVariant {
  return {
    name,
    chatRequest: buildGenericChatPayload(
      family,
      messages.map(toGenericChatMessage)
    )
  };
}

function buildSingleUserTranscriptVariant(
  name: string,
  family: ModelFamily,
  messages: ChatMessage[]
): RequestVariant {
  const prompt = formatTranscriptPrompt(messages);
  return {
    name,
    chatRequest: buildGenericChatPayload(family, [
      {
        role: "USER",
        content: toTextContent(prompt)
      }
    ])
  };
}

function formatTranscriptPrompt(messages: ChatMessage[]): string {
  const sliced = messages.slice(-MAX_TRANSCRIPT_TURNS);
  const lines = sliced.map(m => {
    const speaker = m.role === "model" ? "Assistant" : "User";
    return `${speaker}: ${m.text}`;
  });

  // Keep the newest turns under a bounded size to avoid token/cost blow-up.
  const bounded: string[] = [];
  let usedChars = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    const cost = line.length + 1;
    if (bounded.length > 0 && usedChars + cost > MAX_TRANSCRIPT_CHARS) {
      break;
    }
    bounded.push(line);
    usedChars += cost;
  }
  bounded.reverse();

  return [
    "Continue the conversation using the history below and answer the last user message.",
    "",
    ...bounded
  ].join("\n");
}

function toGenericChatMessage(message: ChatMessage): GenericChatMessage {
  // OCI Generic chat message roles align with USER/ASSISTANT (not CHATBOT).
  return {
    role: message.role === "model" ? "ASSISTANT" : "USER",
    content: toTextContent(message.text)
  };
}

function toTextContent(text: string): Array<{ type: "TEXT"; text: string }> {
  return [{ type: "TEXT", text }];
}

function buildGenericChatPayload(
  family: ModelFamily,
  messages: GenericChatMessage[]
): GenericChatRequestPayload {
  return {
    apiFormat: "GENERIC",
    isStream: true,
    messages,
    maxTokens: 1024,
    ...buildFamilyGenerationParams(family)
  };
}

function buildFamilyGenerationParams(
  family: ModelFamily
): Omit<GenericChatRequestPayload, "apiFormat" | "isStream" | "messages" | "maxTokens"> {
  switch (family) {
    case "xai":
      return {
        temperature: 1,
        topK: 0,
        topP: 1
      };
    case "meta":
      return {
        temperature: 1,
        topP: 0.75,
        frequencyPenalty: 0,
        presencePenalty: 0
      };
    case "google":
      return {
        temperature: 1
      };
    default:
      return {
        temperature: 0.2
      };
  }
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

function shouldTryNextVariant(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  const msg = raw.toLowerCase();
  return (
    msg.includes("failed to deserialize") ||
    msg.includes("deserialize the json body") ||
    msg.includes("missing field `role`") ||
    msg.includes("missing field 'role'") ||
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
