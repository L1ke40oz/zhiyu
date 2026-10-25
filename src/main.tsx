import React from 'react';
import { createRoot } from 'react-dom/client';
import 'animal-island-ui/style';
import './styles.css';
import './pixel.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
