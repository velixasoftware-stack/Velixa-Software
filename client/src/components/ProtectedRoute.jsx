import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ type, roles, children }) {
  const { auth } = useAuth();

  if (!auth) return <Navigate to="/" replace />;
  if (auth.user.type !== type) return <Navigate to="/" replace />;

  const userRoles = auth.user.roles || [];
  if (roles && !userRoles.includes('ADMIN') && !roles.some((r) => userRoles.includes(r))) {
    return <Navigate to={type === 'CHIEF_ADMIN' ? '/chief-admin' : '/app'} replace />;
  }

  return children;
}
