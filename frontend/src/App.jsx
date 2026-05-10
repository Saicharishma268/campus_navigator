import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import MapPage from './pages/MapPage';
import AdminPage from './pages/AdminPage';
import HomePage from './pages/HomePage';
import ChatbotPage from './pages/ChatbotPage';

function App() {
  const { pathname } = useLocation();
  const hideNav = pathname === '/map' || pathname === '/';

  return (
    <>
      {/* Navbar hidden on /map and / (home has its own full layout) */}
      {!hideNav && <Navbar />}

      <Routes>
        <Route path="/"        element={<HomePage />} />
        <Route path="/map"     element={<MapPage />} />
        <Route path="/chatbot" element={<ChatbotPage />} />
        <Route path="/admin"   element={<AdminPage />} />
        <Route path="*"        element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;