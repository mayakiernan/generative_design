import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SiteTabs} from './components/SiteTabs';
import {KitGallery} from './slots/ui/KitGallery';
import {PanelGenerator} from './slots/ui/PanelGenerator';
import './slots.css';

function App() {
  const [tab, setTab] = useState<'kits' | 'panels'>('kits');
  return (
    <main className="slots">
      <SiteTabs current="slots" />
      <header className="topbar">
        <a className="wordmark" href="../">Possible Pieces</a>
        <nav className="tabs" aria-label="Mode">
          <button type="button" className={tab === 'kits' ? 'on' : ''} aria-current={tab === 'kits' ? 'page' : undefined} onClick={() => setTab('kits')}>Kit gallery</button>
          <button type="button" className={tab === 'panels' ? 'on' : ''} aria-current={tab === 'panels' ? 'page' : undefined} onClick={() => setTab('panels')}>Panel generator</button>
        </nav>
      </header>
      {tab === 'kits' ? <KitGallery /> : <PanelGenerator />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
