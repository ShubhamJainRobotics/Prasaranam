import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { type DbPool, addProjectMember, updateProjectMember } from '@relay/database';
import {
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
  PaginationQuerySchema,
  UuidSchema,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';

export function createProjectsRouter(pool: DbPool): Router {
  const router = Router();

  // GET /projects/:id - Project summary
  router.get(
    '/:id',
    requireAction(pool, 'PROJECT_VIEW', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const result = await pool.query(
          `SELECT 
            id, 
            organisation_id as "organisationId", 
            name, 
            description, 
            domain, 
            timezone, 
            access_epoch as "accessEpoch", 
            created_at as "createdAt",
            updated_at as "updatedAt"
           FROM public.projects
           WHERE id = $1`,
          [projectId]
        );

        if (result.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const project = result.rows[0];
        const userRole = req.user!.projectMemberships.get(projectId)?.role || 'viewer';

        res.status(200).json({
          data: {
            ...project,
            role: userRole,
            currentUserRole: userRole,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /projects/:id - Edit project
  router.patch(
    '/:id',
    requireAction(pool, 'PROJECT_EDIT_SETTINGS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const parsed = updateProjectSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid project update data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const updates = parsed.data;
        const setClauses: string[] = [];
        const params: unknown[] = [projectId];

        if (updates.name !== undefined) {
          params.push(updates.name);
          setClauses.push(`name = $${params.length}`);
        }
        if (updates.description !== undefined) {
          params.push(updates.description);
          setClauses.push(`description = $${params.length}`);
        }
        if (updates.domain !== undefined) {
          params.push(updates.domain);
          setClauses.push(`domain = $${params.length}`);
        }
        if (updates.timezone !== undefined) {
          params.push(updates.timezone);
          setClauses.push(`timezone = $${params.length}`);
        }

        if (setClauses.length === 0) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'No fields provided to update.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const query = `
          UPDATE public.projects
          SET ${setClauses.join(', ')}
          WHERE id = $1
          RETURNING id, organisation_id as "organisationId", name, description, domain, timezone, access_epoch as "accessEpoch", updated_at as "updatedAt"
        `;

        const result = await pool.query(query, params);

        res.status(200).json({
          data: result.rows[0],
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /projects/:id/members - Accessible project members
  router.get(
    '/:id/members',
    requireAction(pool, 'PROJECT_VIEW', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const callerMembership = req.user!.projectMemberships.get(projectId);
        const isOwner = callerMembership?.role === 'owner';

        const parsedQuery = PaginationQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid pagination query.',
              details: parsedQuery.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { cursor, limit } = parsedQuery.data;
        const decoded = decodeCursor(cursor);

        let query = `
          SELECT 
            pm.user_id as "userId",
            p.display_name as "displayName",
            pm.role,
            pm.active,
            pm.created_at as "createdAt"
            ${isOwner ? ', u.email' : ''}
          FROM public.project_members pm
          JOIN public.profiles p ON p.id = pm.user_id
          ${isOwner ? 'LEFT JOIN auth.users u ON u.id = pm.user_id' : ''}
          WHERE pm.project_id = $1
        `;
        const params: unknown[] = [projectId];

        if (decoded) {
          const [sortKey, id] = decoded;
          params.push(sortKey, id);
          query += ` AND (pm.created_at, pm.user_id) < ($${params.length - 1}, $${params.length})`;
        }

        params.push(limit + 1);
        query += ` ORDER BY pm.created_at DESC, pm.user_id DESC LIMIT $${params.length}`;

        const result = await pool.query(query, params);
        const rows = result.rows;
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor: string | null = null;
        if (hasMore && data.length > 0) {
          const last = data[data.length - 1];
          nextCursor = encodeCursor(last.createdAt, last.userId);
        }

        res.status(200).json({
          data,
          page: {
            nextCursor,
            hasMore,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /projects/:id/members - Add project member (non-enumerating)
  router.post(
    '/:id/members',
    requireAction(pool, 'PROJECT_MANAGE_MEMBERS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const parsed = addProjectMemberSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid project member data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { email, role } = parsed.data;

        // Constant amount of work to prevent timing side-channels
        const dummyHash = crypto.createHash('sha256').update(email).digest('hex');

        // Look up verified existing account
        const userRes = await pool.query(
          'SELECT id FROM auth.users WHERE email = $1 AND email_confirmed_at IS NOT NULL',
          [email.toLowerCase()]
        );

        if (userRes.rows.length > 0) {
          const targetUserId = userRes.rows[0].id;
          try {
            await addProjectMember(pool, req.user!.id, projectId, targetUserId, role);
          } catch {
            // If target is not an active org member or fails check, ignore silently per non-enumeration rule
          }
        } else {
          // Perform dummy work of identical computational cost
          crypto.pbkdf2Sync(dummyHash, 'salt', 100, 32, 'sha256');
        }

        res.status(200).json({
          data: {
            message: 'If an account exists with this email, the member has been added.',
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /projects/:id/members/:userId - Change role / deactivate
  router.patch(
    '/:id/members/:userId',
    requireAction(pool, 'PROJECT_MANAGE_MEMBERS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const targetUserId = req.params.userId as string;
        if (
          !UuidSchema.safeParse(projectId).success ||
          !UuidSchema.safeParse(targetUserId).success
        ) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const parsed = updateProjectMemberSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid member update data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { role, active } = parsed.data;

        const currentMember = await pool.query(
          'SELECT role, active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
          [projectId, targetUserId]
        );
        if (currentMember.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Member not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const effectiveRole = role ?? currentMember.rows[0].role;
        const effectiveActive = active ?? currentMember.rows[0].active;

        try {
          await updateProjectMember(
            pool,
            req.user!.id,
            projectId,
            targetUserId,
            effectiveRole,
            effectiveActive
          );
        } catch (err: any) {
          if (err?.message?.includes('LAST_OWNER')) {
            res.status(409).json({
              error: {
                code: 'LAST_OWNER',
                message: 'Cannot demote or deactivate the last active owner of the project.',
                details: [],
              },
              requestId: String(req.id || 'unknown'),
            });
            return;
          }
          if (err?.message?.includes('NOT_FOUND')) {
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: 'Member not found.',
                details: [],
              },
              requestId: String(req.id || 'unknown'),
            });
            return;
          }
          throw err;
        }

        res.status(200).json({
          data: {
            userId: targetUserId,
            role,
            active,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /projects/:id/dashboard - Access-filtered dashboard summary
  router.get(
    '/:id/dashboard',
    requireAction(pool, 'PROJECT_VIEW_DASHBOARD', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;

        // Fetch project info
        const projRes = await pool.query(
          `SELECT 
            id, 
            organisation_id as "organisationId", 
            name, 
            description, 
            domain, 
            timezone, 
            access_epoch as "accessEpoch", 
            created_at as "createdAt"
           FROM public.projects
           WHERE id = $1`,
          [projectId]
        );

        if (projRes.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        // Fetch member count
        const memberCountRes = await pool.query(
          'SELECT count(*) FROM public.project_members WHERE project_id = $1 AND active = true',
          [projectId]
        );
        const memberCount = Number(memberCountRes.rows[0].count);

        // Sources, claims, handovers, open questions counts (filtered by user access or 0 in initial phase)
        const sourcesCountRes = await pool.query(
          `SELECT count(*) FROM public.sources WHERE project_id = $1 AND archived_at IS NULL AND app_private.can_read_source(id, $2)`,
          [projectId, req.user!.id]
        );
        const sourcesCount = Number(sourcesCountRes.rows[0].count);

        const claimsCountRes = await pool.query(
          `SELECT count(*) FROM public.claims WHERE project_id = $1 AND archived_at IS NULL AND app_private.can_read_claim(id, $2)`,
          [projectId, req.user!.id]
        );
        const claimsCount = Number(claimsCountRes.rows[0].count);

        const handoversCountRes = await pool.query(
          `SELECT count(*) FROM public.handovers WHERE project_id = $1 AND app_private.can_read_handover(id, $2)`,
          [projectId, req.user!.id]
        );
        const handoversCount = Number(handoversCountRes.rows[0].count);

        const questionsCountRes = await pool.query(
          `SELECT count(*) FROM public.clarification_questions WHERE project_id = $1 AND status = 'open' AND app_private.can_read_question(id, $2)`,
          [projectId, req.user!.id]
        );
        const openQuestionsCount = Number(questionsCountRes.rows[0].count);

        res.status(200).json({
          data: {
            project: projRes.rows[0],
            memberCount,
            sourcesCount,
            claimsCount,
            handoversCount,
            openQuestionsCount,
            counts: {
              sources: sourcesCount,
              claims: claimsCount,
              handovers: handoversCount,
              questions: openQuestionsCount,
            },
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /projects/:id/recurring-problems ──────────────────────────────────
  router.get(
    '/:id/recurring-problems',
    requireAction(pool, 'PROJECT_VIEW_RECURRING_PROBLEMS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const userId = req.user!.id;

        /**
         * 0.6 chosen as minimum overlap to indicate genuine repetition of the underlying
         * problem while allowing minor phrasing and grammatical variation. Lower values
         * (<0.5) produce noisy unrelated clusters; higher values (>0.75) miss paraphrased
         * blockers and risks across different team members.
         */
        const RECURRING_PROBLEMS_JACCARD_THRESHOLD = 0.6;
        const RECURRING_PROBLEMS_CLAIM_CAP = 200;

        const STOP_WORDS = new Set([
          'a',
          'about',
          'above',
          'after',
          'again',
          'against',
          'all',
          'am',
          'an',
          'and',
          'any',
          'are',
          'aren',
          'arent',
          'as',
          'at',
          'be',
          'because',
          'been',
          'before',
          'being',
          'below',
          'between',
          'both',
          'but',
          'by',
          'can',
          'cannot',
          'could',
          'couldnt',
          'did',
          'didn',
          'didnt',
          'do',
          'does',
          'doesn',
          'doesnt',
          'doing',
          'don',
          'dont',
          'down',
          'during',
          'each',
          'few',
          'for',
          'from',
          'further',
          'had',
          'hadn',
          'hadnt',
          'has',
          'hasn',
          'hasnt',
          'have',
          'haven',
          'havent',
          'having',
          'he',
          'hed',
          'hell',
          'hes',
          'her',
          'here',
          'heres',
          'hers',
          'herself',
          'him',
          'himself',
          'his',
          'how',
          'hows',
          'i',
          'id',
          'ill',
          'im',
          'ive',
          'if',
          'in',
          'into',
          'is',
          'isn',
          'isnt',
          'it',
          'its',
          'itself',
          'lets',
          'me',
          'more',
          'most',
          'mustnt',
          'my',
          'myself',
          'no',
          'nor',
          'not',
          'of',
          'off',
          'on',
          'once',
          'only',
          'or',
          'other',
          'ought',
          'our',
          'ours',
          'ourselves',
          'out',
          'over',
          'own',
          'same',
          'shant',
          'she',
          'shed',
          'shell',
          'shes',
          'should',
          'shouldnt',
          'so',
          'some',
          'such',
          'than',
          'that',
          'thats',
          'the',
          'their',
          'theirs',
          'them',
          'themselves',
          'then',
          'there',
          'theres',
          'these',
          'they',
          'theyd',
          'theyll',
          'theyre',
          'theyve',
          'this',
          'those',
          'through',
          'to',
          'too',
          'under',
          'until',
          'up',
          'very',
          'was',
          'wasn',
          'wasnt',
          'we',
          'wed',
          'well',
          'were',
          'werent',
          'weve',
          'what',
          'whats',
          'when',
          'whens',
          'where',
          'wheres',
          'which',
          'while',
          'who',
          'whos',
          'whom',
          'why',
          'whys',
          'with',
          'wont',
          'would',
          'wouldnt',
          'you',
          'youd',
          'youll',
          'youre',
          'youve',
          'your',
          'yours',
          'yourself',
          'yourselves',
        ]);

        function normaliseToTokens(text: string): Set<string> {
          const words = text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
          return new Set(words);
        }

        function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
          if (a.size === 0 && b.size === 0) return 0;
          let intersectionSize = 0;
          for (const token of a) {
            if (b.has(token)) {
              intersectionSize++;
            }
          }
          const unionSize = a.size + b.size - intersectionSize;
          return unionSize === 0 ? 0 : intersectionSize / unionSize;
        }

        // Fetch up to 200 blocker and risk claims accessible to the user
        const claimsRes = await pool.query(
          `SELECT
             c.id,
             c.statement,
             c.observed_at as "observedAt",
             coalesce(
               json_agg(
                 json_build_object(
                   'chunkId', ce.chunk_id,
                   'sourceId', sc.source_id,
                   'sourceTitle', s.title,
                   'quote', ce.quote
                 )
               ) FILTER (WHERE ce.id IS NOT NULL),
               '[]'
             ) as evidence
           FROM public.claims c
           LEFT JOIN public.claim_evidence ce ON ce.claim_id = c.id
           LEFT JOIN public.source_chunks sc ON sc.id = ce.chunk_id
           LEFT JOIN public.sources s ON s.id = sc.source_id AND app_private.can_read_source(s.id, $2) = true
           WHERE c.project_id = $1
             AND c.archived_at IS NULL
             AND c.kind IN ('blocker', 'risk')
             AND app_private.can_read_claim(c.id, $2) = true
           GROUP BY c.id, c.statement, c.observed_at, c.created_at
           ORDER BY c.created_at DESC
           LIMIT $3`,
          [projectId, userId, RECURRING_PROBLEMS_CLAIM_CAP]
        );

        interface ClaimRow {
          id: string;
          statement: string;
          observedAt: string | null;
          evidence: Array<{
            chunkId: string;
            sourceId: string;
            sourceTitle?: string;
            quote?: string;
          }>;
        }

        const claims: ClaimRow[] = claimsRes.rows;
        if (claims.length === 0) {
          res.status(200).json({
            data: { groups: [] },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        // Tokenise each claim statement
        const tokenSets = claims.map((c) => normaliseToTokens(c.statement));

        // Disjoint Set Union (DSU) to group claims with Jaccard >= threshold
        const parent: number[] = claims.map((_, idx) => idx);
        function find(i: number): number {
          const p = parent[i];
          if (p === undefined || p === i) return i;
          const root = find(p);
          parent[i] = root;
          return root;
        }
        function union(i: number, j: number) {
          const rootI = find(i);
          const rootJ = find(j);
          if (rootI !== rootJ) {
            parent[rootI] = rootJ;
          }
        }

        for (let i = 0; i < claims.length; i++) {
          const tI = tokenSets[i];
          if (!tI) continue;
          for (let j = i + 1; j < claims.length; j++) {
            const tJ = tokenSets[j];
            if (!tJ) continue;
            const similarity = jaccardSimilarity(tI, tJ);
            if (similarity >= RECURRING_PROBLEMS_JACCARD_THRESHOLD) {
              union(i, j);
            }
          }
        }

        // Group claims by root
        const groupMap = new Map<number, ClaimRow[]>();
        for (let i = 0; i < claims.length; i++) {
          const claim = claims[i];
          if (!claim) continue;
          const root = find(i);
          let list = groupMap.get(root);
          if (!list) {
            list = [];
            groupMap.set(root, list);
          }
          list.push(claim);
        }

        // Filter and format groups: must have evidence from at least 2 distinct sources
        const groups: Array<{
          representativeStatement: string;
          claimIds: string[];
          distinctSourceCount: number;
          earliestObservedAt: string | null;
          latestObservedAt: string | null;
          evidenceRefs: Array<{
            claimId: string;
            sourceTitle?: string;
            quote?: string;
          }>;
        }> = [];

        for (const members of groupMap.values()) {
          const distinctSources = new Set<string>();
          const evidenceRefs: Array<{
            claimId: string;
            sourceTitle?: string;
            quote?: string;
          }> = [];
          const observedDates: Date[] = [];

          for (const member of members) {
            if (member.observedAt) {
              const d = new Date(member.observedAt);
              if (!isNaN(d.getTime())) {
                observedDates.push(d);
              }
            }

            for (const ev of member.evidence) {
              if (ev.sourceId) {
                distinctSources.add(ev.sourceId);
              }
              evidenceRefs.push({
                claimId: member.id,
                sourceTitle: ev.sourceTitle,
                quote: ev.quote,
              });
            }
          }

          // Must have evidence from at least two distinct sources
          if (distinctSources.size < 2) {
            continue;
          }

          const firstMember = members[0];
          if (!firstMember) continue;

          // Representative statement: pick the longest statement or first
          let representative = firstMember.statement;
          for (const m of members) {
            if (m.statement.length > representative.length) {
              representative = m.statement;
            }
          }

          observedDates.sort((a, b) => a.getTime() - b.getTime());
          const earliestDate = observedDates[0];
          const latestDate = observedDates[observedDates.length - 1];

          groups.push({
            representativeStatement: representative,
            claimIds: members.map((m) => m.id),
            distinctSourceCount: distinctSources.size,
            earliestObservedAt: earliestDate ? earliestDate.toISOString() : null,
            latestObservedAt: latestDate ? latestDate.toISOString() : null,
            evidenceRefs,
          });
        }

        // Sort groups by distinct source count descending, then member count descending
        groups.sort((a, b) => {
          if (b.distinctSourceCount !== a.distinctSourceCount) {
            return b.distinctSourceCount - a.distinctSourceCount;
          }
          return b.claimIds.length - a.claimIds.length;
        });

        res.status(200).json({
          data: { groups },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
