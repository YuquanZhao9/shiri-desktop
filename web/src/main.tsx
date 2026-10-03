import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './mobile.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(console.error);
