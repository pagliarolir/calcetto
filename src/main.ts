import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { watchIosViewportGap } from './app/core/ios-viewport';

watchIosViewportGap();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
