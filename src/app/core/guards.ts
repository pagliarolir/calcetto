import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { FANTA_ENABLED, FantaLeader } from './fantaleader';
import { Payments } from './payments';
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
  if (!FANTA_ENABLED) return router.parseUrl('/');
  // voce già mostrata (anche dal ricordo dell'ultima volta): si entra subito, il controllo continua in sottofondo
  if (fl.visible()) { void fl.checkVisible().then((v) => { if (!v) void router.navigateByUrl('/'); }); return true; }
  await s.whenReady();
  return (await fl.checkVisible()) ? true : router.parseUrl('/');
};

/** Pagamenti in anteprima: come FantaLeader, solo chi è ammesso. */
export const paymentsGuard: CanActivateFn = async () => {
  const s = inject(Session);
  const pay = inject(Payments);
  const router = inject(Router);
  await s.whenReady();
  // già visti in questa sessione: si entra subito e il controllo riparte in sottofondo (come il resto dell'app);
  // se nel frattempo il Leader li chiude, la voce sparisce e il server rifiuta comunque i dati
  if (pay.visible()) { void pay.checkVisible(); return true; }
  // solo un «no» del server rimanda alla home; senza risposta si entra e la pagina mostra il suo errore
  return (await pay.checkVisible()) === false ? router.parseUrl('/') : true;
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
