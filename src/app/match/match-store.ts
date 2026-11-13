import { computed, inject, Injectable, signal } from '@angular/core';
import { Api, MatchBundle } from '../core/api';
import { Cache } from '../core/cache';
import { BoardRow, LineupRow, Match, Result, ResultReview, Scorer, Team } from '../core/models';
import { Session } from '../core/session';
import { teamNames } from '../core/kits';

/**
 * Stato della partita aperta, condiviso tra le schede (lista, squadre, risultato, voti, chat) e tenuto per tutta l'app:
 * tornando sulla partita i dati si vedono subito (anche quelli salvati sul telefono, vedi core/cache.ts)
 * e si aggiornano in sottofondo; l'ascolto in tempo reale resta attivo anche mentre si guarda un'altra pagina.
 */
@Injectable({ providedIn: 'root' })
export class MatchStore {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private readonly cache = inject(Cache);
  private stopWatch: (() => void) | null = null;
  private currentId: string | null = null;
  private ticker = setInterval(() => this.now.set(Date.now()), 30_000);

  readonly now = signal(Date.now());
  readonly match = signal<Match | null>(null);
  readonly board = signal<BoardRow[]>([]);
  readonly lineup = signal<LineupRow[]>([]);
  readonly result = signal<Result | null>(null);
  readonly reviews = signal<ResultReview[]>([]);
  readonly scorers = signal<Scorer[]>([]);
  /** finestre di precedenza: chi le ha può prenotarsi prima dell'apertura */
  readonly windows = signal<{ user_id: string; opens_at: string }[]>([]);
  /** ultimo messaggio in chat scritto da altri e ultimo già visto su questo telefono: pallino della Chat */
  readonly chatLast = signal<string | null>(null);
  readonly chatSeen = signal<string | null>(null);
  readonly chatUnread = computed(() => {
    const last = this.chatLast();
    if (!last) return false;
    const seen = this.chatSeen();
    return !seen || new Date(last).getTime() > new Date(seen).getTime();
  });
  readonly loading = signal(true);
  readonly notFound = signal(false);

  /** modalità "sceglie il Leader": nessun ordine, decide il Leader */
  readonly free = computed(() => this.match()?.booking_mode === 'free');
  /** disponibili in attesa della scelta del Leader (solo modalità "sceglie il Leader") */
  readonly pending = computed(() => this.board().filter((b) => b.list === 'pending'));
  /** posti in lista: 5 contro 5 = 10, 6 contro 6 = 12, ... */
  readonly size = computed(() => (this.match()?.players_per_team ?? 5) * 2);
  /** nomi delle due squadre della partita */
  readonly teamNames = computed(() => teamNames(this.match()));
  readonly team = computed(() => this.board().filter((b) => b.list === 'team').sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)));
  readonly reserves = computed(() => this.board().filter((b) => b.list === 'reserve').sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0)));
  readonly absents = computed(() => this.board().filter((b) => b.list === 'out'));
  readonly mine = computed(() => this.board().find((b) => b.user_id === this.session.uid()) ?? null);
  readonly leaderIn = computed(() => this.team().some((b) => b.is_leader));
  readonly amParticipant = computed(() => this.mine()?.list === 'team');
  readonly teamOf = computed(() => new Map(this.lineup().map((l) => [l.user_id, l.team as Team])));

  readonly t = computed(() => {
    const m = this.match();
    const now = this.now();
    if (!m) return null;
    const at = (iso: string) => new Date(iso).getTime();
    return {
      bookingOpen: now >= at(m.bookings_open_at) && now < at(m.bookings_close_at) && m.status === 'scheduled',
      bookingClosed: now >= at(m.bookings_close_at) && now < at(m.starts_at),
      beforeOpen: now < at(m.bookings_open_at),
      started: now >= at(m.starts_at),
      /** partita finita (e non annullata): restano Risultato, Pagelle e Chat */
      ended: now >= at(m.ends_at) && m.status !== 'cancelled',
      within24h: now >= at(m.starts_at) - 24 * 3600_000,
      lineupOpen: now >= at(m.lineup_opens_at),
      resultOpen: now >= at(m.result_opens_at),
      locked: m.locked || now >= at(m.lock_at),
      /** gol, assist e autogol: ognuno i propri fino alle 12 del giorno dopo (scorers_close_at in SQL) */
      scorersOpen: now < at(m.lock_at) + 12 * 3600_000,
      votesOpen: now >= at(m.votes_opens_at) && now <= at(m.votes_closes_at),
      votesBefore: now < at(m.votes_opens_at),
      votesClosed: now > at(m.votes_closes_at),
      chatOpen: now >= at(m.chat_opens_at) && now <= at(m.chat_closes_at),
    };
  });

  /** Può gestire le formazioni: staff o delegato del Leader per questa partita (REQ-027, REQ-028). */
  readonly canEditLineup = computed(() => {
    const m = this.match();
    return !!m && (this.session.isStaff() || m.lineup_delegate === this.session.uid());
  });

  /** apre una partita: se è già nota si vede subito e si aggiorna in sottofondo, altrimenti c'è lo scheletro */
  async load(id: string): Promise<void> {
    if (this.currentId !== id) {
      this.stopWatch?.();
      this.stopWatch = null;
      this.currentId = id;
      const snap = this.cache.get<MatchBundle>(`match:${id}`);
      this.apply(snap ?? { match: null as unknown as MatchBundle['match'], board: [], lineup: [], result: null, reviews: [], scorers: [], windows: [] });
      this.notFound.set(false);
      this.loading.set(!snap);
    }
    try {
      await this.reloadAll();
      if (this.currentId === id && !this.stopWatch) {
        this.stopWatch = this.api.watchMatch(id, ['bookings', 'matches', 'lineup', 'results', 'result_reviews', 'scorers', 'chat_messages'], (table) =>
          void this.reload(table),
        );
      }
    } catch {
      if (this.currentId === id && !this.match()) this.notFound.set(true);
    } finally {
      if (this.currentId === id) this.loading.set(false);
    }
  }

  /** tutto in una chiamata (o in un solo giro in parallelo, vedi Api.matchBundle) */
  async reloadAll(): Promise<void> {
    const id = this.currentId;
    if (!id) return;
    const b = await this.api.matchBundle(id);
    if (this.currentId !== id) return;
    this.now.set(Date.now());
    this.apply(b);
    this.remember();
  }

  private apply(b: MatchBundle): void {
    this.match.set(b.match ?? null);
    this.board.set(b.board ?? []);
    this.lineup.set(b.lineup ?? []);
    this.result.set(b.result ?? null);
    this.reviews.set(b.reviews ?? []);
    this.scorers.set(b.scorers ?? []);
    this.windows.set(b.windows ?? []);
    this.chatLast.set(b.chat_last ?? null);
    this.chatSeen.set(b.match ? this.cache.get<string>(`chat-seen:${b.match.id}`) ?? null : null);
  }

  /** la chat è stata vista fino a `upTo` (ora del messaggio più recente mostrato): il pallino si spegne */
  markChatSeen(upTo: string | null): void {
    const id = this.match()?.id;
    const at = [upTo, this.chatLast(), this.chatSeen()].filter((x): x is string => !!x)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    if (!id || !at || at === this.chatSeen()) return;
    this.chatSeen.set(at);
    this.cache.set(`chat-seen:${id}`, at, true);
  }

  /** salva lo stato attuale: in RAM sempre, sul telefono solo la prossima partita (quella che si apre all'avvio) */
  private remember(): void {
    const m = this.match();
    if (!m) return;
    const snap: MatchBundle = { match: m, board: this.board(), lineup: this.lineup(), result: this.result(), reviews: this.reviews(),
      scorers: this.scorers(), windows: this.windows(), chat_last: this.chatLast() };
    this.cache.set(`match:${m.id}`, snap, m.id === this.cache.get<string>('next-match'));
  }

  async reload(table: string): Promise<void> {
    // dati nuovi, orari nuovi: si riallinea subito l'ora usata per aperture e chiusure
    this.now.set(Date.now());
    const id = this.match()?.id;
    if (!id) return;
    switch (table) {
      case 'matches': this.match.set(await this.api.match(id)); break;
      case 'bookings': this.board.set(await this.api.board(id)); break;
      case 'lineup': this.lineup.set(await this.api.lineup(id)); break;
      case 'results': this.result.set(await this.api.result(id)); break;
      case 'result_reviews': this.reviews.set(await this.api.reviews(id)); break;
      case 'scorers': this.scorers.set(await this.api.scorers(id)); break;
      case 'priority_windows': this.windows.set(await this.api.priorityWindows(id)); break;
      case 'chat_messages': this.chatLast.set(await this.api.chatLast(id)); break;
    }
    if (this.currentId === id) this.remember();
  }

  /** all'uscita dall'account */
  reset(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.currentId = null;
    this.apply({ match: null as unknown as MatchBundle['match'], board: [], lineup: [], result: null, reviews: [], scorers: [], windows: [] });
    this.loading.set(true);
  }
}
