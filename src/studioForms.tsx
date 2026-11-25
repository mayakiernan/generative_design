import React from 'react';
import {createRoot} from 'react-dom/client';
import {Forms} from './studio/ui/Forms';
import {StudioNav} from './studio/ui/Nav';
import './slots.css';
import './studio.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><><StudioNav current="forms" /><main className="slots"><Forms /></main></></React.StrictMode>);
