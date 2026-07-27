import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// TODO(step-6): import './styles/marker.css' once it exists (PDS tokens + marker overrides).

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
