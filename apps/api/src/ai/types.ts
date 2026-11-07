export interface AiTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface StructuredAiResult<T> {
  value: T;
  model: string;
  usage: AiTokenUsage;
  durationMs: number;
}

export interface StructuredAiProvider {
  generate<T>(input: {
    systemInstruction: string;
    prompt: string;
    schema: unknown;
    validate: (value: unknown) => T;
    model: string;
    timeoutMs: number;
    requestId: string;
  }): Promise<StructuredAiResult<T>>;
}
