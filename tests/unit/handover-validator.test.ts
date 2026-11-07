import { describe, it, expect, beforeEach } from 'vitest';
import { validateHandoverOutput } from '../../apps/api/src/ai/validators/semantic-validator.js';
import {
  buildHandoverPrompt,
  PROMPT_VERSION_HANDOVER,
} from '../../apps/api/src/ai/prompts/index.js';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import type {
  HandoverInput,
  HandoverOutput,
  HandoverClaimInput,
  EvidenceState,
} from '@relay/contracts';

describe('Handover Validation & Synthesis (Unit)', () => {
  const claim1Id = '11111111-1111-1111-1111-111111111111';
  const claim2Id = '22222222-2222-2222-2222-222222222222';
  const claim3Id = '33333333-3333-3333-3333-333333333333';

  const mockClaims: HandoverClaimInput[] = [
    {
      id: claim1Id,
      claimType: 'decision',
      statement: 'PostgreSQL 16 was selected as primary database.',
      evidenceState: 'supported',
      workState: 'open',
      ownerLabel: 'Engineering',
      citations: [
        {
          chunkId: 'c1111111-1111-1111-1111-111111111111',
          sourceId: 's1111111-1111-1111-1111-111111111111',
          sourceTitle: 'Architecture Decision Record 01',
          quote: 'We decided on PostgreSQL 16',
        },
      ],
    },
    {
      id: claim2Id,
      claimType: 'risk',
      statement: 'Third-party payment gateway webhook latency can exceed SLA under peak load.',
      evidenceState: 'needs_confirmation',
      workState: 'open',
      ownerLabel: 'Payments Team',
      citations: [
        {
          chunkId: 'c2222222-2222-2222-2222-222222222222',
          sourceId: 's2222222-2222-2222-2222-222222222222',
          sourceTitle: 'Incident Report 2026-08',
          quote: 'Webhook latency spiked past 3000ms',
        },
      ],
    },
    {
      id: claim3Id,
      claimType: 'proposal',
      statement: 'Add idempotency keys to payments webhook endpoint.',
      evidenceState: 'corroborated',
      workState: 'open',
      ownerLabel: 'Backend Lead',
      citations: [
        {
          chunkId: 'c3333333-3333-3333-3333-333333333333',
          sourceId: 's3333333-3333-3333-3333-333333333333',
          sourceTitle: 'Sprint Backlog',
          quote: 'Task: Implement Idempotency-Key support',
        },
      ],
    },
  ];

  const baseInput: HandoverInput = {
    project: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Payments Core',
      description: 'Core payment processing service',
    },
    recipient: {
      id: '99999999-9999-9999-9999-999999999999',
      displayName: 'Incoming Engineer',
      role: 'recipient',
    },
    departingMember: {
      id: '88888888-8888-8888-8888-888888888888',
      displayName: 'Departing Engineer',
    },
    configuration: {
      title: 'Payments System Handover',
      recipientId: '99999999-9999-9999-9999-999999999999',
      departingUserId: '88888888-8888-8888-8888-888888888888',
      includedSections: ['snapshot', 'decisions', 'risks_dependencies', 'next_actions'],
      detailLevel: 'standard',
      priorityFocus: 'Webhook reliability and database migration',
      includeCompletedWork: false,
      includeProposedNextActions: true,
      tone: 'matter_of_fact',
    },
    claims: mockClaims,
  };

  const suppliedClaimsMap = new Map<string, { evidenceState: EvidenceState }>(
    mockClaims.map((c) => [c.id, { evidenceState: c.evidenceState }])
  );

  describe('Prompt Builder', () => {
    it('constructs versioned prompt with all configuration parameters', () => {
      const prompt = buildHandoverPrompt(baseInput);
      expect(PROMPT_VERSION_HANDOVER).toBe('handover-v1');
      expect(prompt).toContain('Payments System Handover');
      expect(prompt).toContain('Webhook reliability and database migration');
      expect(prompt).toContain('decisions');
      expect(prompt).toContain('risks_dependencies');
      expect(prompt).toContain('next_actions');
      expect(prompt).toContain(claim1Id);
      expect(prompt).toContain('PostgreSQL 16 was selected');
    });
  });

  describe('Fake Deterministic Provider', () => {
    let provider: FakeDeterministicProvider;

    beforeEach(() => {
      provider = new FakeDeterministicProvider('test', false);
    });

    it('generates structured handover output matching requested sections', async () => {
      const result = await provider.generateHandover(baseInput);
      expect(result.sections).toBeDefined();
      expect(result.sections.length).toBe(baseInput.configuration.includedSections.length);

      const sectionKeys = result.sections.map((s) => s.key);
      expect(sectionKeys).toEqual(baseInput.configuration.includedSections);

      // Verify items have required properties
      for (const section of result.sections) {
        for (const item of section.items) {
          expect(item.text).toBeDefined();
          expect(item.itemKind).toBeDefined();
        }
      }
    });

    it('omits next_actions when includeProposedNextActions is false', async () => {
      const inputWithoutNextActions: HandoverInput = {
        ...baseInput,
        configuration: {
          ...baseInput.configuration,
          includedSections: ['snapshot', 'decisions'],
          includeProposedNextActions: false,
        },
      };

      const result = await provider.generateHandover(inputWithoutNextActions);
      const sectionKeys = result.sections.map((s) => s.key);
      expect(sectionKeys).not.toContain('next_actions');
    });
  });

  describe('Semantic Validator', () => {
    it('validates a conformant handover output and derives weakest evidence state', () => {
      const rawOutput: HandoverOutput = {
        title: 'Payments System Handover',
        sections: [
          {
            key: 'snapshot',
            items: [
              {
                localId: 'snap-1',
                text: 'The payments service utilizes PostgreSQL 16 for ledger persistence.',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [claim1Id],
              },
            ],
          },
          {
            key: 'decisions',
            items: [
              {
                localId: 'dec-1',
                text: 'Postgres 16 was chosen for storage.',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [claim1Id],
              },
            ],
          },
          {
            key: 'risks_dependencies',
            items: [
              {
                localId: 'risk-1',
                text: 'Webhook latency exceeds SLA under peak load.',
                itemKind: 'fact',
                evidenceState: 'needs_confirmation',
                claimIds: [claim2Id],
              },
            ],
          },
          {
            key: 'next_actions',
            items: [
              {
                localId: 'next-1',
                text: 'Recommend implementing idempotency key handling for webhook retries.',
                itemKind: 'suggestion',
                evidenceState: 'corroborated',
                claimIds: [claim2Id, claim3Id],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        rawOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(true);
      expect(validated.errors.length).toBe(0);

      // Verify weakest evidence state derivation:
      // Item citing claim2 (needs_confirmation) and claim3 (corroborated) -> needs_confirmation
      const nextActionSection = validated.items.find((s) => s.section === 'next_actions');
      expect(nextActionSection?.evidenceState).toBe('needs_confirmation');
    });

    it('rejects duplicate sections in generation output', () => {
      const invalidOutput: HandoverOutput = {
        title: 'Duplicate Sections Output',
        sections: [
          {
            key: 'decisions',
            items: [
              {
                localId: 'dec-1',
                text: 'First decisions item',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [claim1Id],
              },
            ],
          },
          {
            key: 'decisions',
            items: [
              {
                localId: 'dec-2',
                text: 'Duplicate decisions item',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [claim1Id],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        invalidOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(false);
      expect(validated.errors.some((e) => e.includes('Duplicate section'))).toBe(true);
    });

    it('rejects unrequested sections', () => {
      const invalidOutput: HandoverOutput = {
        title: 'Unrequested Section Output',
        sections: [
          {
            key: 'work_in_progress', // Not in baseInput.configuration.includedSections
            items: [
              {
                localId: 'wip-1',
                text: 'WIP item',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [claim3Id],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        invalidOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(false);
      expect(validated.errors.some((e) => e.includes('Unrequested section'))).toBe(true);
    });

    it('rejects items citing unknown or fabricated claim IDs', () => {
      const fabricatedClaimId = '99999999-0000-0000-0000-000000000000';
      const invalidOutput: HandoverOutput = {
        title: 'Fabricated Claim Output',
        sections: [
          {
            key: 'decisions',
            items: [
              {
                localId: 'dec-1',
                text: 'Fabricated architecture decision assertion.',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [fabricatedClaimId],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        invalidOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(false);
      expect(validated.errors.some((e) => e.includes('unsupplied claim ID'))).toBe(true);
    });

    it('rejects facts asserting facts with zero cited claims', () => {
      const invalidOutput: HandoverOutput = {
        title: 'Uncited Fact Output',
        sections: [
          {
            key: 'decisions',
            items: [
              {
                localId: 'dec-1',
                text: 'Uncited assertion that claims to be a fact.',
                itemKind: 'fact',
                evidenceState: 'supported',
                claimIds: [],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        invalidOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(false);
      expect(
        validated.errors.some((e) => e.includes('FACT item missing valid evidence citations'))
      ).toBe(true);
    });

    it('rejects suggestions that lack motivating claims', () => {
      const invalidOutput: HandoverOutput = {
        title: 'Unmotivated Suggestion Output',
        sections: [
          {
            key: 'next_actions',
            items: [
              {
                localId: 'next-1',
                text: 'Unmotivated suggestion without supporting claims.',
                itemKind: 'suggestion',
                evidenceState: 'corroborated',
                claimIds: [],
              },
            ],
          },
        ],
      };

      const validated = validateHandoverOutput(
        invalidOutput,
        suppliedClaimsMap,
        baseInput.configuration
      );
      expect(validated.valid).toBe(false);
      expect(
        validated.errors.some((e) => e.includes('SUGGESTION item missing valid evidence citations'))
      ).toBe(true);
    });

    it('enforces item ceilings per section based on detailLevel', () => {
      const conciseConfig = {
        ...baseInput.configuration,
        detailLevel: 'concise' as const, // ceiling is 8
      };

      const manyItems = Array.from({ length: 9 }, (_, i) => ({
        localId: `dec-${i + 1}`,
        text: `Decision item ${i + 1}`,
        itemKind: 'fact' as const,
        evidenceState: 'supported' as const,
        claimIds: [claim1Id],
      }));

      const invalidOutput: HandoverOutput = {
        title: 'Exceeding Ceiling Output',
        sections: [
          {
            key: 'decisions',
            items: manyItems,
          },
        ],
      };

      const validated = validateHandoverOutput(invalidOutput, suppliedClaimsMap, conciseConfig);
      expect(validated.valid).toBe(false);
      expect(validated.errors.some((e) => e.includes('exceeds detail ceiling of 8 items'))).toBe(
        true
      );
    });
  });
});
