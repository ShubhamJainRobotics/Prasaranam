import React from 'react';

export interface AuditEventItem {
  id: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  actorId: string;
  actorName?: string;
  createdAt: string;
}

interface Props {
  events: AuditEventItem[];
  loading?: boolean;
}

export const AuditEventTable: React.FC<Props> = ({ events, loading = false }) => {
  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 animate-pulse bg-white border border-slate-200 rounded-lg">
        Loading audit events...
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-slate-500 bg-white border border-slate-200 rounded-lg">
        No audit events recorded for this project yet.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
      <table className="w-full text-left text-sm text-slate-600">
        <caption className="sr-only">Project security and compliance audit log</caption>
        <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500 border-b border-slate-200">
          <tr>
            <th scope="col" className="px-4 py-3 font-semibold">
              Timestamp
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Action
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Entity Type
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Target ID
            </th>
            <th scope="col" className="px-4 py-3 font-semibold">
              Actor
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 font-normal">
          {events.map((evt) => (
            <tr key={evt.id} className="hover:bg-slate-50/50 transition-colors">
              <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                {new Date(evt.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 font-mono text-xs font-semibold text-teal-800">
                {evt.action}
              </td>
              <td className="px-4 py-3 text-xs capitalize text-slate-700">{evt.entityType}</td>
              <td
                className="px-4 py-3 font-mono text-[11px] text-slate-500 truncate max-w-[140px]"
                title={evt.entityId || 'N/A'}
              >
                {evt.entityId || '—'}
              </td>
              <td className="px-4 py-3 text-xs text-slate-700">
                {evt.actorName || evt.actorId.slice(0, 8)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
