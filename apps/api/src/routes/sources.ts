import path from 'node:path';
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import type { DbPool } from '@relay/database';
import { importSource, setSourceAccess, archiveSource } from '@relay/database';
import {
  PasteSourceInputSchema,
  SetSourceAccessSchema,
  PaginationQuerySchema,
  UuidSchema,
  type SourceSummary,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';
import {
  ingestDocument,
  UPLOAD_MAX_BYTES,
  IMPORT_MAX_FILES,
  IMPORT_MAX_TOTAL_CHARACTERS,
  codePointLength,
  IngestionError,
} from '../ingestion/index.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: UPLOAD_MAX_BYTES,
    files: IMPORT_MAX_FILES,
  },
});

export function createSourcesRouter(pool: DbPool): Router {
  const router = Router();

  // ─── POST /projects/:id/sources/import ─────────────────────────────────────
  router.post(
    '/projects/:id/sources/import',
    requireAction(pool, 'PROJECT_IMPORT_SOURCES', (req) => ({ projectId: req.params.id })),
    (req: Request, res: Response, next: NextFunction) => {
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('multipart/form-data')) {
        upload.array('files', IMPORT_MAX_FILES)(req, res, (err) => {
          if (err) return next(err);
          next();
        });
      } else {
        next();
      }
    },
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const files = req.files as Express.Multer.File[] | undefined;
        const importedSources: SourceSummary[] = [];

        if (files && files.length > 0) {
          // Multipart file upload
          const replacesSourceId = req.body.replacesSourceId || null;
          if (replacesSourceId && files.length > 1) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Cannot replace an existing source with multiple files.',
                details: [],
              },
              requestId,
            });
            return;
          }

          // Parse grantUserIds if supplied as JSON string in form-data
          let grantUserIds: string[] = [];
          if (req.body.grantUserIds) {
            if (Array.isArray(req.body.grantUserIds)) {
              grantUserIds = req.body.grantUserIds;
            } else if (typeof req.body.grantUserIds === 'string') {
              try {
                grantUserIds = JSON.parse(req.body.grantUserIds);
              } catch {
                grantUserIds = [req.body.grantUserIds];
              }
            }
          }

          const visibility = req.body.visibility === 'restricted' ? 'restricted' : 'project';
          const formTitle = req.body.title ? String(req.body.title).trim() : null;
          const authorLabel = req.body.authorLabel ? String(req.body.authorLabel).trim() : null;
          const eventAt = req.body.eventAt ? String(req.body.eventAt).trim() : null;
          const originalUrl = req.body.originalUrl ? String(req.body.originalUrl).trim() : null;
          const requestedKind = req.body.kind ? String(req.body.kind).trim() : null;

          // Check cumulative character limit across all files in the request
          let totalChars = 0;

          // Pre-validate all files
          interface PreparedFile {
            file: Express.Multer.File;
            title: string;
            kind: 'text' | 'markdown' | 'messages' | 'issues';
          }

          const preparedFiles: PreparedFile[] = [];

          for (const file of files) {
            const ext = path.extname(file.originalname).toLowerCase();
            let kind: 'text' | 'markdown' | 'messages' | 'issues';

            if (ext === '.txt') {
              kind = 'text';
            } else if (ext === '.md') {
              kind = 'markdown';
            } else if (ext === '.json') {
              if (requestedKind === 'messages' || requestedKind === 'issues') {
                kind = requestedKind;
              } else {
                // Inspect JSON envelope
                try {
                  const text = file.buffer.toString('utf-8');
                  const parsed = JSON.parse(text);
                  if (parsed && typeof parsed === 'object' && 'format' in parsed) {
                    if (parsed.format === 'relay.messages.v1') kind = 'messages';
                    else if (parsed.format === 'relay.issues.v1') kind = 'issues';
                    else {
                      throw new IngestionError(
                        `Unknown envelope format '${parsed.format}'`,
                        'VALIDATION_ERROR',
                        422
                      );
                    }
                  } else {
                    throw new IngestionError(
                      'JSON file must match a supported relay envelope',
                      'VALIDATION_ERROR',
                      422
                    );
                  }
                } catch (e) {
                  if (e instanceof IngestionError) throw e;
                  throw new IngestionError('Malformed JSON file', 'VALIDATION_ERROR', 422);
                }
              }
            } else {
              throw new IngestionError(
                `Unsupported file type '${ext}'. Supported extensions: .txt, .md, .json`,
                'VALIDATION_ERROR',
                422
              );
            }

            // SPEC 2A.7: With exactly one file the form title applies; with several, each source title is its file name.
            const title = files.length === 1 && formTitle ? formTitle : file.originalname;

            preparedFiles.push({ file, title, kind });
          }

          // Ingest and insert each file
          for (const item of preparedFiles) {
            const ingestRes = ingestDocument(item.file.buffer, {
              kind: item.kind,
              title: item.title,
              authorLabel: authorLabel || undefined,
              eventAt: eventAt || undefined,
              originalUrl: originalUrl || undefined,
            });

            totalChars += codePointLength(ingestRes.canonicalContent);
            if (totalChars > IMPORT_MAX_TOTAL_CHARACTERS) {
              throw new IngestionError(
                `Total extracted characters across all files exceeds ${IMPORT_MAX_TOTAL_CHARACTERS}`,
                'VALIDATION_ERROR',
                422
              );
            }

            const sourceId = await importSource(pool, {
              actorId,
              projectId,
              title: item.title,
              kind: item.kind,
              visibility,
              content: ingestRes.canonicalContent,
              contentSha256: ingestRes.contentSha256,
              originalUrl: originalUrl || null,
              authorLabel: authorLabel || null,
              eventAt: eventAt || null,
              chunks: ingestRes.chunks,
              grantUserIds,
              replacesSourceId: replacesSourceId || null,
            });

            // Fetch created source summary
            const sourceRow = await pool.query(
              `SELECT 
                id, 
                project_id as "projectId", 
                title, 
                kind, 
                visibility, 
                original_url as "originalUrl", 
                author_label as "authorLabel", 
                event_at as "eventAt", 
                content_sha256 as "contentSha256", 
                revision, 
                lineage_id as "lineageId", 
                processing_status as "processingStatus", 
                processing_error_code as "processingErrorCode", 
                archived_at as "archivedAt", 
                created_by as "createdBy", 
                created_at as "createdAt"
               FROM public.sources
               WHERE id = $1`,
              [sourceId]
            );

            importedSources.push({
              ...sourceRow.rows[0],
              chunkCount: ingestRes.chunks.length,
            });
          }
        } else {
          // Paste text ingestion
          const parseResult = PasteSourceInputSchema.safeParse(req.body);
          if (!parseResult.success) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: parseResult.error.issues[0]?.message || 'Invalid paste input',
                details: parseResult.error.issues.map((i) => ({
                  path: i.path.join('.'),
                  message: i.message,
                  code: i.code,
                })),
              },
              requestId,
            });
            return;
          }

          const input = parseResult.data;

          const ingestRes = ingestDocument(input.content, {
            kind: input.kind,
            title: input.title,
            authorLabel: input.authorLabel,
            eventAt: input.eventAt,
            originalUrl: input.originalUrl,
          });

          const sourceId = await importSource(pool, {
            actorId,
            projectId,
            title: input.title,
            kind: input.kind,
            visibility: input.visibility,
            content: ingestRes.canonicalContent,
            contentSha256: ingestRes.contentSha256,
            originalUrl: input.originalUrl ?? null,
            authorLabel: input.authorLabel ?? null,
            eventAt: input.eventAt ?? null,
            chunks: ingestRes.chunks,
            grantUserIds: input.grantUserIds,
            replacesSourceId: input.replacesSourceId ?? null,
          });

          const sourceRow = await pool.query(
            `SELECT 
              id, 
              project_id as "projectId", 
              title, 
              kind, 
              visibility, 
              original_url as "originalUrl", 
              author_label as "authorLabel", 
              event_at as "eventAt", 
              content_sha256 as "contentSha256", 
              revision, 
              lineage_id as "lineageId", 
              processing_status as "processingStatus", 
              processing_error_code as "processingErrorCode", 
              archived_at as "archivedAt", 
              created_by as "createdBy", 
              created_at as "createdAt"
             FROM public.sources
             WHERE id = $1`,
            [sourceId]
          );

          importedSources.push({
            ...sourceRow.rows[0],
            chunkCount: ingestRes.chunks.length,
          });
        }

        res.status(201).json({
          data: {
            sources: importedSources,
            source: importedSources[0] ?? null,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /projects/:id/sources ─────────────────────────────────────────────
  router.get(
    '/projects/:id/sources',
    requireAction(pool, 'PROJECT_VIEW_SOURCES', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const userId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const pagination = PaginationQuerySchema.safeParse(req.query);
        if (!pagination.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid pagination parameters.',
              details: pagination.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
                code: i.code,
              })),
            },
            requestId,
          });
          return;
        }

        const limit = pagination.data.limit ?? 25;
        const cursor = pagination.data.cursor;

        const params: unknown[] = [projectId, userId];
        let cursorClause = '';

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            const [sortKey, cursorId] = decoded;
            params.push(sortKey, cursorId);
            cursorClause = `AND (s.created_at, s.id) < ($${params.length - 1}, $${params.length})`;
          }
        }

        params.push(limit + 1);
        const limitParamIdx = params.length;

        // Query accessible, non-archived sources with chunk counts
        const result = await pool.query(
          `SELECT 
            s.id, 
            s.project_id as "projectId", 
            s.title, 
            s.kind, 
            s.visibility, 
            s.original_url as "originalUrl", 
            s.author_label as "authorLabel", 
            s.event_at as "eventAt", 
            s.content_sha256 as "contentSha256", 
            s.revision, 
            s.lineage_id as "lineageId", 
            s.processing_status as "processingStatus", 
            s.processing_error_code as "processingErrorCode", 
            s.archived_at as "archivedAt", 
            s.created_by as "createdBy", 
            s.created_at as "createdAt",
            (SELECT count(*)::integer FROM public.source_chunks sc WHERE sc.source_id = s.id) as "chunkCount"
           FROM public.sources s
           WHERE s.project_id = $1
             AND s.archived_at IS NULL
             AND app_private.can_read_source(s.id, $2)
             ${cursorClause}
           ORDER BY s.created_at DESC, s.id DESC
           LIMIT $${limitParamIdx}`,
          params
        );

        const hasMore = result.rows.length > limit;
        const items = hasMore ? result.rows.slice(0, limit) : result.rows;

        let nextCursor: string | null = null;
        if (hasMore && items.length > 0) {
          const lastItem = items[items.length - 1];
          nextCursor = encodeCursor(lastItem.createdAt, lastItem.id);
        }

        res.status(200).json({
          data: items,
          page: {
            nextCursor,
            hasMore,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /sources/:id ──────────────────────────────────────────────────────
  router.get(
    '/sources/:id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Authentication required.', details: [] },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const sourceId = req.params.id as string;
        const userId = req.user.id;
        const requestId = String(req.id || 'unknown');

        if (!UuidSchema.safeParse(sourceId).success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        // Query source enforcing can_read_source
        const result = await pool.query(
          `SELECT 
            s.id, 
            s.project_id as "projectId", 
            s.title, 
            s.kind, 
            s.visibility, 
            s.original_url as "originalUrl", 
            s.author_label as "authorLabel", 
            s.event_at as "eventAt", 
            s.content,
            s.content_sha256 as "contentSha256", 
            s.revision, 
            s.lineage_id as "lineageId", 
            s.processing_status as "processingStatus", 
            s.processing_error_code as "processingErrorCode", 
            s.archived_at as "archivedAt", 
            s.created_by as "createdBy", 
            s.created_at as "createdAt"
           FROM public.sources s
           WHERE s.id = $1
             AND s.archived_at IS NULL
             AND app_private.can_read_source(s.id, $2)`,
          [sourceId, userId]
        );

        if (result.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        const source = result.rows[0];

        // If caller is project owner, also fetch grants
        let grants: string[] = [];
        const isOwner = req.user.projectMemberships.get(source.projectId)?.role === 'owner';
        if (isOwner && source.visibility === 'restricted') {
          const grantsRes = await pool.query(
            `SELECT user_id as "userId" FROM public.source_grants WHERE source_id = $1`,
            [sourceId]
          );
          grants = grantsRes.rows.map((r) => r.userId);
        }

        res.status(200).json({
          data: {
            ...source,
            grants: isOwner ? grants : undefined,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /sources/:id/chunks ───────────────────────────────────────────────
  router.get(
    '/sources/:id/chunks',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (!req.user) {
          res.status(401).json({
            error: { code: 'UNAUTHORIZED', message: 'Authentication required.', details: [] },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const sourceId = req.params.id as string;
        const userId = req.user.id;
        const requestId = String(req.id || 'unknown');

        if (!UuidSchema.safeParse(sourceId).success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        // Check source access first
        const sourceCheck = await pool.query(
          `SELECT id, project_id FROM public.sources WHERE id = $1 AND archived_at IS NULL AND app_private.can_read_source(id, $2)`,
          [sourceId, userId]
        );

        if (sourceCheck.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        const chunksRes = await pool.query(
          `SELECT 
            id,
            source_id as "sourceId",
            project_id as "projectId",
            ordinal,
            record_ref as "recordRef",
            author_label as "authorLabel",
            event_at as "eventAt",
            original_url as "originalUrl",
            start_offset as "startOffset",
            end_offset as "endOffset",
            content
           FROM public.source_chunks
           WHERE source_id = $1
           ORDER BY ordinal ASC`,
          [sourceId]
        );

        res.status(200).json({
          data: chunksRes.rows,
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── PATCH /sources/:id/access ─────────────────────────────────────────────
  router.patch(
    '/sources/:id/access',
    requireAction(pool, 'SOURCE_MANAGE_ACCESS', (req) => ({ sourceId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const sourceId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const parseResult = SetSourceAccessSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: parseResult.error.issues[0]?.message || 'Invalid access payload',
              details: parseResult.error.issues.map((i) => ({
                path: i.path.join('.'),
                message: i.message,
                code: i.code,
              })),
            },
            requestId,
          });
          return;
        }

        // Get project_id for source
        const sourceRes = await pool.query(
          `SELECT project_id FROM public.sources WHERE id = $1 AND archived_at IS NULL`,
          [sourceId]
        );

        if (sourceRes.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        const projectId = sourceRes.rows[0].project_id as string;

        await setSourceAccess(
          pool,
          actorId,
          projectId,
          sourceId,
          parseResult.data.visibility,
          parseResult.data.grantUserIds
        );

        res.status(200).json({
          data: {
            id: sourceId,
            visibility: parseResult.data.visibility,
            grantUserIds: parseResult.data.grantUserIds,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /sources/:id/archive ─────────────────────────────────────────────
  router.post(
    '/sources/:id/archive',
    requireAction(pool, 'SOURCE_ARCHIVE', (req) => ({ sourceId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const sourceId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const sourceRes = await pool.query(
          `SELECT project_id FROM public.sources WHERE id = $1 AND archived_at IS NULL`,
          [sourceId]
        );

        if (sourceRes.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Source not found.', details: [] },
            requestId,
          });
          return;
        }

        const projectId = sourceRes.rows[0].project_id as string;

        await archiveSource(pool, actorId, projectId, sourceId);

        res.status(200).json({
          data: {
            id: sourceId,
            archived: true,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
