import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Sites from './pages/Sites';
import SiteForm from './pages/SiteForm';
import SiteDetail from './pages/SiteDetail';
import Items from './pages/Items';
import Jobs from './pages/Jobs';
import JobDetail from './pages/JobDetail';
import ApiKeys from './pages/ApiKeys';
import Settings from './pages/Settings';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { email, loading } = useAuth();
  const location = useLocation();

  if (loading) return null;
  if (!email) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="sites" element={<Sites />} />
        <Route path="sites/new" element={<SiteForm />} />
        <Route path="sites/:id" element={<SiteDetail />} />
        <Route path="sites/:id/edit" element={<SiteForm />} />
        <Route path="items" element={<Items />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="jobs/:id" element={<JobDetail />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
