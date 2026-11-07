import React from 'react';
import { ForbiddenState } from '../ui/ForbiddenState.js';

export interface RoleGateProps {
  userRole?: string | null;
  allowedRoles: string[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

export const RoleGate: React.FC<RoleGateProps> = ({
  userRole,
  allowedRoles,
  fallback,
  children,
}) => {
  if (!userRole || !allowedRoles.includes(userRole)) {
    if (fallback !== undefined) {
      return <>{fallback}</>;
    }
    return (
      <ForbiddenState
        title="Access restricted"
        message="You do not have permission to view or manage this section."
      />
    );
  }

  return <>{children}</>;
};
