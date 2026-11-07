import React from 'react';

interface VersionItem {
  id: string;
  version: number;
  status: string;
  createdAt: string;
}

interface Props {
  versions: VersionItem[];
  activeId: string;
  onSelect: (id: string) => void;
}

export const HandoverVersionSelector: React.FC<Props> = ({ versions, activeId, onSelect }) => {
  if (versions.length <= 1) return null;

  return (
    <div className="flex items-center gap-2 overflow-x-auto py-1">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-1">
        Versions:
      </span>
      {versions.map((v) => {
        const isActive = v.id === activeId;
        return (
          <button
            key={v.id}
            type="button"
            onClick={() => onSelect(v.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              isActive
                ? 'bg-teal-700 text-white shadow-xs'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <span>v{v.version}</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded uppercase font-semibold ${
                isActive
                  ? 'bg-teal-800 text-teal-100'
                  : v.status === 'shared'
                    ? 'bg-emerald-100 text-emerald-800'
                    : v.status === 'approved'
                      ? 'bg-teal-100 text-teal-800'
                      : v.status === 'stale' || v.status === 'superseded'
                        ? 'bg-slate-200 text-slate-600'
                        : 'bg-amber-100 text-amber-800'
              }`}
            >
              {v.status}
            </span>
          </button>
        );
      })}
    </div>
  );
};
