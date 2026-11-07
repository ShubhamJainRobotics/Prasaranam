import { describe, it, expect, beforeEach } from 'vitest';
import {
  FakeDeterministicProvider,
  setFakeAdversarialMode,
} from '../../apps/api/src/ai/providers/fake-provider.js';
import {
  ExtractionOutputSchema,
  RelationshipOutputSchema,
  ClarificationOutputSchema,
  type ExtractionInput,
  type RelationshipInput,
  type ClarificationInput,
} from '@relay/contracts';
import {
  buildExtractionPrompt,
  buildRelationshipPrompt,
  buildClarificationPrompt,
  SYSTEM_INSTRUCTION,
} from '../../apps/api/src/ai/prompts/index.js';

describe('FakeDeterministicProvider', () => {
  let provider: FakeDeterministicProvider;

  beforeEach(() => {
    setFakeAdversarialMode('none');
    provider = new FakeDeterministicProvider('test', false);
  });

  it('rejects initialization in production environment when demoMode is false', () => {
    expect(() => new FakeDeterministicProvider('production', false)).toThrow(
      /only permitted when NODE_ENV=test or DEMO_MODE=true/
    );
  });

  it('extracts decisions, proposals, tasks, and blockers with exact quotes from arbitrary chunk text', async () => {
    const input: ExtractionInput = {
      projectContext: {
        name: 'Payment Gateway',
        description: 'Next-gen payment processing',
      },
      chunks: [
        {
          chunkId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
          recordRef: 'm-001',
          authorLabel: 'Sarah Connor',
          eventAt: '2026-03-01T10:00:00Z',
          text: 'We decided to use PostgreSQL for ledger consistency. I propose we use Redis for transient sessions. We need to implement retry logic by Friday. Integration tests are blocked by missing API sandbox credentials.',
        },
      ],
    };

    const prompt = buildExtractionPrompt(input);
    const result = await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: {},
      validate: (v) => ExtractionOutputSchema.parse(v),
      model: 'fake-deterministic',
      timeoutMs: 5000,
      requestId: 'test-req-1',
    });

    expect(result.model).toBe('fake-deterministic');
    expect(result.value.claims.length).toBe(4);

    const kinds = result.value.claims.map((c) => c.kind);
    expect(kinds).toContain('decision');
    expect(kinds).toContain('proposal');
    expect(kinds).toContain('task');
    expect(kinds).toContain('blocker');

    // Verify exact quotes match chunk text
    for (const claim of result.value.claims) {
      expect(input.chunks[0]!.text).toContain(claim.evidence[0]!.quote);
      expect(claim.evidence[0]!.chunkId).toBe('11111111-1111-4111-8111-111111111111');
      expect(claim.ownerLabel).toBe('Sarah Connor');
    }
  });

  it('analyzes relationships and identifies contradictions between conflicting claims', async () => {
    const input: RelationshipInput = {
      claims: [
        {
          claimId: '33333333-3333-4333-8333-333333333333',
          kind: 'decision',
          statement: 'Migration will cut over on Friday at midnight.',
          workState: 'open',
          evidenceState: 'supported',
          ownerLabel: 'Alice',
          observedAt: '2026-03-01T10:00:00Z',
          evidence: [
            {
              quote: 'Migration will cut over on Friday at midnight.',
              sourceTitle: 'Plan v1',
              recordRef: null,
            },
          ],
        },
        {
          claimId: '44444444-4444-4444-8444-444444444444',
          kind: 'decision',
          statement: 'Migration cutover is scheduled for Monday at 9am.',
          workState: 'open',
          evidenceState: 'supported',
          ownerLabel: 'Bob',
          observedAt: '2026-03-02T10:00:00Z',
          evidence: [
            {
              quote: 'Migration cutover is scheduled for Monday at 9am.',
              sourceTitle: 'Plan v2',
              recordRef: null,
            },
          ],
        },
      ],
    };

    const prompt = buildRelationshipPrompt(input);
    const result = await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: {},
      validate: (v) => RelationshipOutputSchema.parse(v),
      model: 'fake-deterministic',
      timeoutMs: 5000,
      requestId: 'test-req-2',
    });

    expect(result.value.relationships.length).toBeGreaterThan(0);
    const contradiction = result.value.relationships.find((r) => r.relation === 'contradicts');
    expect(contradiction).toBeDefined();
    expect(contradiction?.fromClaimId).toBe('33333333-3333-4333-8333-333333333333');
    expect(contradiction?.toClaimId).toBe('44444444-4444-4444-8444-444444444444');

    expect(result.value.conflicts.length).toBeGreaterThan(0);
    expect(result.value.conflicts[0]!.clarificationQuestion).toBeTruthy();
  });

  it('generates clarification questions for unassigned owners and open blockers', async () => {
    const input: ClarificationInput = {
      claims: [
        {
          claimId: '55555555-5555-4555-8555-555555555555',
          kind: 'task',
          statement: 'Set up Stripe production webhook endpoint.',
          workState: 'open',
          evidenceState: 'supported',
          ownerLabel: null, // missing owner
          observedAt: null,
          evidence: [
            {
              quote: 'Set up Stripe production webhook endpoint.',
              sourceTitle: 'Tasks',
              recordRef: null,
            },
          ],
        },
      ],
      openQuestions: [],
    };

    const prompt = buildClarificationPrompt(input);
    const result = await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: {},
      validate: (v) => ClarificationOutputSchema.parse(v),
      model: 'fake-deterministic',
      timeoutMs: 5000,
      requestId: 'test-req-3',
    });

    expect(result.value.questions.length).toBe(1);
    expect(result.value.questions[0]!.question).toContain('Who is the primary owner');
    expect(result.value.questions[0]!.relatedClaimIds).toContain(
      '55555555-5555-4555-8555-555555555555'
    );
  });

  it('supports adversarial mode to test negative fixtures', async () => {
    setFakeAdversarialMode('fabricated_chunk_id');
    const input: ExtractionInput = {
      projectContext: { name: 'P', description: 'D' },
      chunks: [
        {
          chunkId: '11111111-1111-4111-8111-111111111111',
          sourceId: '22222222-2222-4222-8222-222222222222',
          recordRef: null,
          authorLabel: null,
          eventAt: null,
          text: 'We decided to proceed.',
        },
      ],
    };

    const prompt = buildExtractionPrompt(input);
    const result = await provider.generate({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: {},
      validate: (v) => ExtractionOutputSchema.parse(v),
      model: 'fake-deterministic',
      timeoutMs: 5000,
      requestId: 'test-req-4',
    });

    expect(result.value.claims[0]!.evidence[0]!.chunkId).toBe(
      '00000000-0000-4000-8000-000000000999'
    );
  });
});
