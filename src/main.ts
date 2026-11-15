import { registerRoute, startRouter } from './ui/router';
import { resortsPage } from './ui/pages/resorts';
import { terrainPage } from './ui/pages/terrain';
import { gunsPage } from './ui/pages/guns';
import { groomingPage } from './ui/pages/grooming';
import { previewPage } from './ui/pages/preview';
import { settingsPage } from './ui/pages/settings';
import './styles.css';

registerRoute('/resorts', resortsPage);
registerRoute('/terrain', terrainPage);
registerRoute('/guns', gunsPage);
registerRoute('/grooming', groomingPage);
registerRoute('/preview', previewPage);
registerRoute('/settings', settingsPage);

if (!window.location.hash) window.location.hash = '#/resorts';

const app = document.getElementById('app');
if (!app) throw new Error('缺少 #app 挂载节点');
void startRouter(app);
