import { createRoot } from 'react-dom/client';
import Homebrew from './homebrew.jsx';
import { bootstrapAnchorPositioningPolyfill } from '@components/anchorPositioningPolyfill.js';
// Pugicordium: única linha adicionada a um arquivo do upstream. Tudo o que o
// fork soma pendura em client/pugicordium/inicializar.js.
import '../pugicordium/inicializar.js';

const props = window.__INITIAL_PROPS__ || {};

createRoot(document.getElementById('reactRoot')).render(<Homebrew {...props} />);
bootstrapAnchorPositioningPolyfill();
