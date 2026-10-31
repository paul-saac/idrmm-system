import "server-only";

export type AIResponseMode = "strict" | "best_effort" | "json_object" | "text";
export type AIProvider = {
  id: "groq" | "azure-foundry";
  name: string;
  endpoint: string;
  apiKey: string;
  textModel: string;
  visionModel: string | null;
  apiStyle: "openai" | "inference";
  responseMode: AIResponseMode;
  maxOutputTokens: number;
};

/** Server-only credentials. Selecting Azure never falls back to another vendor. */
export function getAIProvider(env: NodeJS.ProcessEnv = process.env): AIProvider {
  const selected = env.AI_PROVIDER?.trim() || "groq";
  if (selected === "groq") {
    const apiKey = env.GROQ_API_KEY?.trim();
    if (!apiKey) throw new Error("AI is not configured. Add GROQ_API_KEY or configure Azure Foundry on the server.");
    return { id:"groq",name:"Groq",endpoint:"https://api.groq.com/openai/v1/chat/completions",apiKey,
      textModel:"openai/gpt-oss-20b",visionModel:"qwen/qwen3.8-27b",apiStyle:"openai",responseMode:"strict",maxOutputTokens:8192 };
  }
  if (selected !== "azure-foundry") throw new Error("AI_PROVIDER must be groq or azure-foundry.");
  const apiKey = env.AZURE_AI_API_KEY?.trim();
  const textModel = env.AZURE_AI_MODEL?.trim();
  if (!apiKey || !textModel || !env.AZURE_AI_ENDPOINT?.trim()) {
    throw new Error("Azure AI is not configured. Set AZURE_AI_ENDPOINT, AZURE_AI_API_KEY and AZURE_AI_MODEL on the server.");
  }
  let url: URL;
  try { url = new URL(env.AZURE_AI_ENDPOINT.trim()); }
  catch { throw new Error("AZURE_AI_ENDPOINT must be the Azure model resource's HTTPS endpoint."); }
  const hosts = [".services.ai.azure.com", ".openai.azure.com", ".cognitiveservices.azure.com", ".models.ai.azure.com", ".inference.ai.azure.com"];
  if (url.protocol !== "https:" || !hosts.some(suffix=>url.hostname.endsWith(suffix)) || url.username || url.password || url.search || url.hash || (url.port && url.port !== "443")) {
    throw new Error("AZURE_AI_ENDPOINT must be an Azure AI HTTPS endpoint, without credentials, query parameters or fragments.");
  }
  const pathname = url.pathname.replace(/\/+$/, "");
  const apiStyle = env.AZURE_AI_API_STYLE?.trim() || (pathname.startsWith("/openai/v1") || url.hostname.endsWith(".openai.azure.com") ? "openai" : "inference");
  if (apiStyle !== "openai" && apiStyle !== "inference") throw new Error("AZURE_AI_API_STYLE must be inference or openai.");
  const allowedPaths = apiStyle === "openai" ? ["", "/openai/v1", "/openai/v1/chat/completions"] : ["", "/models", "/models/chat/completions", "/chat/completions"];
  if (!allowedPaths.includes(pathname)) throw new Error("Use the Azure model resource endpoint, not the Foundry portal or project URL.");
  if (apiStyle === "openai") url.pathname = "/openai/v1/chat/completions";
  else {
    url.pathname = url.hostname.endsWith(".models.ai.azure.com") || url.hostname.endsWith(".inference.ai.azure.com") ? "/chat/completions" : "/models/chat/completions";
    const version = env.AZURE_AI_API_VERSION?.trim() || "2024-05-01-preview";
    if (!/^\d{4}-\d{2}-\d{2}(?:-preview)?$/.test(version)) throw new Error("AZURE_AI_API_VERSION must be a supported Azure inference API version.");
    url.searchParams.set("api-version",version);
  }
  const format = env.AZURE_AI_RESPONSE_FORMAT?.trim() || "json_object";
  if (!["json_schema","json_object","text"].includes(format)) throw new Error("AZURE_AI_RESPONSE_FORMAT must be json_schema, json_object or text.");
  const maxOutputTokens = Number(env.AZURE_AI_MAX_OUTPUT_TOKENS || "4096");
  if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 256 || maxOutputTokens > 8192) throw new Error("AZURE_AI_MAX_OUTPUT_TOKENS must be an integer between 256 and 8192.");
  return {id:"azure-foundry",name:"Azure AI",endpoint:url.toString(),apiKey,textModel,
    visionModel:env.AZURE_AI_VISION_MODEL?.trim() || null,apiStyle,
    responseMode:format === "json_schema" ? "strict" : format as "json_object"|"text",maxOutputTokens};
}

export function aiModel(provider: AIProvider, image = false): string {
  if (image && !provider.visionModel) throw new Error("Image import needs an image-capable Azure deployment configured as AZURE_AI_VISION_MODEL. You can still import a text-based PDF, CSV or Excel file.");
  return image ? provider.visionModel! : provider.textModel;
}

export function aiResponseFormat(mode: AIResponseMode, name: string, schema: object): object | undefined {
  if (mode === "text") return undefined;
  if (mode === "json_object") return {type:"json_object"};
  return {type:"json_schema",json_schema:{name,strict:mode === "strict",schema}};
}

export function nextAIResponseMode(mode: AIResponseMode): AIResponseMode | null {
  return mode === "strict" ? "best_effort" : mode === "best_effort" ? "json_object" : mode === "json_object" ? "text" : null;
}

export function isAIJsonFormatError(body: {error?: {code?: unknown; message?: unknown; param?: unknown}} | null): boolean {
  return body?.error?.code === "json_validate_failed" || body?.error?.param === "response_format" ||
    /failed to generate json|expected schema|response_format|json.schema|json_object|structured.output/i.test(String(body?.error?.message ?? ""));
}

/** Prepare API-specific options without logging keys or placing them in URLs. */
export function aiChatRequest(provider: AIProvider, body: Record<string,unknown>): {url:string;options:RequestInit} {
  const payload = {...body};
  const tokens = Math.min(Number(payload.max_completion_tokens ?? 2500),provider.maxOutputTokens);
  if (provider.id === "azure-foundry") {
    delete payload.reasoning_effort; // Groq's reasoning option is not universal.
    if (provider.apiStyle === "inference") { delete payload.max_completion_tokens; payload.max_tokens=tokens; }
    else payload.max_completion_tokens=tokens;
  } else payload.max_completion_tokens=tokens;
  return {url:provider.endpoint,options:{method:"POST",redirect:"error",
    headers:provider.id === "azure-foundry" ? {"api-key":provider.apiKey,"Content-Type":"application/json"} : {Authorization:`Bearer ${provider.apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify(payload)}};
}
