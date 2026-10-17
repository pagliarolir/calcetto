import { computed, inject, Injectable, Injector, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';
import { Me, Member, Profile } from './models';
import { Supabase } from './supabase';

// Letto al caricamento del modulo, prima che Supabase consumi e ripulisca l'indirizzo del link di recupero
const RECOVERY_LINK = /type=recovery/.test(location.hash + location.search);

/** Stato dell'utente collegato e anagrafica del gruppo. */
@Injectable({ providedIn: 'root' })
export class Session {
  private readonly sb = inject(Supabase).client;
  private readonly injector = inject(Injector);

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
    if (data.session) await this.refresh();
    this.ready.set(true);
    this.sb.auth.onAuthStateChange((event, session) => {
      this.auth.set(session);
      if (event === 'SIGNED_IN') void this.refresh();
      if (event === 'PASSWORD_RECOVERY') {
        this.recovering.set(true);
        void this.injector.get(Router).navigateByUrl('/nuova-password');
      }
      if (event === 'SIGNED_OUT') {
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

  async refresh(): Promise<void> {
    const [{ data, error }] = await Promise.all([this.sb.rpc('touch'), this.refreshPunishment()]);
    if (!error && data) this.me.set(data as Me);
    await this.loadMembers();
  }

  async refreshPunishment(): Promise<void> {
    if (!this.auth()) return this.punishment.set(null);
    const { data } = await this.sb.rpc('my_punishment');
    this.punishment.set((data as { ends_at: string | null; reason: string | null; since: string } | null) ?? null);
  }

  async loadMembers(): Promise<void> {
    const { data } = await this.sb.from('members').select('*');
    if (data) {
      this.members.set(data as Member[]);
      await this.signAvatars(data as Member[]);
    }
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
    }
    const urls = new Map<string, string>();
    for (const m of members) {
      const s = m.avatar_path ? this.signedAvatars.get(m.avatar_path) : undefined;
      if (s) urls.set(m.id, s.url);
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

  async signUp(email: string, password: string, firstName: string, inviteCode: string) {
    return this.sb.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, invite_code: inviteCode || null },
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
    await this.sb.auth.signOut();
  }
}
