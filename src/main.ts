import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// collegamento a Supabase aperto subito, mentre Angular si avvia: la prima richiesta (bootstrap) non aspetta DNS e TLS
try {
  const link = document.createElement('link');
  link.rel = 'preconnect';
  link.href = new URL(environment.supabaseUrl).origin;
  link.crossOrigin = 'anonymous';
  document.head.appendChild(link);
} catch { /* indirizzo non valido (sviluppo): niente anticipo */ }

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
