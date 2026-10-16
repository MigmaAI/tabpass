import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import '@/styles.css';
import { followSystemTheme } from '@/lib/theme';

import { PromptRoot } from './PromptRoot';

followSystemTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PromptRoot />
  </StrictMode>
);
