import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Session } from './session';

export const authGuard: CanActivateFn = async () => {
  const s = inject(Session);
  const router = inject(Router);
  await s.whenReady();
  if (!s.auth()) return router.parseUrl('/accesso');
  if (s.profile() && !s.profile()!.active) return router.parseUrl('/in-attesa');
  if (s.profile()?.must_change_password) return router.parseUrl('/nuova-password');
  return true;
};

export const guestGuard: CanActivateFn = async () => {
  const s = inject(Session);
  await s.whenReady();
  return s.auth() ? inject(Router).parseUrl('/') : true;
};

export const staffGuard: CanActivateFn = async () => {
  const s = inject(Session);
  await s.whenReady();
  return s.isStaff() ? true : inject(Router).parseUrl('/');
};
