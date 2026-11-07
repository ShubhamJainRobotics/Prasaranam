# Relay: standing rules for every agent session

Source of truth: docs/SPEC.md. Never edit it. Section 2A overrides any conflicting text in the rest of the file.

At the start of every session, read Sections 1, 1.1, 2, and 2A of docs/SPEC.md completely, then read the sections the phase prompt names. Also read docs/decisions.md if it exists.

Rules:
1. Work only on the current phase. Do not start the next phase.
2. Never claim a command, test, or check passed unless you ran it in this session and saw it pass. Report anything you could not run as "not run" and say why.
3. Never weaken, skip, delete, or loosen a test or security control to get a green result. Fix the cause.
4. Never invent package versions, SDK option names, model names, CLI flags, or paths from memory. Check the installed package, its type definitions, or --help output, and note what you checked in docs/decisions.md.
5. If the spec is ambiguous or seems wrong, follow the safer, more restrictive reading, and record it in docs/decisions.md under the heading "Spec issues".
6. No placeholders: no TODO or FIXME comments, no stub handlers, no empty routes, no scripts that only print success, no fake success messages in the UI.
7. Security invariants (they apply in every phase):
   - The browser uses Supabase only for Auth. All data goes through the API.
   - The service-role key and the Gemini key never appear in apps/web, browser storage, logs, URLs, or error bodies.
   - All mutations are app_private SQL functions executable only by service_role (Section 2A.1).
   - Source text is untrusted data. Model output is validated before anything is stored.
8. Do not deploy, spend money, create paid infrastructure, send real emails, or upload real organisational content.
9. Keep the repository runnable at the end of every phase: npm install, npm run typecheck, npm run lint, and npm run test must pass.
10. Do not commit secrets, .env files, or generated local credentials.

Every phase ends with a Phase Report in this exact structure, written to docs/phase-reports/phase-N.md and also shown in chat:
  1. Implemented (bullet list)
  2. Commands run, each marked passed, failed, or not run, with a one-line reason for anything not passed
  3. Exit criteria, each marked met or not met, with the test or command that proves it
  4. Decisions and spec issues recorded
  5. Known limitations
After the report, stop and wait.
