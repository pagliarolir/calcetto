import { computed, inject, Injectable, OnDestroy, signal } from '@angular/core';
import { Api } from '../core/api';
import { BoardRow, LineupRow, Match, Result, ResultReview, Scorer, Team } from '../core/models';
import { Session } from '../core/session';
import { teamNames } from '../core/kits';

/** Stato di una partita condiviso tra le schede (lista, squadre, risultato, voti, chat). */
@Injectable()
export class MatchStore implements OnDestroy {
  private readonly api = inject(Api);
  private readonly session = inject(Session);
  private stopWatch: (() => void) | null = null;
  private ticker = setInterval(() => this.now.set(Date.now()), 30_000);

  readonly now = signal(Date.now());
  readonly match = signal<Match | null>(null);
  readonly board = signal<BoardRow[]>([]);
  readonly lineup = signal<LineupRow[]>([]);
  readonly result = signal<Result | null>(null);
  readonly reviews = signal<ResultReview[]>([]);
  readonly scorers = signal<Scorer[]>([]);
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
      within24h: now >= at(m.starts_at) - 24 * 3600_000,
      lineupOpen: now >= at(m.lineup_opens_at),
      resultOpen: now >= at(m.result_opens_at),
      locked: m.locked || now >= at(m.lock_at),
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

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.stopWatch?.();
    try {
      this.match.set(await this.api.match(id));
      this.notFound.set(false);
      await this.reloadAll();
      this.stopWatch = this.api.watchMatch(id, ['bookings', 'matches', 'lineup', 'results', 'result_reviews', 'scorers'], (table) =>
        void this.reload(table),
      );
    } catch {
      this.notFound.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  async reloadAll(): Promise<void> {
    await Promise.all(['matches', 'bookings', 'lineup', 'results', 'result_reviews', 'scorers'].map((t) => this.reload(t)));
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
    }
  }

  ngOnDestroy(): void {
    this.stopWatch?.();
    clearInterval(this.ticker);
  }
}
