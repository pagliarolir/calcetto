import { inject, Injectable, signal } from '@angular/core';
import { SwPush } from '@angular/service-worker';
import { environment } from '../../environments/environment';
import { Session } from './session';
import { Supabase } from './supabase';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

/** Iscrizione del dispositivo alle notifiche push (REQ-049). */
@Injectable({ providedIn: 'root' })
export class Push {
  private readonly swPush = inject(SwPush);
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);

  readonly state = signal<PushState>('off');

  readonly isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  readonly isStandalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

  constructor() {
    void this.check();
  }

  async check(): Promise<void> {
    if (this.isIos && !this.isStandalone) return this.state.set('needs-install');
    if (!this.swPush.isEnabled || !('Notification' in window)) return this.state.set('unsupported');
    if (Notification.permission === 'denied') return this.state.set('denied');
    const sub = await navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).catch(() => null);
    this.state.set(sub && Notification.permission === 'granted' ? 'on' : 'off');
    // mantiene allineato il server se l'iscrizione esiste già (es. cambio utente)
    if (sub && this.session.uid()) await this.save(sub);
  }

  async enable(): Promise<void> {
    const sub = await this.swPush.requestSubscription({ serverPublicKey: environment.vapidPublicKey });
    await this.save(sub);
    this.state.set('on');
  }

  async disable(): Promise<void> {
    const sub = await navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription());
    if (sub) {
      await this.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
      await this.swPush.unsubscribe().catch(() => sub.unsubscribe());
    }
    this.state.set('off');
  }

  private async save(sub: PushSubscription): Promise<void> {
    const json = sub.toJSON();
    const uid = this.session.uid();
    if (!uid || !json.keys) return;
    await this.sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await this.sb.from('push_subscriptions').insert({
      user_id: uid,
      endpoint: sub.endpoint,
      p256dh: json.keys['p256dh'],
      auth: json.keys['auth'],
      user_agent: navigator.userAgent.slice(0, 200),
    });
  }
}
