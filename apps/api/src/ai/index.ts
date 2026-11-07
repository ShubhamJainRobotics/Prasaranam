import type { ServerEnvironment } from '@relay/contracts';
import type { StructuredAiProvider } from './types.js';
import { GeminiProvider } from './providers/gemini-provider.js';
import {
  FakeDeterministicProvider,
  setFakeAdversarialMode,
  type FakeAdversarialMode,
} from './providers/fake-provider.js';

export * from './types.js';
export * from './prompts/index.js';
export * from './validators/semantic-validator.js';
export * from './providers/gemini-provider.js';
export { FakeDeterministicProvider, setFakeAdversarialMode, type FakeAdversarialMode };

export function createAiProvider(env: ServerEnvironment): StructuredAiProvider {
  if (env.AI_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when AI_PROVIDER=gemini');
    }
    return new GeminiProvider(env.GEMINI_API_KEY);
  }

  if (env.AI_PROVIDER === 'fake') {
    return new FakeDeterministicProvider(env.NODE_ENV, env.DEMO_MODE);
  }

  throw new Error(`Unsupported AI_PROVIDER: ${(env as any).AI_PROVIDER}`);
}
