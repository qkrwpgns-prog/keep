import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { ToastProvider } from './lib/toast';

// 예전 주소 형식(#p-…, #s=…)으로 들어오면 홈으로
if (/^#(p-|s=|u=)/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ToastProvider>
  </StrictMode>,
);
