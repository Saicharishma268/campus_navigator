// src/context/ProtectedRoute.jsx
//
// Wrap any route element that should require a logged-in security admin.
// Usage in your router file:
//
//   import ProtectedRoute from './context/ProtectedRoute';
//
//   <Route
//     path="/admin"
//     element={
//       <ProtectedRoute>
//         <AdminPage />
//       </ProtectedRoute>
//     }
//   />
//
import { Navigate } from 'react-router-dom';
import { useAuth } from './useAuth';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    // Bounce anonymous visitors back to the home page's login card
    return <Navigate to="/" replace />;
  }

  return children;
}