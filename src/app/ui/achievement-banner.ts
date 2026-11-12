import { ChangeDetectionStrategy, Component, computed, effect, inject, OnDestroy, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Achievements } from '../core/achievements';
import { Session } from '../core/session';
import { Supabase } from '../core/supabase';
import { Icon } from './icon';

const SEEN_KEY = 'gdl-sticker-visti';
const LP_SEEN_KEY = 'gdl-punti-leader-visti';

/** Per 24 ore dallo sblocco, a tutti: «Nome ha vinto il premio Sticker», con l'immagine. Si può chiudere. */
@Component({
  selector: 'app-achievement-banner',
  imports: [RouterLink, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (g of shown(); track g.achievement_id) {
      @if (ach.byId(g.achievement_id); as a) {
        <div class="win" role="status">
          <span class="pic">@if (ach.imageUrl(a); as src) { <img [src]="src" alt="" /> } @else { <i aria-hidden="true">★</i> }</span>
          <a class="grow txt" routerLink="/classifica" [queryParams]="{ scheda: 'obiettivi' }">
            <strong>{{ who(g.users) }}</strong> {{ g.users.length === 1 ? 'ha vinto' : 'hanno vinto' }} il premio «<strong>{{ a.name }}</strong>»
          </a>
          <button class="x" (click)="dismiss(g)" aria-label="Chiudi l'avviso"><app-icon name="x" [size]="16" /></button>
        </div>
      }
    }
    <!-- Punti Leader: stesso riquadro, stesse 24 ore, stessa X -->
    @for (lp of lpShown(); track lp.id) {
      <div class="win" role="status">
        <span class="pic"><i aria-hidden="true">{{ lp.points > 0 ? '+' : '' }}{{ lp.points }}</i></span>
        <a class="grow txt" routerLink="/classifica" [queryParams]="{ scheda: 'punti' }">
          <strong>{{ session.name(lp.user_id) }}</strong> {{ lp.points > 0 ? 'ha ricevuto' : 'ha perso' }} {{ lp.points > 0 ? lp.points : -lp.points }} {{ (lp.points === 1 || lp.points === -1) ? 'Punto' : 'Punti' }} Leader: «{{ lp.reason }}»
        </a>
        <button class="x" (click)="dismissLp(lp.id)" aria-label="Chiudi l'avviso"><app-icon name="x" [size]="16" /></button>
      </div>
    }
  `,
  styles: `
    /* sovrapposto in cima all'app: non sposta la pagina */
    :host {
      position: fixed; z-index: 70; top: calc(env(safe-area-inset-top, 0px) + 8px); left: 50%; transform: translateX(-50%);
      width: min(616px, calc(100% - 24px)); display: flex; flex-direction: column; gap: 6px; pointer-events: none;
    }
    :host:empty { display: none; }
    .win { pointer-events: auto; animation: drop 260ms var(--ease-out, ease-out); }
    @keyframes drop { from { opacity: 0; transform: translateY(-12px); } to { opacity: 1; transform: none; } }
    @media (prefers-reduced-motion: reduce) { .win { animation: none; } }
    .win { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 10px; border-radius: 16px; min-width: 0;
           background: var(--armband); color: var(--armband-ink); box-shadow: 0 4px 14px rgb(0 0 0 / 22%), inset 0 0 0 1px rgb(0 0 0 / 8%); }
    .pic { width: 44px; height: 44px; border-radius: 50%; flex: none; display: grid; place-items: center; overflow: hidden; background: #fff; box-shadow: 0 0 0 2px var(--armband-ink); }
    .pic img { width: 100%; height: 100%; object-fit: contain; }
    .pic i { font-style: normal; font-size: 1.3rem; color: #3b2f00; font-weight: 800; }
    .txt { color: inherit; text-decoration: none; font-size: var(--step--1); line-height: 1.3; min-width: 0; }
    .x { appearance: none; border: 0; background: color-mix(in srgb, var(--armband-ink) 12%, transparent); color: inherit; width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; cursor: pointer; flex: none; }
  `,
})
export class AchievementBanner implements OnDestroy {
  protected readonly ach = inject(Achievements);
  private readonly sb = inject(Supabase).client;
  /** Punti Leader delle ultime 24 ore (come gli sticker) */
  private readonly lpRecent = signal<{ id: number; user_id: string; points: number; reason: string }[]>([]);
  private readonly lpSeen = signal<Set<number>>(this.readLpSeen());
  protected readonly lpShown = computed(() => this.lpRecent().filter((x) => !this.lpSeen().has(x.id)).slice(0, 3));
  protected readonly session = inject(Session);
  private readonly seen = signal<Set<string>>(this.readSeen());
  private readonly timer = setInterval(() => void this.refresh(), 5 * 60 * 1000);
  private readonly onVisible = () => { if (document.visibilityState === 'visible') void this.refresh(); };
  /** un avviso per sticker (chi l'ha vinto nelle ultime 24 ore e non è ancora stato visto), al massimo 3, dal più recente */
  protected readonly shown = computed(() => {
    const groups = new Map<string, { achievement_id: string; users: string[] }>();
    for (const u of this.ach.recent()) {
      if (this.seen().has(`${u.user_id}:${u.achievement_id}`)) continue;
      const g = groups.get(u.achievement_id) ?? { achievement_id: u.achievement_id, users: [] };
      g.users.push(u.user_id);
      groups.set(u.achievement_id, g);
    }
    return [...groups.values()].slice(0, 3);
  });

  /** «Paolo», «Paolo e Luca», «Paolo, Luca e altri 3» */
  protected who(users: string[]): string {
    const n = users.map((u) => this.session.name(u));
    if (n.length <= 2) return n.join(' e ');
    return `${n[0]}, ${n[1]} e ${n.length === 3 ? n[2] : 'altri ' + (n.length - 2)}`;
  }

  constructor() {
    document.addEventListener('visibilitychange', this.onVisible);
    effect(() => {
      if (this.session.uid()) untracked(() => void this.refresh());
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private async refresh(): Promise<void> {
    if (!this.session.uid()) return;
    await this.ach.load().catch(() => undefined);
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const r = await this.sb.from('leader_points').select('id, user_id, points, reason').gte('created_at', since).order('created_at', { ascending: false }).limit(10);
    if (!r.error) this.lpRecent.set((r.data ?? []) as { id: number; user_id: string; points: number; reason: string }[]);
  }
  protected dismissLp(id: number): void {
    const next = new Set(this.lpSeen()).add(id);
    this.lpSeen.set(next);
    try { localStorage.setItem(LP_SEEN_KEY, JSON.stringify([...next].slice(-500))); } catch { /* resta chiuso finché la pagina è aperta */ }
  }
  private readLpSeen(): Set<number> {
    try { return new Set(JSON.parse(localStorage.getItem(LP_SEEN_KEY) ?? '[]')); } catch { return new Set(); }
  }

  protected dismiss(g: { achievement_id: string; users: string[] }): void {
    const next = new Set(this.seen());
    for (const u of g.users) next.add(`${u}:${g.achievement_id}`);
    this.seen.set(next);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-500)));
    } catch {
      /* resta chiuso finché la pagina è aperta */
    }
  }

  private readSeen(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'));
    } catch {
      return new Set();
    }
  }
}
