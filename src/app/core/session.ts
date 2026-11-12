import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Me, Member, Profile } from './models';
import { Supabase } from './supabase';
import { Cache } from './cache';
import { NextMatch } from './next-match';
import { MatchStore } from '../match/match-store';
import { Api } from './api';

// Letto al caricamento del modulo, prima che Supabase consumi e ripulisca l'indirizzo del link di recupero
const RECOVERY_LINK = /type=recovery/.test(location.hash + location.search);

/** Stato dell'utente collegato e anagrafica del gruppo. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly sb = inject(Supabase).client;
  private readonly injector = inject(Injector);
  private readonly cache = inject(Cache);

  /** Entrato dal link dell'email di recupero: deve scegliere una nuova password. */
  readonly recovering = signal(RECOVERY_LINK);

  readonly auth = signal<AuthSession | null>(null);
  readonly me = signal<Me | null>(null);
  readonly members = signal<Member[]>([]);
  readonly ready = signal(false);
  /** punizione in corso dell'utente collegato (null se non è punito) */
  readonly punishment = signal<{ ends_at: string | null; reason: string | null; since: string } | null>(null);
  /** id utente -> link firmato della foto profilo */
  readonly avatarUrls = signal(new Map<string, string>());
  private readonly signedAvatars = new Map<string, { url: string; expires: number }>();

  readonly uid = computed(() => this.auth()?.user.id ?? null);
  readonly profile = computed<Profile | null>(() => this.me()?.profile ?? null);
  readonly isLeader = computed(() => this.me()?.leader_powers ?? false);
  readonly isStaff = computed(() => this.me()?.staff ?? false);
  readonly memberMap = computed(() => new Map(this.members().map((m) => [m.id, m])));
  readonly activeMembers = computed(() =>
    this.members().filter((m) => m.active).sort((a, b) => this.name(a.id).localeCompare(this.name(b.id), 'it')),
  );
  /** membri attivi con un account: gli unici che possono agire (prenotarsi, ricevere deleghe, ...) */
  readonly accountMembers = computed(() => this.activeMembers().filter((m) => !m.guest));

  private readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.init();
  }

  whenReady(): Promise<void> {
    return this.readyPromise;
  }

  private async init(): Promise<void> {
    const { data } = await this.sb.auth.getSession();
    this.auth.set(data.session);
    this.useCacheFor(data.session?.user.id ?? null);
    // avvio immediato: con i dati dell'ultima volta l'app parte subito e si aggiorna in sottofondo
    if (data.session && this.restoreSaved()) void this.refresh().catch(() => undefined);
    else if (data.session) await this.refresh();
    this.ready.set(true);
    this.sb.auth.onAuthStateChange((event, session) => {
      this.auth.set(session);
      if (event === 'SIGNED_IN') { this.useCacheFor(session?.user.id ?? null); void this.refresh(); }
      if (event === 'PASSWORD_RECOVERY') {
        this.recovering.set(true);
        void this.injector.get(Router).navigateByUrl('/nuova-password');
      }
      if (event === 'SIGNED_OUT') {
        // via i dati salvati di chi è uscito (in RAM e sul telefono)
        this.forget();
        this.me.set(null);
        this.members.set([]);
        this.punishment.set(null);
      }
    });
    // riallinea "ultimo accesso" quando l'app torna in primo piano (regola dei 15 giorni)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.auth()) void this.refresh();
    });
  }

  /** dati salvati dell'utente collegato (core/cache.ts): la prossima partita si riprende subito */
  private useCacheFor(uid: string | null): void {
    this.cache.setUser(uid);
    if (uid) this.injector.get(NextMatch).restore();
  }

  /** riprende profilo, membri e link delle foto salvati sul telefono; false se non ci sono */
  private restoreSaved(): boolean {
    const me = this.cache.get<Me>('me');
    const members = this.cache.get<Member[]>('members');
    if (!me || !members?.length) return false;
    this.me.set(me);
    this.members.set(members);
    this.punishment.set(this.cache.get<{ ends_at: string | null; reason: string | null; since: string } | null>('punishment') ?? null);
    this.restoreAvatars(members);
    return true;
  }

  async refresh(): Promise<void> {
    // una chiamata sola (migrazione 45); se il database non ce l'ha ancora, le chiamate di prima
    const b = await this.injector.get(Api).bootstrap().catch(() => null);
    if (b) {
      if (b.me) { this.me.set(b.me as Me); this.cache.set('me', b.me, true); }
      this.punishment.set((b.punishment as { ends_at: string | null; reason: string | null; since: string } | null) ?? null);
      this.cache.set('punishment', this.punishment(), true);
      await this.setMembers(b.members as Member[]);
      return;
    }
    const [{ data, error }] = await Promise.all([this.sb.rpc('touch'), this.refreshPunishment()]);
    if (!error && data) {
      this.me.set(data as Me);
      this.cache.set('me', data, true);
    }
    await this.loadMembers();
  }

  async refreshPunishment(): Promise<void> {
    if (!this.auth()) return this.punishment.set(null);
    const { data } = await this.sb.rpc('my_punishment');
    this.punishment.set((data as { ends_at: string | null; reason: string | null; since: string } | null) ?? null);
    this.cache.set('punishment', this.punishment(), true);
  }

  async loadMembers(): Promise<void> {
    const { data } = await this.sb.from('members').select('*');
    if (data) await this.setMembers(data as Member[]);
  }

  private async setMembers(list: Member[]): Promise<void> {
    this.members.set(list);
    this.cache.set('members', list, true);
    await this.signAvatars(list);
  }

  /**
   * Le foto stanno in un contenitore privato: servono link firmati, validi 7 giorni.
   * Si firmano solo le foto nuove o in scadenza, così il browser riusa le immagini già scaricate.
   */
  private async signAvatars(members: Member[]): Promise<void> {
    const week = 7 * 24 * 3600;
    const now = Date.now();
    const toSign = [...new Set(members.map((m) => m.avatar_path).filter((p): p is string => !!p))]
      .filter((p) => (this.signedAvatars.get(p)?.expires ?? 0) < now + 24 * 3600_000);
    if (toSign.length) {
      const { data } = await this.sb.storage.from('avatars').createSignedUrls(toSign, week);
      for (const d of data ?? []) {
        if (d.path && d.signedUrl) this.signedAvatars.set(d.path, { url: d.signedUrl, expires: now + week * 1000 });
      }
      // salvati sul telefono: alla prossima apertura stesso indirizzo, quindi la foto arriva dalla cache del browser
      this.cache.set('avatars', [...this.signedAvatars], true);
    }
    const urls = new Map<string, string>();
    for (const m of members) {
      const s = m.avatar_path ? this.signedAvatars.get(m.avatar_path) : undefined;
      if (s) urls.set(m.id, s.url);
    }
    this.avatarUrls.set(urls);
  }

  /** link firmati salvati e ancora validi: le foto si vedono subito, senza rifirmarle */
  private restoreAvatars(members: Member[]): void {
    const now = Date.now();
    for (const [path, v] of this.cache.get<[string, { url: string; expires: number }][]>('avatars') ?? []) {
      if (v.expires > now + 3600_000) this.signedAvatars.set(path, v);
    }
    const urls = new Map<string, string>();
    for (const m of members) {
      const sa = m.avatar_path ? this.signedAvatars.get(m.avatar_path) : undefined;
      if (sa) urls.set(m.id, sa.url);
    }
    this.avatarUrls.set(urls);
  }

  /** Nome da mostrare: soprannome se visibile, altrimenti nome. */
  name(id: string | null | undefined): string {
    if (!id) return '';
    const m = this.memberMap().get(id);
    if (!m) return 'Ex giocatore';
    return m.nickname?.trim() || m.first_name;
  }

  fullName(id: string): string {
    const m = this.memberMap().get(id);
    if (!m) return 'Ex giocatore';
    return [m.first_name, m.last_name].filter(Boolean).join(' ');
  }

  initials(id: string): string {
    const words = this.name(id).trim().split(/\s+/);
    return (words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2)).toUpperCase();
  }

  async signIn(email: string, password: string) {
    return this.sb.auth.signInWithPassword({ email, password });
  }

  /** linkToken: invito personale a collegarsi a un giocatore senza account */
  async signUp(email: string, password: string, firstName: string, inviteCode: string, linkToken: string | null = null) {
    return this.sb.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, invite_code: inviteCode || null, link_token: linkToken },
        emailRedirectTo: location.origin + document.baseURI.replace(location.origin, ''),
      },
    });
  }

  /** Email con il link per scegliere una nuova password (serve un SMTP configurato su Supabase). */
  async requestPasswordReset(email: string) {
    return this.sb.auth.resetPasswordForEmail(email, { redirectTo: new URL('nuova-password', document.baseURI).href });
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.sb.auth.updateUser({ password });
    if (error) throw error;
    await this.sb.rpc('password_changed');
    this.recovering.set(false);
    await this.refresh();
  }

  async signInWithGoogle() {
    return this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: document.baseURI } });
  }

  get googleEnabled(): boolean {
    return environment.googleLogin;
  }

  async signOut(): Promise<void> {
    // prima di tutto via i dati salvati, anche se la chiamata di uscita non andasse a buon fine
    this.forget();
    await this.sb.auth.signOut();
  }

  /** dati di chi esce: cache (RAM e telefono), partita aperta, prossima partita */
  private forget(): void {
    this.cache.clear();
    this.cache.setUser(null);
    this.injector.get(MatchStore).reset();
    this.injector.get(NextMatch).id.set(null);
  }
}
