import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Product Rename to Prasaranam (Sentinel)', () => {
  it('README title does not contain Relay and is titled Prasaranam', () => {
    const readmePath = path.resolve(process.cwd(), 'README.md');
    const content = fs.readFileSync(readmePath, 'utf8');
    const firstLine = content.split('\n')[0].trim();
    expect(firstLine).toBe('# Prasaranam');
    expect(firstLine).not.toContain('Relay');
  });

  it('web index.html title contains Prasaranam and does not contain Relay', () => {
    const indexPath = path.resolve(process.cwd(), 'apps/web/index.html');
    const content = fs.readFileSync(indexPath, 'utf8');
    const titleMatch = content.match(/<title>(.*?)<\/title>/);
    expect(titleMatch).toBeTruthy();
    expect(titleMatch![1]).toContain('Prasaranam');
    expect(titleMatch![1]).not.toContain('Relay');
  });

  it('export headers in markdown.ts and pdf.ts do not contain Relay', () => {
    const mdPath = path.resolve(process.cwd(), 'apps/api/src/export/markdown.ts');
    const mdContent = fs.readFileSync(mdPath, 'utf8');
    expect(mdContent).toContain('Prasaranam Knowledge Handover Platform');
    expect(mdContent).not.toContain('Relay Knowledge Handover Platform');

    const pdfPath = path.resolve(process.cwd(), 'apps/api/src/export/pdf.ts');
    const pdfContent = fs.readFileSync(pdfPath, 'utf8');
    expect(pdfContent).toContain('Prasaranam Knowledge Handover Platform');
    expect(pdfContent).not.toContain('Relay Knowledge Handover Platform');
  });

  it('no user-visible UI strings in apps/web/src contain Relay', () => {
    const webSrcDir = path.resolve(process.cwd(), 'apps/web/src');

    function scanDir(dir: string): string[] {
      const results: string[] = [];
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...scanDir(fullPath));
        } else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const files = scanDir(webSrcDir);
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const lines = content.split('\n');

      lines.forEach((line, index) => {
        // Strip comments and imports
        const trimmed = line.trim();
        if (
          trimmed.startsWith('//') ||
          trimmed.startsWith('/*') ||
          trimmed.startsWith('*') ||
          trimmed.startsWith('import ') ||
          trimmed.includes('@relay/') ||
          trimmed.includes('RelayApiError')
        ) {
          return;
        }

        // Check for visible string literals containing standalone 'Relay'
        // e.g. "Relay", 'Relay', >Relay<
        if (/\bRelay\b/.test(line)) {
          violations.push({
            file: path.relative(process.cwd(), file),
            line: index + 1,
            text: line.trim(),
          });
        }
      });
    }

    expect(
      violations,
      `Found user-visible occurrences of 'Relay':\n${violations.map((v) => `  ${v.file}:${v.line}: ${v.text}`).join('\n')}`
    ).toHaveLength(0);
  });
});
