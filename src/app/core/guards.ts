import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FantaLeader } from './fantaleader';
import { NextMatch } from './next-match';
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
  const router = inject(Router);   // prima dell'attesa: dopo, inject() non è più consentito (NG0203)
  await s.whenReady();
  return s.auth() ? router.parseUrl('/') : true;
};

export const staffGuard: CanActivateFn = async () => {
  const s = inject(Session);
  const router = inject(Router);   // prima dell'attesa: dopo, inject() non è più consentito (NG0203)
  await s.whenReady();
  return s.isStaff() ? true : router.parseUrl('/');
};

/** FantaLeader in anteprima: solo chi è ammesso (Leader ed elenco), gli altri tornano alla pagina principale. */
export const fantaLeaderGuard: CanActivateFn = async () => {
  const s = inject(Session);
  const fl = inject(FantaLeader);
  const router = inject(Router);
  await s.whenReady();
  return (await fl.checkVisible()) ? true : router.parseUrl('/');
};

/**
 * Pagina principale: se la prossima partita è già nota (salvata sul telefono) si va subito lì, senza disegnare la home;
 * intanto si controlla in sottofondo e, se nel frattempo è cambiata, si passa a quella nuova.
 */
export const homeGuard: CanActivateFn = async () => {
  const s = inject(Session);
  const next = inject(NextMatch);
  const router = inject(Router);
  await s.whenReady();
  const known = next.id();
  if (!known) return true;   // la cerca la home, con il suo scheletro
  void next.refresh().then((id) => {
    if (id && id !== known && router.url.startsWith(`/partita/${known}`)) void router.navigate(['/partita', id], { replaceUrl: true });
  });
  return router.parseUrl(`/partita/${known}`);
};
