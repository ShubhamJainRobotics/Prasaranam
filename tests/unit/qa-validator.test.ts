import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { validateAnswerOutput } from '../../apps/api/src/ai/validators/semantic-validator.js';
import {
  escapeMarkdown,
  renderHandoverMarkdown,
  type ExportMetadata,
} from '../../apps/api/src/export/markdown.js';
import { renderHandoverPdf } from '../../apps/api/src/export/pdf.js';
import type { AnswerOutput, ClaimInput, HandoverDetail } from '@relay/contracts';

describe('Q&A Validator & Export Exporters (Unit)', () => {
  const claim1Id = '11111111-1111-1111-1111-111111111111';
  const claim2Id = '22222222-2222-2222-2222-222222222222';

  const mockClaims: ClaimInput[] = [
    {
      claimId: claim1Id,
      kind: 'decision',
      statement: 'PostgreSQL 16 was selected as primary database.',
      workState: 'open',
      evidenceState: 'supported',
      ownerLabel: 'Engineering',
      observedAt: '2026-03-01T10:00:00.000Z',
      evidence: [
        {
          sourceTitle: 'Architecture Decision Record 01',
          quote: 'We decided on PostgreSQL 16',
          chunkId: 'c1111111-1111-1111-1111-111111111111',
          quoteStart: 10,
          quoteEnd: 37,
          recordRef: 'ADR-01',
        },
      ],
    },
    {
      claimId: claim2Id,
      kind: 'risk',
      statement: 'Webhook latency can exceed SLA under peak load.',
      workState: 'open',
      evidenceState: 'conflicting',
      ownerLabel: 'Payments',
      observedAt: '2026-03-02T10:00:00.000Z',
      evidence: [
        {
          sourceTitle: 'Incident Report 2026-08',
          quote: 'Webhook latency spiked past SLA',
          chunkId: 'c2222222-2222-2222-2222-222222222222',
          quoteStart: 0,
          quoteEnd: 32,
          recordRef: 'INC-08',
        },
      ],
    },
  ];

  describe('validateAnswerOutput', () => {
    it('accepts a valid answered response with supplied claims', () => {
      const output: AnswerOutput = {
        status: 'answered',
        statements: [
          {
            text: 'PostgreSQL 16 was selected as primary database.',
            claimIds: [claim1Id],
          },
        ],
        limitations: ['Grounded in 1 accessible project claim.'],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.statements).toHaveLength(1);
    });

    it('rejects an answer that cites an unsupplied claim ID', () => {
      const output: AnswerOutput = {
        status: 'answered',
        statements: [
          {
            text: 'Fabricated statement citing an unknown claim.',
            claimIds: ['99999999-9999-9999-9999-999999999999'],
          },
        ],
        limitations: [],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('unsupplied claim ID'))).toBe(true);
    });

    it('rejects a factual statement without any valid claim citations', () => {
      const output: AnswerOutput = {
        status: 'answered',
        statements: [
          {
            text: 'An unsubstantiated factual assertion.',
            claimIds: [],
          },
        ],
        limitations: [],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('missing valid claim citations'))).toBe(true);
    });

    it('rejects an answer exceeding the 12 statement ceiling', () => {
      const statements = Array.from({ length: 13 }, (_, i) => ({
        text: `Statement ${i + 1}`,
        claimIds: [claim1Id],
      }));

      const output: AnswerOutput = {
        status: 'answered',
        statements,
        limitations: [],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('exceeds maximum statement ceiling'))).toBe(true);
    });

    it('rejects limitations that reveal hidden or restricted sources', () => {
      const output: AnswerOutput = {
        status: 'insufficient_evidence',
        statements: [],
        limitations: ['Information is restricted in confidential note 4.'],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('reveals hidden source existence'))).toBe(true);
    });

    it('accepts insufficient_evidence with zero statements', () => {
      const output: AnswerOutput = {
        status: 'insufficient_evidence',
        statements: [],
        limitations: ['No relevant evidence was found.'],
        suggestedClarification: 'Would you like to narrow the search scope?',
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(true);
      expect(result.statements).toHaveLength(0);
      expect(result.suggestedClarification).toBe('Would you like to narrow the search scope?');
    });

    it('accepts conflicting_evidence with cited claims', () => {
      const output: AnswerOutput = {
        status: 'conflicting_evidence',
        statements: [
          {
            text: 'Webhook latency spiked past SLA.',
            claimIds: [claim2Id],
          },
        ],
        limitations: ['Discovered conflicting evidence in accessible sources.'],
        suggestedClarification: null,
      };

      const result = validateAnswerOutput(output, mockClaims);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('conflicting_evidence');
    });
  });

  describe('escapeMarkdown', () => {
    it('defangs HTML elements including script, img, and iframe', () => {
      const hostile =
        '<script>alert("xss")</script><iframe src="evil.com"></iframe><img src=x onerror=alert(1)>';
      const escaped = escapeMarkdown(hostile);
      expect(escaped).not.toContain('<script>');
      expect(escaped).toContain('&lt;script&gt;');
      expect(escaped).toContain('&lt;iframe');
      expect(escaped).toContain('&lt;img');
    });

    it('escapes Markdown link syntax so no active link is rendered', () => {
      const hostile = '[Click Here To Steal Tokens](https://evil.org/phish)';
      const escaped = escapeMarkdown(hostile);
      expect(escaped).toContain('\\[Click Here To Steal Tokens\\]\\(https://evil\\.org/phish\\)');
    });

    it('escapes markdown formatting characters like asterisks, underscores, pipes, backticks', () => {
      const input = '**bold** _italic_ `code` | col | # heading';
      const escaped = escapeMarkdown(input);
      expect(escaped).toContain('\\*\\*bold\\*\\*');
      expect(escaped).toContain('\\_italic\\_');
      expect(escaped).toContain('\\`code\\`');
      expect(escaped).toContain('\\| col \\|');
      expect(escaped).toContain('\\# heading');
    });
  });

  describe('renderHandoverMarkdown', () => {
    const mockHandover: HandoverDetail = {
      id: 'h1111111-1111-1111-1111-111111111111',
      projectId: 'p1111111-1111-1111-1111-111111111111',
      rootId: 'h1111111-1111-1111-1111-111111111111',
      version: 1,
      title: 'Infrastructure & Database Handover',
      recipientId: 'u2222222-2222-2222-2222-222222222222',
      recipientName: 'Alice Incoming',
      departingUserId: 'u1111111-1111-1111-1111-111111111111',
      departingUserName: 'Bob Departing',
      createdBy: 'u1111111-1111-1111-1111-111111111111',
      status: 'approved',
      generatedAccessEpoch: '1',
      approvedAccessEpoch: '1',
      approvedBy: 'Alice Reviewer',
      approvedAt: '2026-03-05T12:00:00.000Z',
      sharedAt: null,
      sharedBy: null,
      rowVersion: 1,
      createdAt: '2026-03-05T10:00:00.000Z',
      updatedAt: '2026-03-05T12:00:00.000Z',
      configuration: {
        title: 'Infrastructure & Database Handover',
        recipientId: 'u2222222-2222-2222-2222-222222222222',
        departingUserId: 'u1111111-1111-1111-1111-111111111111',
        includedSections: ['decisions', 'risks'],
        priorityFocus: 'Database reliability',
        tone: 'professional',
        includeCompletedWork: false,
      },
      items: [
        {
          id: 'i1111111-1111-1111-1111-111111111111',
          handoverId: 'h1111111-1111-1111-1111-111111111111',
          projectId: 'p1111111-1111-1111-1111-111111111111',
          section: 'decisions',
          ordinal: 1,
          text: 'PostgreSQL 16 was selected as primary database.',
          itemKind: 'fact',
          evidenceState: 'supported',
          reviewState: 'approved',
          originalText: null,
          editedBy: null,
          editedAt: null,
          rowVersion: 1,
          claimIds: [claim1Id],
          citations: [
            {
              claimId: claim1Id,
              statement: 'PostgreSQL 16 was selected as primary database.',
              evidenceState: 'supported',
              quote: 'We decided on PostgreSQL 16',
              sourceTitle: 'ADR 01',
              chunkId: 'c1111111-1111-1111-1111-111111111111',
              quoteStart: 10,
              quoteEnd: 37,
            },
          ],
        },
        {
          id: 'i2222222-2222-2222-2222-222222222222',
          handoverId: 'h1111111-1111-1111-1111-111111111111',
          projectId: 'p1111111-1111-1111-1111-111111111111',
          section: 'risks',
          ordinal: 1,
          text: 'Latency spiked under heavy load.',
          itemKind: 'fact',
          evidenceState: 'conflicting',
          reviewState: 'approved',
          originalText: 'Initial draft wording',
          editedBy: 'Alice Reviewer',
          editedAt: '2026-03-05T11:00:00.000Z',
          rowVersion: 2,
          claimIds: [claim2Id],
          citations: [
            {
              claimId: claim2Id,
              statement: 'Webhook latency can exceed SLA under peak load.',
              evidenceState: 'conflicting',
              quote: 'Webhook latency spiked',
              sourceTitle: 'Incident 08',
              chunkId: 'c2222222-2222-2222-2222-222222222222',
              quoteStart: 0,
              quoteEnd: 22,
            },
          ],
        },
      ],
      isStale: false,
    };

    const metadata: ExportMetadata = {
      exportedAt: '2026-03-05T14:30:00.000Z',
    };

    it('renders structured markdown with header, TOC, sections, edit notices, and evidence', () => {
      const md = renderHandoverMarkdown(mockHandover, metadata);

      expect(md).toContain('# Infrastructure &amp; Database Handover');
      expect(md).toContain('- **Version**: v1');
      expect(md).toContain('- **Status**: Approved');
      expect(md).toContain('- **Recipient**: Alice Incoming');
      expect(md).toContain('## Contents');
      expect(md).toContain('1. Decisions (1 items)');
      expect(md).toContain('2. Risks (1 items)');
      expect(md).toContain('### 1.1 [Fact | Supported]');
      expect(md).toContain('PostgreSQL 16 was selected as primary database\\.');
      expect(md).toContain('Quote: "We decided on PostgreSQL 16"');
      expect(md).toContain('Edited by reviewer; wording not machine-verified.');
      expect(md).toContain('Generated by Prasaranam Knowledge Handover Platform');
    });
  });

  describe('renderHandoverPdf', () => {
    it('generates a valid PDF buffer and pdftotext extracts expected text', async () => {
      const mockHandover: HandoverDetail = {
        id: 'h2222222-2222-2222-2222-222222222222',
        projectId: 'p1111111-1111-1111-1111-111111111111',
        rootId: 'h2222222-2222-2222-2222-222222222222',
        version: 2,
        title: 'Core Systems Knowledge Transfer',
        recipientId: 'u2222222-2222-2222-2222-222222222222',
        recipientName: 'Carlos Rivera',
        departingUserId: 'u1111111-1111-1111-1111-111111111111',
        departingUserName: 'Elena Rostova',
        createdBy: 'u1111111-1111-1111-1111-111111111111',
        status: 'approved',
        generatedAccessEpoch: '2',
        approvedAccessEpoch: '2',
        approvedBy: 'Engineering Lead',
        approvedAt: '2026-03-06T15:00:00.000Z',
        sharedAt: null,
        sharedBy: null,
        rowVersion: 3,
        createdAt: '2026-03-06T12:00:00.000Z',
        updatedAt: '2026-03-06T15:00:00.000Z',
        configuration: {
          title: 'Core Systems Knowledge Transfer',
          recipientId: 'u2222222-2222-2222-2222-222222222222',
          departingUserId: 'u1111111-1111-1111-1111-111111111111',
          includedSections: ['decisions'],
          priorityFocus: 'Architecture resilience',
          tone: 'professional',
          includeCompletedWork: false,
        },
        items: [
          {
            id: 'i3333333-3333-3333-3333-333333333333',
            handoverId: 'h2222222-2222-2222-2222-222222222222',
            projectId: 'p1111111-1111-1111-1111-111111111111',
            section: 'decisions',
            ordinal: 1,
            text: 'System uses multi-region failover configuration with Unicode support (日本語, äöü, Текст).',
            itemKind: 'fact',
            evidenceState: 'supported',
            reviewState: 'approved',
            originalText: null,
            editedBy: null,
            editedAt: null,
            rowVersion: 1,
            claimIds: [claim1Id],
            citations: [
              {
                claimId: claim1Id,
                statement: 'Multi-region failover configuration enabled.',
                evidenceState: 'supported',
                quote: 'Multi-region failover enabled across all zones',
                sourceTitle: 'Infra Spec 2026',
                chunkId: 'c1111111-1111-1111-1111-111111111111',
                quoteStart: 0,
                quoteEnd: 46,
              },
            ],
          },
        ],
        isStale: false,
      };

      const metadata: ExportMetadata = {
        exportedAt: '2026-03-06T16:00:00.000Z',
      };

      const pdfBuffer = await renderHandoverPdf(mockHandover, metadata);
      expect(pdfBuffer).toBeInstanceOf(Buffer);
      expect(pdfBuffer.length).toBeGreaterThan(1000);

      // Verify header magic bytes (%PDF-)
      const pdfHeader = pdfBuffer.slice(0, 5).toString('ascii');
      expect(pdfHeader).toBe('%PDF-');

      // Use pdftotext to extract text from the buffer
      const extractedText = execSync('pdftotext - -', {
        input: pdfBuffer,
        encoding: 'utf-8',
      });

      expect(extractedText).toContain('Core Systems Knowledge Transfer');
      expect(extractedText).toContain('Version: v2');
      expect(extractedText).toContain('Status: Approved');
      expect(extractedText).toContain('Recipient: Carlos Rivera');
      expect(extractedText).toContain('Contents');
      expect(extractedText).toContain('1. Decisions');
      expect(extractedText).toContain('1.1 [Fact | Supported]');
      expect(extractedText).toContain('Multi-region failover');
      expect(extractedText).toContain('Infra Spec 2026');
      expect(extractedText).toContain('Prasaranam Knowledge Handover Platform');
    });
  });
});
