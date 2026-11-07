import type {
  ChunkInput,
  ExtractionOutputClaim,
  EvidenceState,
  WorkState,
  RelationshipItem,
  ConflictItem,
} from '@relay/contracts';

export interface ValidatedEvidenceEntry {
  chunkId: string;
  sourceId: string;
  quote: string;
  quoteStart: number;
  quoteEnd: number;
}

export interface ValidatedClaim {
  localId: string;
  kind: ExtractionOutputClaim['kind'];
  statement: string;
  workState: WorkState;
  ownerLabel: string | null;
  observedAt: string | null;
  evidenceState: EvidenceState;
  evidence: ValidatedEvidenceEntry[];
}

export interface SemanticValidationResult {
  validClaims: ValidatedClaim[];
  rejectedClaims: Array<{
    claim: ExtractionOutputClaim;
    reason: string;
  }>;
}

/**
 * Returns an array of Unicode code points for the given string.
 */
export function toCodePoints(str: string): string[] {
  return Array.from(str);
}

/**
 * Returns the character length in Unicode code points.
 */
export function codePointLength(str: string): number {
  return Array.from(str).length;
}

/**
 * Finds the zero-based code-point start and end offsets of needle in haystack
 * using the deterministic first-match rule. Returns null if not found.
 */
export function findFirstMatchCodePoints(
  haystack: string,
  needle: string
): { start: number; end: number } | null {
  const needleCp = toCodePoints(needle);
  const haystackCp = toCodePoints(haystack);

  if (needleCp.length === 0 || needleCp.length > haystackCp.length) {
    return null;
  }

  for (let i = 0; i <= haystackCp.length - needleCp.length; i++) {
    let match = true;
    for (let j = 0; j < needleCp.length; j++) {
      if (haystackCp[i + j] !== needleCp[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      return {
        start: i,
        end: i + needleCp.length,
      };
    }
  }

  return null;
}

const EVIDENCE_STATE_RANKS: Record<EvidenceState, number> = {
  corroborated: 4,
  supported: 3,
  needs_confirmation: 2,
  conflicting: 1,
  unknown: 0,
};

/**
 * Derives evidence state ceiling based on validated evidence entries and distinct sources.
 */
export function calculateEvidenceCeiling(
  evidenceEntries: ValidatedEvidenceEntry[],
  hasContradiction = false
): EvidenceState {
  if (hasContradiction) {
    return 'conflicting';
  }
  if (evidenceEntries.length === 0) {
    return 'unknown';
  }

  const distinctSources = new Set(evidenceEntries.map((e) => e.sourceId));
  if (distinctSources.size >= 2) {
    return 'corroborated';
  }
  return 'supported';
}

/**
 * Clamps model's evidenceState to be at or below the calculated ceiling.
 */
export function clampEvidenceState(
  modelState: EvidenceState,
  ceiling: EvidenceState
): EvidenceState {
  const modelRank = EVIDENCE_STATE_RANKS[modelState];
  const ceilingRank = EVIDENCE_STATE_RANKS[ceiling];

  if (modelRank > ceilingRank) {
    return ceiling;
  }
  return modelState;
}

/**
 * Validates extraction claims semantically per Section 15.1 and Section 2A:
 * - Every cited chunk must be in the supplied batch.
 * - Every quote must be an exact substring in the cited chunk.
 * - quote_start and quote_end are code-point offsets relative to chunk text.
 * - Work state cannot be superseded from extraction.
 * - ObservedAt is derived from greatest event_at, or kept from model only if date string is in quote.
 * - EvidenceState is clamped to ceiling.
 */
export function validateExtractionClaims(
  claims: ExtractionOutputClaim[],
  chunks: ChunkInput[]
): SemanticValidationResult {
  const chunksById = new Map<string, ChunkInput>();
  for (const chunk of chunks) {
    chunksById.set(chunk.chunkId, chunk);
  }

  const validClaims: ValidatedClaim[] = [];
  const rejectedClaims: Array<{ claim: ExtractionOutputClaim; reason: string }> = [];

  for (const claim of claims) {
    // Check 1: Cannot output workState 'superseded' from extraction (Section 2A.8 item 3 / 15.1)
    if (claim.workState === 'superseded') {
      rejectedClaims.push({
        claim,
        reason: 'Extraction cannot establish superseded work state',
      });
      continue;
    }

    // Check 2: Validate evidence quotes
    const validatedEvidence: ValidatedEvidenceEntry[] = [];
    let evidenceFailed = false;
    let failureReason = '';

    for (const ev of claim.evidence) {
      const chunk = chunksById.get(ev.chunkId);
      if (!chunk) {
        evidenceFailed = true;
        failureReason = `Chunk ${ev.chunkId} not in supplied extraction batch (cross-class or fabricated)`;
        break;
      }

      const match = findFirstMatchCodePoints(chunk.text, ev.quote);
      if (!match) {
        evidenceFailed = true;
        failureReason = `Quotation does not match chunk text: "${ev.quote.slice(0, 50)}..."`;
        break;
      }

      validatedEvidence.push({
        chunkId: ev.chunkId,
        sourceId: chunk.sourceId,
        quote: ev.quote,
        quoteStart: match.start,
        quoteEnd: match.end,
      });
    }

    if (evidenceFailed || validatedEvidence.length === 0) {
      rejectedClaims.push({
        claim,
        reason: failureReason || 'Claim has no validated evidence',
      });
      continue;
    }

    // Check 3: Evidence ceiling
    const ceiling = calculateEvidenceCeiling(validatedEvidence);
    const clampedEvidenceState = clampEvidenceState(claim.evidenceState, ceiling);

    // Check 4: ObservedAt per Section 2A.8 item 7
    // Server derives: greatest event_at among cited chunks, or null.
    // Model's observedAt is kept only if its exact date string appears inside a cited quote.
    let resolvedObservedAt: string | null = null;
    if (claim.observedAt) {
      const dateStr = claim.observedAt.slice(0, 10); // e.g. YYYY-MM-DD
      const dateInQuote = validatedEvidence.some((e) => e.quote.includes(dateStr));
      if (dateInQuote) {
        resolvedObservedAt = claim.observedAt;
      }
    }

    if (!resolvedObservedAt) {
      // Find greatest event_at among cited chunks
      let maxEventAt: string | null = null;
      for (const ev of validatedEvidence) {
        const chunk = chunksById.get(ev.chunkId);
        if (chunk?.eventAt) {
          if (!maxEventAt || chunk.eventAt > maxEventAt) {
            maxEventAt = chunk.eventAt;
          }
        }
      }
      resolvedObservedAt = maxEventAt;
    }

    validClaims.push({
      localId: claim.localId,
      kind: claim.kind,
      statement: claim.statement.trim(),
      workState: claim.workState,
      ownerLabel: claim.ownerLabel?.trim() || null,
      observedAt: resolvedObservedAt,
      evidenceState: clampedEvidenceState,
      evidence: validatedEvidence,
    });
  }

  return { validClaims, rejectedClaims };
}

/**
 * Validates relationship output semantically per Section 15.2:
 * - Claim IDs must exist in the supplied claims set.
 * - No self-links (fromClaimId !== toClaimId).
 * - Conflicts must contain at least 2 distinct supplied claim IDs.
 */
export function validateRelationships(
  relationships: RelationshipItem[],
  conflicts: ConflictItem[],
  suppliedClaimIds: Set<string>
): {
  validRelationships: RelationshipItem[];
  validConflicts: ConflictItem[];
} {
  const validRelationships: RelationshipItem[] = [];
  for (const rel of relationships) {
    if (rel.fromClaimId === rel.toClaimId) {
      continue; // No self-links
    }
    if (!suppliedClaimIds.has(rel.fromClaimId) || !suppliedClaimIds.has(rel.toClaimId)) {
      continue; // Unknown or out-of-scope claim
    }
    validRelationships.push(rel);
  }

  const validConflicts: ConflictItem[] = [];
  for (const conf of conflicts) {
    const validIds = Array.from(new Set(conf.claimIds)).filter((id) => suppliedClaimIds.has(id));
    if (validIds.length < 2) {
      continue; // Requires at least two distinct accessible claims
    }
    validConflicts.push({
      ...conf,
      claimIds: validIds,
    });
  }

  return { validRelationships, validConflicts };
}
