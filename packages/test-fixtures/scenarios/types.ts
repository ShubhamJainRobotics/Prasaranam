export type StepStatus = 'passed' | 'broken' | 'not built';

export interface StepExecutionResult {
  status: StepStatus;
  request?: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  responseStatus?: number;
  expected?: string;
  actual?: unknown;
  likelySourceFile?: string;
  errorDetails?: string;
  durationMs?: number;
}

export interface ScenarioStep {
  id: string; // e.g. "scn1-step-01"
  name: string; // e.g. "Register owner user"
  feature: string; // e.g. "POST /api/v1/auth/register" or "Email Confirmation"
  action: string; // e.g. "Submit registration for scn1-owner@example.test"
  expectedResult: string; // e.g. "HTTP 200/201 and user registered in Supabase"
  run: (ctx: ScenarioContext) => Promise<StepExecutionResult>;
}

export interface ScenarioDefinition {
  id: string; // e.g. "scenario-1"
  number: number; // 1
  name: string; // "Onboarding and workspace"
  description: string;
  steps: ScenarioStep[];
}

export interface ScenarioUser {
  id: string;
  email: string;
  password: string;
  displayName: string;
  accessToken: string;
}

export interface ScenarioContext {
  pool: any;
  app: any;
  env?: any;
  users: Record<string, ScenarioUser>;
  orgs: Record<string, { id: string; name: string }>;
  projects: Record<string, { id: string; name: string; orgId: string }>;
  sources: Record<string, { id: string; title: string }>;
  claims: Record<string, { id: string; statement: string }>;
  handovers: Record<string, { id: string; title: string; version: number }>;
  questions: Record<string, { id: string; question: string }>;
  jobs: Record<string, { id: string; kind: string }>;
  conversations: Record<string, { id: string; title?: string }>;
  state: Record<string, any>;
  callApi: (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    path: string,
    token?: string,
    body?: unknown,
    headers?: Record<string, string>
  ) => Promise<{ status: number; body: any; headers: Record<string, any> }>;
}

export function getUser(ctx: ScenarioContext, role: string): ScenarioUser {
  const u = ctx.users[role];
  if (!u) {
    throw new Error(`Scenario user for role '${role}' has not been initialized in context`);
  }
  return u;
}

export function getOrg(ctx: ScenarioContext, key = 'main'): { id: string; name: string } {
  const org = ctx.orgs[key];
  if (!org) {
    throw new Error(`Scenario organisation '${key}' has not been initialized in context`);
  }
  return org;
}

export function getProject(
  ctx: ScenarioContext,
  key = 'main'
): { id: string; name: string; orgId: string } {
  const proj = ctx.projects[key];
  if (!proj) {
    throw new Error(`Scenario project '${key}' has not been initialized in context`);
  }
  return proj;
}

export function getSource(ctx: ScenarioContext, key: string): { id: string; title: string } {
  const s = ctx.sources[key];
  if (!s) {
    throw new Error(`Scenario source '${key}' has not been initialized in context`);
  }
  return s;
}

export function getHandover(
  ctx: ScenarioContext,
  key = 'main'
): { id: string; title: string; version: number } {
  const h = ctx.handovers[key];
  if (!h) {
    throw new Error(`Scenario handover '${key}' has not been initialized in context`);
  }
  return h;
}
