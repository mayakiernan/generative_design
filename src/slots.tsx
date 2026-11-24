import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SiteTabs} from './components/SiteTabs';
import {KitGallery} from './slots/ui/KitGallery';
import {KitSheetTab} from './slots/ui/KitSheetTab';
import {PanelGenerator} from './slots/ui/PanelGenerator';
import {AtlasTab} from './slots/ui/AtlasTab';
import {FreeAtlasTab} from './slots/ui/FreeAtlasTab';
import './slots.css';

function App() {
  const [tab, setTab] = useState<'kits' | 'sheet' | 'atlas' | 'free' | 'panels'>('kits');
  return (
    <main className="slots">
      <SiteTabs current="slots" />
      <header className="topbar">
        <a className="wordmark" href="../">Possible Pieces</a>
        <nav className="tabs" aria-label="Mode">
          <button type="button" className={tab === 'kits' ? 'on' : ''} aria-current={tab === 'kits' ? 'page' : undefined} onClick={() => setTab('kits')}>Kit gallery</button>
          <button type="button" className={tab === 'sheet' ? 'on' : ''} aria-current={tab === 'sheet' ? 'page' : undefined} onClick={() => setTab('sheet')}>Kit sheet</button>
          <button type="button" className={tab === 'atlas' ? 'on' : ''} aria-current={tab === 'atlas' ? 'page' : undefined} onClick={() => setTab('atlas')}>Form atlas</button>
          <button type="button" className={tab === 'free' ? 'on' : ''} aria-current={tab === 'free' ? 'page' : undefined} onClick={() => setTab('free')}>Rule-free atlas</button>
          <button type="button" className={tab === 'panels' ? 'on' : ''} aria-current={tab === 'panels' ? 'page' : undefined} onClick={() => setTab('panels')}>Panel generator</button>
        </nav>
      </header>
      {tab === 'kits' ? <KitGallery /> : tab === 'sheet' ? <KitSheetTab /> : tab === 'atlas' ? <AtlasTab /> : tab === 'free' ? <FreeAtlasTab /> : <PanelGenerator />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
