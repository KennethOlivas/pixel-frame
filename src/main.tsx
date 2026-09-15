import ReactDOM from 'react-dom/client';
import { IconContext } from '@phosphor-icons/react/dist/lib/context';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <IconContext.Provider value={{ weight: 'light', color: 'currentColor', 'aria-hidden': true, focusable: false }}>
    <App />
  </IconContext.Provider>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
