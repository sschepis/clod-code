import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsApp from './SettingsApp';
import './styles/main.css';

ReactDOM.createRoot(document.getElementById('settings-root')!).render(
  <React.StrictMode>
    <SettingsApp />
  </React.StrictMode>
);
