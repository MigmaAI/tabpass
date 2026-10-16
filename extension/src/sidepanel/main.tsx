import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles.css';
import { followSystemTheme } from '@/lib/theme';

import { App } from './App';

followSystemTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
