import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { BotProvider } from './BotContext';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BotProvider>
      <App />
    </BotProvider>
  </React.StrictMode>
);
