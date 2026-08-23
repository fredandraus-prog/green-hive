import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthenticatedApp } from './authenticated-app.js';
import { AuthPage, RecoveryPage } from './auth-pages.js';
import { resolveAppRoute } from '../frontend-contracts.js';
import { LandingPage } from './ui.js';
import './styles.css';

function App(): ReactNode {
  const [location, setLocation] = useState(() => ({
    pathname: window.location.pathname,
    hash: window.location.hash,
  }));

  useEffect(() => {
    const update = () => setLocation({ pathname: window.location.pathname, hash: window.location.hash });
    window.addEventListener('popstate', update);
    window.addEventListener('hashchange', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('hashchange', update);
    };
  }, []);

  if (location.pathname === '/auth/sign-in') return <AuthPage mode="sign-in" />;
  if (location.pathname === '/auth/sign-up') return <AuthPage mode="sign-up" />;
  if (location.pathname === '/auth/recovery') return <RecoveryPage />;
  if (location.pathname.startsWith('/app')) {
    return <AuthenticatedApp route={resolveAppRoute(location.pathname, location.hash)} />;
  }
  return <LandingPage />;
}

const root = document.getElementById('root');
if (!root) throw new Error('Reference App root element was not found');
createRoot(root).render(<App />);
