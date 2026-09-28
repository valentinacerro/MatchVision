import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    // A cancelled Back (leave-game guard) keeps the browser history intact
    provideRouter(routes, withRouterConfig({ canceledNavigationResolution: 'computed' }))
  ]
};
