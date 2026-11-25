import React from 'react';
import {createRoot} from 'react-dom/client';
import {Mark} from './studio/ui/Shapes';
import './slots.css';
import './studio.css';

function Home() {
  return (
    <main className="pp-directory">
      <a className="st-home" href="./" aria-label="Probable Pieces home" aria-current="page"><Mark /></a>
      <nav className="pp-directory-links" aria-label="Explore Probable Pieces">
        <a className="pp-directory-feature" href="./blog/">Blog</a>
        <span className="pp-directory-tab">About</span>
        <a className="pp-directory-tab" href="./blog/">Blog</a>
        <a className="pp-directory-tab" href="./possible-pieces/">Possible Pieces</a>
        <span className="pp-directory-tab">Bottles</span>
      </nav>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><Home /></React.StrictMode>);
