import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { serverEnvironmentSchema } from '@relay/contracts';

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

function verifyEnvironment() {
  const result = serverEnvironmentSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment verification failed:');
    for (const issue of result.error.issues) {
      console.error(` - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  console.log(
    `Environment variables verified successfully for NODE_ENV="${result.data.NODE_ENV}".`
  );
}

verifyEnvironment();
