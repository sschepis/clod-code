import React from 'react';
import ReactDOM from 'react-dom/client';
import WelcomeApp from './WelcomeApp';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/main.css';

ReactDOM.createRoot(document.getElementById('welcome-root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <WelcomeApp />
    </ErrorBoundary>
  </React.StrictMode>
);
