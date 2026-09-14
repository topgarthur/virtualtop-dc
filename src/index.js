import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DemoPage from './pages/DemoPage';
import { BotProvider } from './BotContext';
import { DemoProvider } from './DemoContext';
import './index.css';

function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return hash === '#/demo' ? <DemoPage /> : <App />;
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BotProvider>
      <DemoProvider>
        <Root />
      </DemoProvider>
    </BotProvider>
  </React.StrictMode>
);
