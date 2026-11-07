import { GoogleGenAI } from '@google/genai';
import { pino } from 'pino';
import type { StructuredAiProvider, StructuredAiResult, AiTokenUsage } from '../types.js';

const logger = pino({ name: 'gemini-provider' });

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '');
    cleaned = cleaned.replace(/\s*```$/i, '');
  }
  return cleaned.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiProvider implements StructuredAiProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generate<T>(input: {
    systemInstruction: string;
    prompt: string;
    schema: unknown;
    validate: (value: unknown) => T;
    model: string;
    timeoutMs: number;
    requestId: string;
  }): Promise<StructuredAiResult<T>> {
    const startTime = Date.now();
    let attempt = 0;
    const maxAttempts = 3;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt++;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), input.timeoutMs);

      try {
        const response = await this.ai.models.generateContent({
          model: input.model,
          contents: input.prompt,
          config: {
            systemInstruction: input.systemInstruction,
            responseMimeType: 'application/json',
            responseJsonSchema: input.schema,
            temperature: 0.1,
            abortSignal: controller.signal,
          },
        });
        clearTimeout(timer);

        const durationMs = Date.now() - startTime;
        const usage: AiTokenUsage = {
          inputTokens: response.usageMetadata?.promptTokenCount ?? null,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
        };

        const rawText = response.text;
        if (!rawText) {
          throw new Error('Empty response from model');
        }

        const cleaned = cleanJsonText(rawText);
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          // Schema repair attempt 1
          logger.warn(
            { requestId: input.requestId, durationMs, attempt },
            'JSON parse failed; attempting schema repair'
          );
          return await this.repairAndValidate<T>(input, (jsonErr as Error).message, startTime);
        }

        try {
          const validated = input.validate(parsed);
          logger.info(
            {
              requestId: input.requestId,
              model: input.model,
              durationMs,
              usage,
              attempt,
            },
            'Gemini call succeeded'
          );
          return {
            value: validated,
            model: input.model,
            usage,
            durationMs,
          };
        } catch (valErr) {
          // Schema repair attempt 1
          logger.warn(
            { requestId: input.requestId, durationMs, attempt },
            'Zod validation failed; attempting schema repair'
          );
          return await this.repairAndValidate<T>(input, (valErr as Error).message, startTime);
        }
      } catch (err: unknown) {
        clearTimeout(timer);
        lastError = err;
        const errMessage = (err as Error).message || String(err);
        const isTransient =
          errMessage.includes('429') ||
          errMessage.includes('503') ||
          errMessage.includes('ResourceExhausted') ||
          errMessage.includes('ServiceUnavailable') ||
          errMessage.includes('timeout') ||
          (err as Error).name === 'AbortError';

        logger.warn(
          {
            requestId: input.requestId,
            attempt,
            isTransient,
            error: errMessage,
          },
          'Gemini call failed'
        );

        if (isTransient && attempt < maxAttempts) {
          const backoff =
            Math.min(10000, 1000 * Math.pow(2, attempt)) + Math.floor(Math.random() * 500);
          await sleep(backoff);
          continue;
        }

        break;
      }
    }

    throw lastError || new Error('Failed to generate from Gemini');
  }

  private async repairAndValidate<T>(
    input: {
      systemInstruction: string;
      schema: unknown;
      validate: (value: unknown) => T;
      model: string;
      timeoutMs: number;
      requestId: string;
    },
    errorMessage: string,
    initialStartTime: number
  ): Promise<StructuredAiResult<T>> {
    const repairPrompt = `Your previous output had schema validation errors:\n${errorMessage}\n\nPlease correct the output to match the requested schema exactly. Return JSON only without additional text or markdown fences.`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await this.ai.models.generateContent({
        model: input.model,
        contents: repairPrompt,
        config: {
          systemInstruction: input.systemInstruction,
          responseMimeType: 'application/json',
          responseJsonSchema: input.schema,
          temperature: 0.1,
          abortSignal: controller.signal,
        },
      });
      clearTimeout(timer);

      const durationMs = Date.now() - initialStartTime;
      const usage: AiTokenUsage = {
        inputTokens: response.usageMetadata?.promptTokenCount ?? null,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      };

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Empty response from model during schema repair');
      }

      const cleaned = cleanJsonText(rawText);
      const parsed = JSON.parse(cleaned);
      const validated = input.validate(parsed);

      logger.info(
        {
          requestId: input.requestId,
          model: input.model,
          durationMs,
          usage,
          repaired: true,
        },
        'Gemini schema repair succeeded'
      );

      return {
        value: validated,
        model: input.model,
        usage,
        durationMs,
      };
    } catch (err) {
      clearTimeout(timer);
      logger.error(
        {
          requestId: input.requestId,
          durationMs: Date.now() - initialStartTime,
          error: (err as Error).message,
        },
        'Gemini schema repair failed'
      );
      throw err;
    }
  }
}
