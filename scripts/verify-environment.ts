import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { serverEnvironmentSchema, type ServerEnvironment } from '@relay/contracts';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
];
for (const candidate of envCandidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

export async function verifyEnvironment(
  envOverride?: Record<string, string | undefined>
): Promise<ServerEnvironment> {
  const envSource = envOverride || process.env;
  const result = serverEnvironmentSchema.safeParse(envSource);

  if (!result.success) {
    console.error('Environment verification failed:');
    for (const issue of result.error.issues) {
      console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  const env = result.data;

  // Verify AI provider configuration
  if (env.AI_PROVIDER === 'fake') {
    const isAllowed = env.NODE_ENV === 'test' || (env.DEMO_MODE && env.NODE_ENV !== 'production');
    if (!isAllowed) {
      console.error(
        'Fake provider is only permitted when NODE_ENV=test or DEMO_MODE=true in non-production environments'
      );
      process.exit(1);
    }
    console.log('AI Provider: fake-deterministic (simulated output mode).');
  } else if (env.AI_PROVIDER === 'gemini') {
    if (!env.GEMINI_API_KEY) {
      if (env.NODE_ENV === 'production') {
        console.error('GEMINI_API_KEY is required in production with AI_PROVIDER=gemini');
        process.exit(1);
      }
      console.warn(
        'GEMINI_API_KEY not set; skipping live model discovery check in non-production.'
      );
    } else {
      try {
        const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
        const pager = await ai.models.list();
        let targetModelFound = false;
        const targetModelName = env.GEMINI_MODEL || 'gemini-2.5-flash';

        for await (const model of pager) {
          const name = model.name || '';
          if (
            name === targetModelName ||
            name === `models/${targetModelName}` ||
            model.displayName === targetModelName
          ) {
            targetModelFound = true;
            const actions = model.supportedActions || [];
            if (!actions.includes('generateContent')) {
              console.error(
                `Model "${targetModelName}" is listed but does not support "generateContent"`
              );
              process.exit(1);
            }
            break;
          }
        }

        if (!targetModelFound) {
          console.error(
            `Model "${targetModelName}" was not found in the list of models accessible to configured key.`
          );
          process.exit(1);
        }

        console.log(`Verified Gemini model capability for "${targetModelName}".`);
      } catch (err: any) {
        console.error('Gemini model capability verification failed:', err.message);
        process.exit(1);
      }
    }
  }

  console.log(
    `Environment variables and AI capabilities verified successfully for NODE_ENV="${env.NODE_ENV}".`
  );
  return env;
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith('verify-environment.ts')) {
  verifyEnvironment().catch(() => process.exit(1));
}
