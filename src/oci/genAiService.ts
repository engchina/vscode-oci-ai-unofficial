import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";

export class GenAiService {
  constructor(private readonly factory: OciClientFactory) {}

  public async chat(prompt: string): Promise<string> {
    const modelId = vscode.workspace.getConfiguration("ociAi").get<string>("genAiModelId", "").trim();
    if (!modelId) {
      return "Set `ociAi.genAiModelId` to call OCI Generative AI. Returning local echo for now.\n\n" + prompt;
    }

    try {
      const module = await import("oci-generativeaiinference");
      const client = new (module as any).GenerativeAiInferenceClient({
        authenticationDetailsProvider: this.factory.createAuthenticationProvider()
      });

      const region = vscode.workspace.getConfiguration("ociAi").get<string>("region", "").trim();
      if (region) {
        client.region = region;
      }

      const request = {
        chatDetails: {
          compartmentId: this.factory.getCompartmentId(),
          servingMode: {
            servingType: "ON_DEMAND",
            modelId
          },
          chatRequest: {
            apiFormat: "GENERIC",
            messages: [
              {
                role: "USER",
                content: [
                  {
                    type: "TEXT",
                    text: prompt
                  }
                ]
              }
            ],
            maxTokens: 1024,
            temperature: 0.2
          }
        }
      };

      const response = await client.chat(request);
      const text = extractTextResponse(response);
      return text || "OCI returned an empty response.";
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return `OCI Generative AI call failed. ${detail}`;
    }
  }
}

function extractTextResponse(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }

  const obj = response as Record<string, unknown>;
  const direct = pickString(
    obj["text"],
    path(obj, ["chatResult", "chatResponse", "text"]),
    path(obj, ["chatResponse", "text"]),
    path(obj, ["data", "text"]),
    path(obj, ["data", "outputText"]),
    path(obj, ["chatResult", "chatResponse", "outputText"]),
    path(obj, ["chatResult", "chatResponse", "message", "content", 0, "text"]),
    path(obj, ["chatResponse", "choices", 0, "message", "content", 0, "text"])
  );

  return direct?.trim() ? direct : undefined;
}

function path(value: unknown, segments: Array<string | number>): unknown {
  let current: unknown = value;
  for (const segment of segments) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    if (Array.isArray(current) && typeof segment === "number") {
      current = current[segment];
      continue;
    }

    if (!Array.isArray(current) && typeof segment === "string") {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }

    return undefined;
  }

  return current;
}

function pickString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}
