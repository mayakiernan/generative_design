import React from 'react';
import {createRoot} from 'react-dom/client';
import {BottleStudio} from './studio/bottles/BottleStudio';
import './slots.css';
import './studio.css';
import './bottles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><BottleStudio /></React.StrictMode>);
