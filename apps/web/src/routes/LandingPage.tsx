import React from 'react';
import { Link } from 'react-router-dom';

export const LandingPage: React.FC = () => {
  return (
    <div
      className="min-h-screen flex flex-col justify-between"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      <header
        className="border-b px-6 py-4 flex items-center justify-between"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="flex items-center space-x-3">
          <div
            className="w-8 h-8 rounded flex items-center justify-center font-bold text-lg"
            style={{ backgroundColor: 'var(--color-primary)', color: 'var(--color-primary-text)' }}
            aria-hidden="true"
          >
            P
          </div>
          <span
            className="text-xl font-semibold tracking-tight"
            style={{ color: 'var(--color-text)' }}
          >
            Prasaranam
          </span>
        </div>
        <nav aria-label="Main Navigation">
          <Link
            to="/login"
            className="px-4 py-2 rounded font-medium text-sm transition-colors focus:outline-none focus:ring-2"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-primary)',
              borderColor: 'var(--color-border-strong)',
              borderWidth: 1,
            }}
          >
            Sign In
          </Link>
        </nav>
      </header>

      <main className="flex-1 max-w-5xl mx-auto px-6 py-16 flex flex-col items-center text-center">
        <div
          className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold mb-6 uppercase tracking-wider"
          style={{ backgroundColor: 'var(--color-primary-subtle)', color: 'var(--color-primary)' }}
        >
          Project Knowledge Handover
        </div>
        <h1
          className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-6 max-w-3xl"
          style={{ color: 'var(--color-text)' }}
        >
          Evidence-backed knowledge handovers that stay when team members leave.
        </h1>
        <p
          className="text-lg sm:text-xl max-w-2xl mb-10 leading-relaxed"
          style={{ color: 'var(--color-text-muted)' }}
        >
          Prasaranam reconstructs decisions, tasks, blockers, and risks from authorised project
          activity, producing recipient-specific handovers that humans review before sharing.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 mb-16">
          <Link
            to="/register"
            className="px-6 py-3 rounded-md font-semibold text-base transition-colors focus:outline-none focus:ring-2 shadow-sm"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: 'var(--color-primary-text)',
            }}
          >
            Get Started
          </Link>
          <Link
            to="/login"
            className="px-6 py-3 rounded-md font-semibold text-base transition-colors focus:outline-none focus:ring-2 border"
            style={{
              backgroundColor: 'var(--color-surface)',
              color: 'var(--color-text)',
              borderColor: 'var(--color-border-strong)',
            }}
          >
            Sign In
          </Link>
        </div>

        <section
          className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left w-full max-w-4xl"
          aria-label="Core Capabilities"
        >
          <div
            className="p-6 rounded-lg border shadow-xs"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text)' }}>
              1. Authorised Activity
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Import messages, issues, and notes under explicit access controls. Source content is
              treated as untrusted data, never executable instructions.
            </p>
          </div>

          <div
            className="p-6 rounded-lg border shadow-xs"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text)' }}>
              2. Evidence Grounding
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Every extracted claim points to exact verifiable character spans. No hallucinated
              confidence numbers; uncertain facts are labelled.
            </p>
          </div>

          <div
            className="p-6 rounded-lg border shadow-xs"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
          >
            <h2 className="text-lg font-bold mb-2" style={{ color: 'var(--color-text)' }}>
              3. Recipient Scope
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
              Handovers filter evidence before generation to match recipient permissions. Restricted
              knowledge never leaks across boundaries.
            </p>
          </div>
        </section>
      </main>

      <footer
        className="border-t px-6 py-6 text-center text-sm"
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-muted)',
        }}
      >
        <p>
          &copy; {new Date().getFullYear()} Prasaranam Platform. Designed with accessible contrast
          and evidence-first architecture.
        </p>
      </footer>
    </div>
  );
};
