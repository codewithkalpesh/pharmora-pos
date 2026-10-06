import { type ReactNode } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { useAuth, type UserRole } from './AuthContext.js';

interface ProtectedRouteProps {
  children: ReactNode;
  allowedRoles?: UserRole[];
}

export function ProtectedRoute({ children, allowedRoles }: ProtectedRouteProps) {
  const { isAuthenticated, user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f4f8fb',
          color: '#64748b',
          fontFamily: 'Inter, sans-serif',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 40,
              height: 40,
              border: '3px solid #cbd5e1',
              borderTopColor: '#0284c7',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <strong>Loading Pharmora POS…</strong>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role permissions if specified
  if (allowedRoles && allowedRoles.length > 0 && user.role) {
    const hasRole = allowedRoles.includes(user.role.name);
    if (!hasRole) {
      return (
        <div className="page-shell">
          <div className="panel" style={{ maxWidth: 480, margin: '40px auto', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>🚫</div>
            <h2>Access Restricted</h2>
            <p style={{ color: 'var(--muted)', margin: '10px 0 20px', lineHeight: 1.5 }}>
              This section is restricted to <strong>{allowedRoles.join(', ')}</strong> users. Your current role is <strong>{user.role.name}</strong>.
            </p>
            <Link to="/" className="primary-btn">
              Return to Dashboard
            </Link>
          </div>
        </div>
      );
    }
  }

  return <>{children}</>;
}
