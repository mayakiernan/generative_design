import React from 'react';
import {createRoot} from 'react-dom/client';
import {Studio} from './studio/ui/Studio';
import './slots.css';
import './studio.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><main className="slots"><Studio /></main></React.StrictMode>);
