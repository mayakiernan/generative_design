import React from 'react';
import {createRoot} from 'react-dom/client';
import {Hero} from './studio/ui/Hero';
import {PieceStory} from './studio/ui/PieceStory';
import {DesignSpace} from './studio/ui/DesignSpace';
import {Possible} from './studio/ui/Possible';
import './slots.css';
import './studio.css';

// The landing scroll: the poster, one piece becoming many, how many designs that makes, and the way into the atlas.
createRoot(document.getElementById('root')!).render(<React.StrictMode><Hero /><PieceStory /><DesignSpace /><Possible /></React.StrictMode>);
