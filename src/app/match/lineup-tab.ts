import { afterNextRender, ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { Ratings, SlotKind, suggestTeams, valueAt } from '../core/ratings';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import { fmtWhen } from '../core/format';
import { Team } from '../core/models';
import { formation } from '../core/formations';
import { Session } from '../core/session';
import { errorMessage } from '../core/supabase';
import { Toasts } from '../core/toast';
import { MatchStore } from './match-store';
import { Reprimand } from '../ui/reprimand';
import { Avatar } from '../ui/avatar';
import { Icon } from '../ui/icon';

interface Spot { team: Team; slot: number; x: number; y: number; label: string; short: string; kind: SlotKind }
interface Place { team: Team; slot: number | null }


@Component({
  selector: 'app-lineup-tab',
  imports: [FormsModule, Avatar, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.match(); as m) {
      <div class="stack-l">
        @if (editing()) {
          <section class="stack">
            <div class="spread">
              <h2>{{ statusTitle() }}</h2>
              <button class="btn small" [disabled]="busy()" (click)="suggest()">Consigliate</button>
            </div>
            <p class="small muted">{{ selected() ? 'Ora tocca una posizione in campo.' : 'Tocca un giocatore, poi la sua posizione. Tocca chi è già in campo per spostarlo o scambiarlo.' }}</p>
          </section>
        } @else {
          <section class="stack">
            <h2>{{ statusTitle() }}</h2>
            @if (myTeam(); as t) {
              <p class="mine" [class.black]="t === 'black'">Giochi con i {{ teamLabel()[t] }}</p>
            }
          </section>
        }

        @if (visible()) {
          <dialog #pickDlg class="sheet" (click)="$event.target === pickDlg && pickDlg.close()" aria-label="Scegli un giocatore">
            @if (pickFor(); as pf) {
              <button type="button" class="x-close" (click)="pickDlg.close()" aria-label="Chiudi"><span><app-icon name="x" [size]="16" /></span></button>
              <h3>{{ teamLabel()[pf.team] }} · {{ pf.label }}</h3>
              <p class="small muted">Disponibili, dal più adatto a questo posto.</p>
              <ul class="pick">
                @for (c of pickList(); track c.id) {
                  <li><button type="button" (click)="pickPlayer(c.id); pickDlg.close()">
                    <app-avatar [userId]="c.id" [size]="36" /><span class="grow">{{ session.name(c.id) }}</span>
                    @if (c.v !== null) { <span class="ovb static" [style.--h]="hue(c.v)">{{ c.v }}</span> }
                  </button></li>
                } @empty { <li class="small muted">Nessun giocatore disponibile.</li> }
              </ul>
            }
          </dialog>
          <div class="pitch" #pitch [class.tall]="perTeam() >= 7" [class.small]="smallPitch()" [style.height.px]="pitchH()" role="group" [attr.aria-label]="'Campo da calcio, ' + perTeam() + ' contro ' + perTeam()">
            <div class="lines" aria-hidden="true"></div>
            @for (s of spots(); track s.team + s.slot) {
              @let who = occupant(s);
              <button class="spot" [class.black]="s.team === 'black'" [class.filled]="!!who"
                      [class.sel]="!!who && who === selected()"
                      [style.left.%]="s.x" [style.top.%]="s.y" [disabled]="!editing() && !who"
                      [attr.aria-label]="teamLabel()[s.team] + ', ' + s.label + ': ' + (who ? session.name(who) : 'vuoto')"
                      (click)="tapSpot(s)">
                @if (who) {
                  <span class="ph"><app-avatar class="pitch-photo" [userId]="who" [size]="smallPitch() ? 38 : 46" [team]="s.team" />
                    @if (posValue(who, s); as v) { <span class="ovb" [style.--h]="hue(v)" [attr.aria-label]="'valore in questo posto ' + v">{{ v }}</span> }</span>
                } @else {
                  <span class="disc">{{ editing() ? '+' : '' }}</span>
                }
                <span class="name">{{ who ? session.name(who) : s.short }}</span>
              </button>
            }
            <!-- scheda del giocatore toccato: righe a cascata; un tocco fuori la chiude al contrario -->
            @if (info(); as inf) {
              <div class="shield" aria-hidden="true" (click)="closeInfo()"></div>
              <div class="pinfo panel" role="dialog" [attr.aria-label]="'Informazioni su ' + session.name(inf.id)" [class.closing]="infoClosing()"
                   [style.left.%]="inf.left" [style.top]="inf.top" [style.bottom]="inf.bottom">
                @for (r of infoRows(); track r.label; let i = $index) {
                  <div class="pr" [style.--i]="i" [style.--n]="infoRows().length" [class.head]="i === 0"><span>{{ r.label }}</span><strong class="num">{{ r.value }}</strong></div>
                }
              </div>
            }
            <!-- valore delle due squadre, ai lati del campo -->
            @for (t of teams; track t) {
              <div class="tv" [class.black]="t === 'black'" [attr.aria-label]="'Valore dei ' + teamLabel()[t] + ': ' + (teamValue()[t] ?? 'non disponibile')">
                <span>{{ teamLabel()[t] }}</span><b>{{ teamValue()[t] ?? '–' }}</b>
              </div>
            }
          </div>

          @if (editing()) {
            <section class="section">
              <header><h3>Da sistemare</h3><span class="small muted">{{ bench().length }}</span></header>
              <div class="row-wrap">
                @for (id of bench(); track id) {
                  <button class="chip" [attr.aria-pressed]="selected() === id" (click)="select(id)">{{ session.name(id) }}</button>
                } @empty { <p class="small muted">Tutti in campo.</p> }
              </div>
              @if (selected() && placeOf(selected()!)) {
                <button class="btn small ghost" (click)="bench1()">Togli {{ session.name(selected()!) }} dal campo</button>
              }
            </section>

            <div class="stack">
              @if (session.isStaff()) {
                <button class="btn primary block" [disabled]="busy()" (click)="save(true)">
                  {{ m.lineup_status === 'official' ? 'Salva e avvisa i giocatori' : 'Pubblica le formazioni' }}
                </button>
                @if (m.lineup_status !== 'official') {
                  <button class="btn block" [disabled]="busy()" (click)="save(false)">Salva come bozza</button>
                }
              } @else {
                <button class="btn primary block" [disabled]="busy()" (click)="save(true)">Invia per l'approvazione</button>
                <button class="btn block" [disabled]="busy()" (click)="save(false)">Salva bozza</button>
              }
            </div>
          } @else if (m.lineup_status === 'official') {
            <div class="teams">
              @for (t of teams; track t) {
                <div class="panel">
                  <h3>{{ teamLabel()[t] }}</h3>
                  <ul>
                    @for (l of byTeam(t); track l.user_id) {
                      <li>{{ session.name(l.user_id) }} <span class="muted small">{{ slotLabel(l.field_slot) }}</span></li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        } @else {
          <p class="empty">
            @if (!store.t()?.lineupOpen) { Le squadre si fanno da {{ when(m.lineup_opens_at) }}. }
            @else if (m.lineup_status === 'pending') { Le formazioni sono in attesa di approvazione. }
            @else { Le squadre non sono ancora state fatte. Riceverai un avviso. }
          </p>
        }

        @if (session.isStaff() && m.lineup_status === 'pending') {
          <section class="panel stack">
            <h3>Proposta di {{ session.name(m.lineup_proposed_by) }}</h3>
            <p class="small muted">Le formazioni diventano pubbliche solo dopo l'approvazione di Leader o Premier.</p>
            <div class="row">
              <button class="btn primary" [disabled]="busy()" (click)="review(true)">Approva e pubblica</button>
              <button class="btn" [disabled]="busy()" (click)="review(false)">Rimanda indietro</button>
            </div>
          </section>
        }

        @if (session.isLeader() && !m.locked) {
          <section class="panel stack">
            <h3>Chi fa le squadre</h3>
            <p class="small muted">Di norma Leader e Premier. Puoi affidarle a un giocatore solo per questa partita: la sua proposta andrà approvata.</p>
            <select class="input" [ngModel]="m.lineup_delegate ?? ''" (ngModelChange)="setDelegate($event)" aria-label="Delegato">
              <option value="">Solo Leader e Premier</option>
              @for (mb of session.accountMembers(); track mb.id) { <option [value]="mb.id">{{ session.name(mb.id) }}</option> }
            </select>
          </section>
        }
      </div>
    }
  `,
  styles: `
    .mine { display: inline-flex; align-self: flex-start; padding: 10px 16px; border-radius: 999px; font: 700 var(--step-1)/1 var(--font-display);
      background: var(--team-a); color: var(--team-a-ink); box-shadow: inset 0 0 0 1.5px var(--line); }
    .mine.black { background: var(--team-b); color: var(--team-b-ink); box-shadow: none; }
    .spot .val { font: 800 0.68rem/1 var(--font-display); padding: 2px 5px; border-radius: 6px; background: rgb(0 0 0 / 45%); color: #fff; margin-top: 1px; }
    .tv { position: absolute; left: 6px; top: 25%; transform: translateY(-50%); display: flex; flex-direction: column; align-items: center; gap: 1px;
          padding: 4px 7px; border-radius: 10px; background: rgb(255 255 255 / 88%); color: #14201a; font: 600 0.62rem/1.1 var(--font-body); z-index: 2; pointer-events: none; }
    .tv b { font: 800 1.05rem/1 var(--font-display); }
    .tv.black { top: 75%; background: rgb(20 32 26 / 88%); color: #fff; }
    /* badge del valore sulla foto, dal rosso al verde */
    .ph { position: relative; display: block; }
    .ovb { position: absolute; right: -6px; top: -4px; min-width: 22px; height: 22px; padding: 0 3px; border-radius: 11px; display: grid; place-items: center;
           font: 800 0.7rem/1 var(--font-display); color: #fff; background: hsl(var(--h) 72% 36%); box-shadow: 0 0 0 2px #fff; }
    .ovb.static { position: static; box-shadow: none; }
    .spot .name { max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.72rem; }
    .pitch.small .spot { width: 64px; } .pitch.small .spot .name { max-width: 62px; font-size: 0.66rem; }
    .pitch.small .disc { width: 38px; height: 38px; }
    /* scheda del giocatore: fondo pieno e ombra per staccarsi dal campo; righe a cascata */
    .shield { position: absolute; inset: 0; z-index: 4; }
    .pinfo { position: absolute; z-index: 5; transform: translateX(-50%); width: 190px; padding: 8px 10px; display: flex; flex-direction: column; gap: 2px;
             background: var(--surface); color: var(--ink); box-shadow: 0 12px 30px rgb(0 0 0 / 40%), 0 0 0 1px var(--line); }
    .pr { display: flex; justify-content: space-between; gap: 8px; font-size: var(--step--1); padding: 2px 0;
          animation: pr-in 220ms var(--ease-out) both; animation-delay: calc(var(--i) * 55ms); }
    .pr.head { font-weight: 800; border-bottom: 1px solid var(--line); padding-bottom: 4px; margin-bottom: 2px; }
    .pinfo.closing .pr { animation: pr-out 160ms ease-in both; animation-delay: calc((var(--n) - 1 - var(--i)) * 55ms); }
    @keyframes pr-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
    @keyframes pr-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-6px); } }
    @media (prefers-reduced-motion: reduce) { .pr, .pinfo.closing .pr { animation: none; } }
    .pick { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .pick button { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 4px 6px; border: 0; border-radius: var(--r-s); background: none; color: var(--ink); font: 600 var(--step-0)/1.2 var(--font-body); cursor: pointer; text-align: left; }
    .pick button:hover { background: var(--surface-2); }
    dialog.sheet { position: fixed; inset: auto 0 0 0; margin: 0 auto; width: 100%; max-width: 560px; max-height: 80dvh; overflow-y: auto; border: 0; color: var(--ink);
                   background: var(--surface); border-radius: 22px 22px 0 0; padding: 18px 16px calc(20px + env(safe-area-inset-bottom, 0px)); }
    dialog.sheet::backdrop { background: rgb(10 20 14 / 45%); }
    dialog.sheet h3 { margin: 4px 48px 4px 0; }
    .pitch {
      position: relative; aspect-ratio: 3 / 4.4; width: 100%; border-radius: var(--r-m); overflow: hidden;
      background: repeating-linear-gradient(180deg, #24774c 0 10%, #1f6b45 10% 20%);
    }
    .pitch.tall { aspect-ratio: 3 / 5.2; }
    .lines { position: absolute; inset: 10px; border: 2px solid rgb(255 255 255 / 75%); border-radius: 4px; }
    .lines::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; border-top: 2px solid rgb(255 255 255 / 75%); }
    .lines::after { content: ''; position: absolute; left: 50%; top: 50%; width: 22%; aspect-ratio: 1; transform: translate(-50%, -50%);
      border: 2px solid rgb(255 255 255 / 75%); border-radius: 50%; }
    .pitch::before, .pitch::after { content: ''; position: absolute; left: 32%; right: 32%; height: 9%; border: 2px solid rgb(255 255 255 / 75%); z-index: 0; }
    .pitch::before { top: 10px; border-top: 0; border-radius: 0 0 50% 50%; }
    .pitch::after { bottom: 10px; border-bottom: 0; border-radius: 50% 50% 0 0; }
    .spot {
      position: absolute; z-index: 1; transform: translate(-50%, -50%);
      appearance: none; border: 0; background: none; padding: 0; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 3px; width: 76px; color: #fff;
    }
    .spot:disabled { cursor: default; }
    .disc {
      width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center;
      font: 700 1rem/1 var(--font-display);
      background: rgb(255 255 255 / 18%); border: 2px dashed rgb(255 255 255 / 70%); color: #fff;
      transition: transform 200ms var(--ease-spring);
    }
    .spot.filled .disc { background: var(--kit-white); color: var(--kit-white-ink); border: 2px solid #fff; box-shadow: 0 3px 8px rgb(0 0 0 / 30%); }
    .spot.black.filled .disc { background: var(--kit-black); color: var(--kit-black-ink); border-color: #000; }
    .spot.sel .disc { transform: scale(1.15); box-shadow: 0 0 0 4px var(--armband); }
    /* giocatore in campo: foto (o iniziali) con l'anello del colore della squadra */
    .pitch-photo { transition: transform 200ms var(--ease-spring); font-weight: 700; }
    .pitch-photo.white { background: var(--team-a); color: var(--team-a-ink); box-shadow: 0 0 0 3px var(--team-a), 0 0 0 4px rgb(0 0 0 / 25%), 0 3px 8px rgb(0 0 0 / 35%); }
    .pitch-photo.black { background: var(--team-b); color: var(--team-b-ink); box-shadow: 0 0 0 3px var(--team-b), 0 0 0 4px rgb(0 0 0 / 25%), 0 3px 8px rgb(0 0 0 / 35%); }
    .spot.sel .pitch-photo { transform: scale(1.15); box-shadow: 0 0 0 4px var(--armband), 0 3px 8px rgb(0 0 0 / 35%); }
    .name { font-size: 0.72rem; font-weight: 600; max-width: 76px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-shadow: 0 1px 2px rgb(0 0 0 / 60%); }
    .teams { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .teams ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  `,
})
export class LineupTab {
  protected readonly store = inject(MatchStore);
  protected readonly session = inject(Session);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly reprimand = inject(Reprimand);

  protected readonly teams: Team[] = ['white', 'black'];
  protected readonly teamLabel = computed(() => this.store.teamNames());
  protected readonly when = fmtWhen;
  /** posizioni in campo per il numero di giocatori della partita: squadra A in alto, B speculare in basso */
  protected readonly perTeam = computed(() => this.store.match()?.players_per_team ?? 5);
  protected readonly spots = computed<Spot[]>(() =>
    this.teams.flatMap((team) =>
      formation(this.perTeam()).map(({ slot, label, short, x, y, kind }) => ({ team, slot, label, short, kind, x, y: team === 'white' ? y : 100 - y })),
    ),
  );

  protected readonly draft = signal(new Map<string, Place>());
  protected readonly selected = signal<string | null>(null);

  // ------------------------------------------------ campo adattato allo spazio fino alla barra in basso
  private readonly pitchEl = viewChild<ElementRef<HTMLElement>>('pitch');
  protected readonly pitchH = signal<number | null>(null);
  protected readonly smallPitch = computed(() => (this.pitchH() ?? 999) < 560);
  private fitPitch(): void {
    const el = this.pitchEl()?.nativeElement; const sc = el?.closest('.scroll-area') as HTMLElement | null;
    if (!el || !sc) return;
    const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const w = el.clientWidth;
    // tra un minimo (telefoni bassi) e un massimo (niente campo troppo allungato)
    // minimo 460 px: su schermi bassissimi meglio far scorrere appena la pagina che sovrapporre i giocatori
    this.pitchH.set(Math.round(Math.max(460, Math.min(w * 1.9, sc.clientHeight - top - 12))));
  }
  private readonly hostRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  protected hue(v: number): number { return 130 * Math.max(0, Math.min(1, (v - 50) / 35)); }

  // ------------------------------------------------ scheda del giocatore (a cascata)
  protected readonly info = signal<{ id: string; left: number; top: string | null; bottom: string | null } | null>(null);
  protected readonly infoClosing = signal(false);
  private readonly avgVotes = signal<Map<string, number | null>>(new Map());
  protected readonly infoRows = computed(() => {
    const inf = this.info(); if (!inf) return [];
    const c = this.ratings.cards().get(inf.id);
    const v = this.avgVotes().get(inf.id);
    return [
      { label: this.session.name(inf.id), value: '' },
      { label: 'Punta', value: c?.pu ?? '–' }, { label: 'Esterno offensivo', value: c?.eo ?? '–' },
      { label: 'Esterno difensivo', value: c?.ed ?? '–' }, { label: 'Difensore centrale', value: c?.dc ?? '–' },
      { label: 'Media voto', value: v != null ? String(Math.round(v * 100) / 100).replace('.', ',') : '–' },
    ];
  });
  protected openInfo(id: string, s: Spot): void {
    if (!this.avgVotes().size) void this.api.stats(null, null).then((rows) => this.avgVotes.set(new Map(rows.map((r) => [r.user_id, r.avg_vote])))).catch(() => undefined);
    const left = Math.max(26, Math.min(74, s.x));
    // metà alta: sotto il giocatore; metà bassa: sopra (copre meno gli altri)
    this.infoClosing.set(false);
    this.info.set(s.y < 50 ? { id, left, top: `calc(${s.y}% + 34px)`, bottom: null } : { id, left, top: null, bottom: `calc(${100 - s.y}% + 34px)` });
  }
  protected closeInfo(): void {
    if (this.infoClosing()) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.infoClosing.set(true);
    setTimeout(() => { this.info.set(null); this.infoClosing.set(false); }, reduce ? 0 : 60 * this.infoRows().length + 180);
  }

  // ------------------------------------------------ posto vuoto: scelta tra i disponibili, dal più adatto
  private readonly pickDlg = viewChild<ElementRef<HTMLDialogElement>>('pickDlg');
  protected readonly pickFor = signal<Spot | null>(null);
  protected readonly pickList = computed(() => {
    const s = this.pickFor(); if (!s) return [];
    return this.bench().map((b) => ({ id: typeof b === 'string' ? b : (b as { user_id: string }).user_id, v: null as number | null }))
      .map((x) => ({ ...x, v: valueAt(this.ratings.cards().get(x.id), s.kind) }))
      .sort((a, b) => (b.v ?? -1) - (a.v ?? -1) || this.session.name(a.id).localeCompare(this.session.name(b.id), 'it'));
  });
  protected openPick(s: Spot): void {
    this.pickFor.set(s);
    queueMicrotask(() => this.pickDlg()?.nativeElement.showModal());
  }
  protected pickPlayer(id: string): void {
    const s = this.pickFor(); if (!s) return;
    const d = new Map(this.draft()); d.set(id, { team: s.team, slot: s.slot }); this.draft.set(d); this.pickFor.set(null);
  }
  protected readonly busy = signal(false);

  protected readonly editing = computed(() => {
    const m = this.store.match();
    const t = this.store.t();
    if (!m || !t || !t.lineupOpen || !this.store.canEditLineup()) return false;
    if (t.locked && !this.session.isLeader()) return false;
    if (!this.session.isStaff() && m.lineup_status !== 'draft') return false;
    return true;
  });

  protected readonly visible = computed(() =>
    this.editing() || this.store.match()?.lineup_status === 'official' || (this.session.isStaff() && this.store.lineup().length > 0),
  );

  protected readonly statusTitle = computed(() => {
    const s = this.store.match()?.lineup_status;
    if (s === 'official') return 'Formazioni ufficiali';
    if (s === 'pending') return 'Proposta in attesa';
    return this.editing() ? 'Fai le squadre' : 'Squadre';
  });

  protected readonly myTeam = computed(() =>
    this.store.match()?.lineup_status === 'official' ? this.store.teamOf().get(this.session.uid() ?? '') ?? null : null,
  );

  protected readonly bench = computed(() => {
    const d = this.draft();
    return this.store.team().map((b) => b.user_id).filter((id) => !d.get(id)?.slot);
  });

  constructor() {
    afterNextRender(() => {
      const ro = new ResizeObserver(() => this.fitPitch());
      ro.observe(this.hostRef.nativeElement as HTMLElement);
      const sc = (this.hostRef.nativeElement as HTMLElement).closest('.scroll-area'); if (sc) ro.observe(sc);
      this.fitPitch();
      this.destroyRef.onDestroy(() => ro.disconnect());
    });
    // valori dei titolari e di chi è in formazione
    effect(() => {
      const ids = [...new Set([...this.store.team().map((b) => b.user_id), ...this.store.lineup().map((l) => l.user_id)])];
      if (ids.length) void this.ratings.load(ids).catch(() => undefined);
    });
    // la bozza riparte da quanto salvato ogni volta che il server cambia
    effect(() => {
      const players = new Set(this.store.team().map((b) => b.user_id));
      this.draft.set(new Map(this.store.lineup().filter((l) => players.has(l.user_id)).map((l) => [l.user_id, { team: l.team, slot: l.field_slot }])));
    });
  }

  protected occupant(s: Spot): string | null {
    for (const [id, p] of this.draft()) if (p.team === s.team && p.slot === s.slot) return id;
    return null;
  }

  protected placeOf(id: string): Place | undefined {
    return this.draft().get(id);
  }

  protected byTeam(t: Team) {
    return this.store.lineup().filter((l) => l.team === t).sort((a, b) => (a.field_slot ?? 9) - (b.field_slot ?? 9));
  }

  protected slotLabel(slot: number | null): string {
    return formation(this.perTeam()).find((f) => f.slot === slot)?.label ?? '';
  }

  protected select(id: string): void {
    this.selected.set(this.selected() === id ? null : id);
  }

  protected tapSpot(s: Spot): void {
    const sel = this.selected();
    const who = this.occupant(s);
    // fuori dalla modifica: il tocco apre la scheda del giocatore
    if (!this.editing()) { if (who) this.openInfo(who, s); return; }
    if (!sel) {
      if (who) this.selected.set(who);
      else this.openPick(s);   // posto vuoto: scelta tra i disponibili
      return;
    }
    const d = new Map(this.draft());
    const from = d.get(sel);
    if (who && who !== sel) {
      // scambio: chi era lì prende il posto (o la panchina) del selezionato
      if (from?.slot) d.set(who, { ...from });
      else d.delete(who);
    }
    d.set(sel, { team: s.team, slot: s.slot });
    this.draft.set(d);
    this.selected.set(null);
  }

  protected bench1(): void {
    const id = this.selected();
    if (!id) return;
    const d = new Map(this.draft());
    d.delete(id);
    this.draft.set(d);
    this.selected.set(null);
  }

  // ------------------------------------------------ valori e formazioni consigliate
  private readonly ratings = inject(Ratings);

  /** valore del giocatore nel posto (portiere = valore generale con il bonus) */
  protected posValue(id: string, s: Spot): number | null {
    return valueAt(this.ratings.cards().get(id), s.kind);
  }

  /** valore di ogni squadra: media dei valori di chi è in campo */
  protected readonly teamValue = computed(() => {
    const out: Record<Team, number | null> = { white: null, black: null };
    for (const t of this.teams) {
      const vals = this.spots().filter((s) => s.team === t).map((s) => { const w = this.occupant(s); return w ? this.posValue(w, s) : null; })
        .filter((v): v is number => v !== null);
      out[t] = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
    }
    return out;
  });

  /** «Consigliate»: squadre il più equilibrate possibile, ognuno nel posto più adatto */
  protected async suggest(): Promise<void> {
    const ids = this.store.team().map((b) => b.user_id);
    await this.ratings.load(ids).catch(() => undefined);
    const f = formation(this.perTeam());
    const missing = ids.filter((id) => !this.ratings.cards().get(id)?.has);
    const r = suggestTeams(ids, f.map((p) => p.kind), (id, k) => valueAt(this.ratings.cards().get(id), k) ?? 50);
    const d = new Map<string, Place>();
    r.a.forEach((x) => d.set(x.id, { team: 'white', slot: x.slotIndex >= 0 ? f[x.slotIndex].slot : null }));
    r.b.forEach((x) => d.set(x.id, { team: 'black', slot: x.slotIndex >= 0 ? f[x.slotIndex].slot : null }));
    ids.filter((id) => !d.has(id)).forEach((id, i) => d.set(id, { team: i % 2 ? 'black' : 'white', slot: null }));
    this.draft.set(d);
    this.selected.set(null);
    this.toasts.show(`Squadre consigliate: Bianchi ${Math.round(r.avgA)}, Neri ${Math.round(r.avgB)}.`
      + (missing.length ? ` ${missing.length === 1 ? '1 giocatore senza valori, contato' : missing.length + ' giocatori senza valori, contati'} 50.` : ''));
  }

  protected async save(publish: boolean): Promise<void> {
    if (this.reprimand.guard()) return;
    const entries = [...this.draft()].map(([user_id, p]) => ({ user_id, team: p.team, field_slot: p.slot }));
    if (publish && this.bench().length && !confirm(`${this.bench().length} giocatori non hanno un posto in campo. Procedo lo stesso?`)) return;
    await this.run(async () => {
      const status = await this.api.saveLineup(this.store.match()!.id, entries, publish);
      await Promise.all([this.store.reload('matches'), this.store.reload('lineup')]);
      this.toasts.show(status === 'official' ? 'Formazioni pubblicate: i giocatori sono stati avvisati.'
        : status === 'pending' ? 'Proposta inviata a Leader e Premier.' : 'Bozza salvata.');
    });
  }

  protected async review(approve: boolean): Promise<void> {
    await this.run(async () => {
      await this.api.reviewLineup(this.store.match()!.id, approve);
      await Promise.all([this.store.reload('matches'), this.store.reload('lineup')]);
      this.toasts.show(approve ? 'Formazioni pubblicate.' : 'Proposta rimandata indietro.');
    });
  }

  protected async setDelegate(id: string): Promise<void> {
    await this.run(async () => {
      await this.api.setLineupDelegate(this.store.match()!.id, id || null);
      await this.store.reload('matches');
      this.toasts.show(id ? `Squadre affidate a ${this.session.name(id)}.` : 'Squadre di nuovo a Leader e Premier.');
    });
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.toasts.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
