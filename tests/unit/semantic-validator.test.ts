import { describe, it, expect } from 'vitest';
import {
  findFirstMatchCodePoints,
  toCodePoints,
  codePointLength,
  calculateEvidenceCeiling,
  clampEvidenceState,
  validateExtractionClaims,
  validateRelationships,
} from '../../apps/api/src/ai/validators/semantic-validator.js';
import type { ChunkInput, ExtractionOutputClaim } from '@relay/contracts';

describe('Semantic Validator', () => {
  describe('Unicode Code Point Offset Calculation', () => {
    it('correctly calculates code points with ASCII text', () => {
      const text = 'Hello world';
      expect(toCodePoints(text).length).toBe(11);
      expect(codePointLength(text)).toBe(11);
      const match = findFirstMatchCodePoints(text, 'world');
      expect(match).toEqual({ start: 6, end: 11 });
    });

    it('correctly calculates code-point offsets with multi-byte emoji and symbols', () => {
      // 🚀 is 1 code point, but 2 UTF-16 code units
      const text = 'Launch 🚀 confirmed by ops';
      // 'Launch ' = 7 code points
      // '🚀' = 1 code point at index 7
      // ' confirmed by ops' = 17 code points
      // Total code points = 25
      expect(codePointLength(text)).toBe(25);

      const match = findFirstMatchCodePoints(text, 'confirmed');
      expect(match).toEqual({ start: 9, end: 18 });

      const emojiMatch = findFirstMatchCodePoints(text, '🚀');
      expect(emojiMatch).toEqual({ start: 7, end: 8 });
    });

    it('uses first-match rule deterministically for repeated quotes', () => {
      const text = 'Postgres is great. We decided Postgres is our database.';
      const match = findFirstMatchCodePoints(text, 'Postgres');
      expect(match).toEqual({ start: 0, end: 8 });
    });

    it('returns null when quotation does not exist in text', () => {
      const text = 'We decided to use PostgreSQL';
      const match = findFirstMatchCodePoints(text, 'MySQL');
      expect(match).toBeNull();
    });
  });

  describe('Evidence Strength Ceiling (Section 2A.5)', () => {
    it('derives supported when evidence is from a single source', () => {
      const ceiling = calculateEvidenceCeiling([
        {
          chunkId: 'c1',
          sourceId: 's1',
          quote: 'q1',
          quoteStart: 0,
          quoteEnd: 2,
        },
      ]);
      expect(ceiling).toBe('supported');
    });

    it('derives corroborated when evidence is from two distinct sources', () => {
      const ceiling = calculateEvidenceCeiling([
        {
          chunkId: 'c1',
          sourceId: 's1',
          quote: 'q1',
          quoteStart: 0,
          quoteEnd: 2,
        },
        {
          chunkId: 'c2',
          sourceId: 's2',
          quote: 'q2',
          quoteStart: 0,
          quoteEnd: 2,
        },
      ]);
      expect(ceiling).toBe('corroborated');
    });

    it('does not derive corroborated for two quotes from the same source', () => {
      const ceiling = calculateEvidenceCeiling([
        {
          chunkId: 'c1',
          sourceId: 's1',
          quote: 'q1',
          quoteStart: 0,
          quoteEnd: 2,
        },
        {
          chunkId: 'c2',
          sourceId: 's1',
          quote: 'q2',
          quoteStart: 5,
          quoteEnd: 7,
        },
      ]);
      expect(ceiling).toBe('supported');
    });

    it('clamps model evidenceState when it exceeds ceiling', () => {
      // Model claimed corroborated, but ceiling is only supported
      const clamped = clampEvidenceState('corroborated', 'supported');
      expect(clamped).toBe('supported');

      // Model claimed needs_confirmation, below supported -> preserved
      const preserved = clampEvidenceState('needs_confirmation', 'supported');
      expect(preserved).toBe('needs_confirmation');
    });
  });

  describe('Extraction Claims Semantic Validation', () => {
    const validChunks: ChunkInput[] = [
      {
        chunkId: '11111111-1111-4111-8111-111111111111',
        sourceId: '22222222-2222-4222-8222-222222222222',
        recordRef: 'm-1',
        authorLabel: 'Dave',
        eventAt: '2026-03-01T12:00:00Z',
        text: 'The primary database must be PostgreSQL.',
      },
      {
        chunkId: '33333333-3333-4333-8333-333333333333',
        sourceId: '44444444-4444-4444-8444-444444444444',
        recordRef: 'm-2',
        authorLabel: 'Elena',
        eventAt: '2026-03-02T15:00:00Z',
        text: 'Agreed, PostgreSQL handles our transactions safely.',
      },
    ];

    it('validates legitimate claims and corroborates across two distinct sources', () => {
      const claims: ExtractionOutputClaim[] = [
        {
          localId: 'c1',
          kind: 'decision',
          statement: 'PostgreSQL is selected as the primary database.',
          workState: 'completed',
          ownerLabel: 'Dave',
          observedAt: null,
          evidenceState: 'corroborated',
          evidence: [
            {
              chunkId: '11111111-1111-4111-8111-111111111111',
              quote: 'The primary database must be PostgreSQL.',
            },
            {
              chunkId: '33333333-3333-4333-8333-333333333333',
              quote: 'PostgreSQL handles our transactions safely.',
            },
          ],
        },
      ];

      const result = validateExtractionClaims(claims, validChunks);
      expect(result.validClaims.length).toBe(1);
      expect(result.rejectedClaims.length).toBe(0);

      const valid = result.validClaims[0]!;
      expect(valid.evidenceState).toBe('corroborated');
      expect(valid.evidence.length).toBe(2);
      expect(valid.observedAt).toBe('2026-03-02T15:00:00Z'); // greatest event_at
    });

    it('rejects claims citing chunks outside the supplied batch (batch isolation)', () => {
      const claims: ExtractionOutputClaim[] = [
        {
          localId: 'c-isolated',
          kind: 'decision',
          statement: 'Secret financial planning approved.',
          workState: 'completed',
          ownerLabel: null,
          observedAt: null,
          evidenceState: 'supported',
          evidence: [
            {
              chunkId: '99999999-9999-4999-8999-999999999999', // out of batch
              quote: 'Secret quote',
            },
          ],
        },
      ];

      const result = validateExtractionClaims(claims, validChunks);
      expect(result.validClaims.length).toBe(0);
      expect(result.rejectedClaims.length).toBe(1);
      expect(result.rejectedClaims[0]!.reason).toContain('not in supplied extraction batch');
    });

    it('rejects claims with altered quotations', () => {
      const claims: ExtractionOutputClaim[] = [
        {
          localId: 'c-altered',
          kind: 'decision',
          statement: 'Database selected.',
          workState: 'completed',
          ownerLabel: null,
          observedAt: null,
          evidenceState: 'supported',
          evidence: [
            {
              chunkId: '11111111-1111-4111-8111-111111111111',
              quote: 'The primary database must be MongoDB.', // altered quote
            },
          ],
        },
      ];

      const result = validateExtractionClaims(claims, validChunks);
      expect(result.validClaims.length).toBe(0);
      expect(result.rejectedClaims.length).toBe(1);
      expect(result.rejectedClaims[0]!.reason).toContain('Quotation does not match');
    });

    it('rejects claims that attempt to set workState to superseded from extraction', () => {
      const claims: ExtractionOutputClaim[] = [
        {
          localId: 'c-superseded',
          kind: 'proposal',
          statement: 'An old proposal.',
          workState: 'superseded', // Forbidden by Section 2A.8 item 3 / 15.1
          ownerLabel: null,
          observedAt: null,
          evidenceState: 'supported',
          evidence: [
            {
              chunkId: '11111111-1111-4111-8111-111111111111',
              quote: 'The primary database must be PostgreSQL.',
            },
          ],
        },
      ];

      const result = validateExtractionClaims(claims, validChunks);
      expect(result.validClaims.length).toBe(0);
      expect(result.rejectedClaims.length).toBe(1);
      expect(result.rejectedClaims[0]!.reason).toContain('cannot establish superseded work state');
    });
  });

  describe('Relationship Validation', () => {
    it('discards self-links and out-of-scope claim references', () => {
      const suppliedIds = new Set(['claim-1', 'claim-2', 'claim-3']);
      const relationships = [
        {
          fromClaimId: 'claim-1',
          toClaimId: 'claim-1', // self link
          relation: 'depends_on' as const,
          explanation: 'Self dependency',
        },
        {
          fromClaimId: 'claim-1',
          toClaimId: 'claim-unknown', // out of scope
          relation: 'depends_on' as const,
          explanation: 'Unknown dependency',
        },
        {
          fromClaimId: 'claim-1',
          toClaimId: 'claim-2', // valid
          relation: 'depends_on' as const,
          explanation: 'Valid dependency',
        },
      ];

      const conflicts = [
        {
          claimIds: ['claim-1', 'claim-unknown'], // only 1 valid id
          description: 'Invalid conflict',
          clarificationQuestion: 'Q?',
        },
        {
          claimIds: ['claim-1', 'claim-2'], // valid
          description: 'Valid conflict',
          clarificationQuestion: 'Which is right?',
        },
      ];

      const result = validateRelationships(relationships, conflicts, suppliedIds);
      expect(result.validRelationships.length).toBe(1);
      expect(result.validRelationships[0]!.fromClaimId).toBe('claim-1');
      expect(result.validRelationships[0]!.toClaimId).toBe('claim-2');

      expect(result.validConflicts.length).toBe(1);
      expect(result.validConflicts[0]!.claimIds).toEqual(['claim-1', 'claim-2']);
    });
  });
});
