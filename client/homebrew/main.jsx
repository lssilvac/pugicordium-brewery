import { createRoot } from 'react-dom/client';
import Homebrew from './homebrew.jsx';
import { bootstrapAnchorPositioningPolyfill } from '@components/anchorPositioningPolyfill.js';
// Pugicordium: única linha adicionada a um arquivo do upstream. A skin reveste
// os seletores existentes sem tocar componente; ver client/pugicordium/skin.less.
import '../pugicordium/skin.less';

const props = window.__INITIAL_PROPS__ || {};

createRoot(document.getElementById('reactRoot')).render(<Homebrew {...props} />);
bootstrapAnchorPositioningPolyfill();
