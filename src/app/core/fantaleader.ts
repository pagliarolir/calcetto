import { computed, inject, Injectable, signal } from '@angular/core';
import { Session } from './session';
import { Supabase } from './supabase';

function must<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data as T;
}

/**
 * Interruttore generale: con `false` FantaLeader è nascosto a tutti (niente voce «Fanta», la pagina rimanda alla home,
 * niente dati scaricati in anticipo). Con `true` lo vede solo Bobbo (decisione del proprietario, 18/11/2026): neanche il
 * Leader. Il server ripete il controllo in `fl_visible()` (migrazione 72); qui c'è anche il controllo sul proprio profilo,
 * così vale subito, anche prima che la migrazione sia applicata.
 */
export const FANTA_ENABLED = true;

/** «Bobbo» nel soprannome o nel nome (stesso controllo di pay_is_bobbo in SQL) */
export function isBobbo(p: { nickname?: string | null; first_name?: string | null } | null | undefined): boolean {
  const n = (x?: string | null) => (x ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return !!p && (n(p.nickname) === 'bobbo' || n(p.first_name) === 'bobbo');
}

export interface FlSettings {
  market_open: boolean;
  market_changed_at: string | null;
  budget: number;
  team_size: number;
  rules_version: number;
  params: Record<string, unknown>;
  /** aperto a tutti, oppure solo Leader + elenco di anteprima */
  public: boolean;
  preview_users: string[];
}
/** i numeri delle regole (fl_settings.params) */
export interface FlParams {
  presence: number; goal: number; own_goal: number; assist: number; win: number; loss: number; draw: number; mvp: number;
  vote_default: number; vote_min_voters: number; captain_bonus: number; coef_bands: [number | null, number][]; coef_first: number;
  price_k: number; price_cap: number; price_min: number; price_min_played: number;
}

export interface FlPlayer {
  user_id: string;
  preset_code: string | null;
  eligible: boolean;
  price_initial: number;
  description: string | null;
}
export interface FlRank {
  user_id: string;
  pos: number;
  total: number;
  provisional: number;
  last_points: number | null;
  played: number;
  price_initial: number;
  price_current: number;
  next_coef: number;
}
export interface FlPreset { code: string; name: string; price: number; description: string | null; sort: number }
export interface FlRule {
  when?: 'played' | 'absent' | 'always';
  outcome?: 'W' | 'L' | 'D';
  goals_min?: number; goals_max?: number; conceded_lt?: number; conceded_gt?: number;
  mvp?: boolean; worst?: boolean; avg_gt?: number; avg_lt?: number;
  per?: string; vs?: string; sign?: 'pos' | 'neg';
  amount?: number; to: string; zero?: boolean; special?: string;
}
export interface FlSkill {
  id: number; code: string; preset_code: string | null; name: string; kind: 'pos' | 'neg';
  description: string; rule: FlRule; active: boolean;
}
export interface FlTeamRank {
  team_id: string; pos: number; name: string; owner_id: string; total: number; last_points: number | null;
  captain_id: string; members: string[]; spent: number; captain_points: number; has_leader: boolean;
  owner_points: number; provisional: boolean;
}
export interface FlTeamVersion { team_id: string; captain_id: string; members: string[]; prices: number[]; spent: number; valid_from: string }
export interface FlPoints {
  match_id: string; user_id: string; played: boolean; team: string | null; won: boolean;
  base: number; skills: number; zeroed: boolean; pre: number; coef: number; total: number;
  fanta: { label: string; amount: number; to: 'others' | 'all' }[];
  breakdown: { label: string; value: number }[];
  status: 'provisional' | 'final'; revision: number;
  matches?: { starts_at: string } | null;
}
export interface FlTeamMatch { team_id: string; match_id: string; starts_at: string; points: number; captain_points: number | null; provisional: boolean }
export interface FlAudit { id: number; at: string; actor: string | null; action: string; details: Record<string, unknown> }

/** Dati e azioni del FantaLeader. Si carica tutto insieme (niente pagine che compaiono a pezzi). */
@Injectable({ providedIn: 'root' })
export class FantaLeader {
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);

  readonly loaded = signal(false);
  /** FantaLeader è visibile a questo utente? (per ora: Leader ed elenco di anteprima) */
  readonly visible = signal(false);
  readonly settings = signal<FlSettings | null>(null);
  readonly players = signal<FlPlayer[]>([]);
  readonly ranking = signal<FlRank[]>([]);
  readonly presets = signal<FlPreset[]>([]);
  readonly skills = signal<FlSkill[]>([]);
  readonly playerSkills = signal<{ user_id: string; skill_id: number }[]>([]);
  readonly teams = signal<FlTeamRank[]>([]);
  readonly teamMatches = signal<FlTeamMatch[]>([]);
  readonly myVersion = signal<FlTeamVersion | null>(null);
  /** l'ultima giornata calcolata (per la Home) */
  readonly lastRound = signal<{ match_id: string; starts_at: string } | null>(null);

  readonly rankOf = computed(() => new Map(this.ranking().map((r) => [r.user_id, r])));
  readonly playerOf = computed(() => new Map(this.players().map((p) => [p.user_id, p])));
  readonly myTeam = computed(() => this.teams().find((t) => t.owner_id === this.session.uid()) ?? null);
  readonly eligible = computed(() => this.players().filter((p) => p.eligible));

  skillsOf(userId: string): FlSkill[] {
    const ids = new Set(this.playerSkills().filter((x) => x.user_id === userId).map((x) => x.skill_id));
    return this.skills().filter((s) => ids.has(s.id)).sort((a, b) => (a.kind === b.kind ? a.id - b.id : a.kind === 'pos' ? -1 : 1));
  }

  private visCheck: { uid: string; at: number; p: Promise<boolean> } | null = null;
  /** se l'utente vede il FantaLeader; più richieste ravvicinate (barra, scaricamento in anticipo, guardia) fanno una sola chiamata */
  async checkVisible(): Promise<boolean> {
    const uid = this.session.uid();
    if (!uid) { this.visible.set(false); this.visCheck = null; return false; }
    // solo Bobbo: per tutti gli altri (Leader compreso) niente chiamata e niente voce
    if (!isBobbo(this.session.profile())) { this.visible.set(false); return false; }
    if (this.visCheck && this.visCheck.uid === uid && Date.now() - this.visCheck.at < 30_000) return this.visCheck.p;
    const p = (async () => {
      const res = await this.sb.rpc('fl_visible');
      const v = !res.error && res.data === true;
      this.visible.set(v);
      if (res.error) this.visCheck = null;
      return v;
    })();
    this.visCheck = { uid, at: Date.now(), p };
    return p;
  }

  private bundleMissing = false;
  /** tutto il FantaLeader in una chiamata (fl_bundle, migrazione 53); finché la migrazione non c'è, le letture separate */
  async load(): Promise<void> {
    if (!this.bundleMissing) {
      const { data, error } = await this.sb.rpc('fl_bundle');
      if (!error) {
        const b = (data ?? {}) as Record<string, unknown>;
        this.apply({
          st: b['settings'] ?? null, pl: b['players'] ?? [], rk: b['ranking'] ?? [], pr: b['presets'] ?? [], sk: b['skills'] ?? [],
          ps: b['player_skills'] ?? [], tr: b['teams'] ?? [], tm: b['team_matches'] ?? [],
          ver: (b['my_version'] as FlTeamVersion | null) ?? null, lr: b['last_round'] ?? null,
        });
        return;
      }
      const code = (error as { code?: string }).code;
      if (code !== 'PGRST202' && code !== '42883') throw error;
      this.bundleMissing = true;
    }
    await this.loadSeparately();
  }

  private apply(d: { st: unknown; pl: unknown; rk: unknown; pr: unknown; sk: unknown; ps: unknown; tr: unknown; tm: unknown; ver: FlTeamVersion | null; lr: unknown }): void {
    this.settings.set(d.st as FlSettings);
    this.players.set(d.pl as FlPlayer[]);
    this.ranking.set((d.rk as FlRank[]).map((r) => ({ ...r, total: +r.total, provisional: +r.provisional, last_points: r.last_points === null ? null : +r.last_points, next_coef: +r.next_coef })));
    this.presets.set(d.pr as FlPreset[]);
    this.skills.set(d.sk as FlSkill[]);
    this.playerSkills.set(d.ps as { user_id: string; skill_id: number }[]);
    this.teams.set((d.tr as FlTeamRank[]).map((t) => ({ ...t, total: +t.total, last_points: t.last_points === null ? null : +t.last_points })));
    this.teamMatches.set((d.tm as FlTeamMatch[]).map((t) => ({ ...t, points: +t.points })));
    this.myVersion.set(d.ver);
    this.lastRound.set((d.lr as { match_id: string; starts_at: string } | null) ?? null);
    this.loaded.set(true);
  }

  private async loadSeparately(): Promise<void> {
    const uid = this.session.uid();
    const [st, pl, rk, pr, sk, ps, tr, tm, mine, lr] = await Promise.all([
      this.sb.from('fl_settings').select('*').eq('id', 1).single(),
      this.sb.from('fl_players').select('*'),
      this.sb.rpc('fl_player_ranking'),
      this.sb.from('fl_presets').select('*').order('sort'),
      this.sb.from('fl_skills').select('*').order('id'),
      this.sb.from('fl_player_skills').select('*'),
      this.sb.rpc('fl_team_ranking'),
      this.sb.rpc('fl_team_match_points'),
      uid ? this.sb.from('fl_teams').select('id, fl_team_versions(team_id, captain_id, members, prices, spent, valid_from, valid_to)').eq('owner_id', uid).maybeSingle() : Promise.resolve({ data: null, error: null }),
      this.sb.rpc('fl_last_round'),
    ]);
    const team = must(mine as { data: unknown; error: unknown }) as { fl_team_versions: (FlTeamVersion & { valid_to: string | null })[] } | null;
    this.apply({
      st: must(st), pl: must(pl), rk: must(rk), pr: must(pr), sk: must(sk), ps: must(ps), tr: must(tr), tm: must(tm),
      ver: team?.fl_team_versions.find((v) => v.valid_to === null) ?? null,
      lr: ((must(lr) as { match_id: string; starts_at: string }[]) ?? [])[0] ?? null,
    });
  }

  async pointsOf(userId: string): Promise<FlPoints[]> {
    const rows = must(await this.sb.from('fl_points').select('*, matches(starts_at)').eq('user_id', userId)) as FlPoints[];
    return rows.sort((a, b) => (b.matches?.starts_at ?? '').localeCompare(a.matches?.starts_at ?? ''));
  }

  async confirmTeam(name: string, members: string[], captain: string): Promise<{ spent: number; left: number }> {
    const res = must(await this.sb.rpc('fl_confirm_team', { p_name: name, p_members: members, p_captain: captain })) as { spent: number; left: number };
    await this.load();
    return res;
  }

  // ------------------------------------------------ Leader
  async setMarket(open: boolean): Promise<void> {
    must(await this.sb.rpc('fl_set_market', { p_open: open }));
    await this.load();
  }
  async savePlayer(userId: string, eligible: boolean, price: number, description: string | null): Promise<void> {
    must(await this.sb.rpc('fl_save_player', { p_user: userId, p_eligible: eligible, p_price: price, p_description: description }));
  }
  async linkPreset(code: string, userId: string): Promise<void> {
    must(await this.sb.rpc('fl_link_preset', { p_preset: code, p_user: userId }));
    await this.load();
  }
  async setPlayerSkills(userId: string, skillIds: number[]): Promise<void> {
    must(await this.sb.rpc('fl_set_player_skills', { p_user: userId, p_skills: skillIds }));
  }
  async saveSkill(s: Pick<FlSkill, 'name' | 'kind' | 'description' | 'rule' | 'active'> & { id: number | null }): Promise<void> {
    must(await this.sb.rpc('fl_save_skill', { p_id: s.id, p_name: s.name, p_kind: s.kind, p_description: s.description, p_rule: s.rule, p_active: s.active }));
    await this.load();
  }
  async setVisibility(isPublic: boolean, users: string[]): Promise<void> {
    must(await this.sb.rpc('fl_set_visibility', { p_public: isPublic, p_users: users }));
    await this.load();
  }
  async recomputeAll(): Promise<number> {
    const n = must(await this.sb.rpc('fl_recompute_all')) as number;
    await this.load();
    return n;
  }
  async checks(): Promise<Record<string, unknown>> {
    return must(await this.sb.rpc('fl_checks')) as Record<string, unknown>;
  }
  async audit(): Promise<FlAudit[]> {
    return must(await this.sb.from('fl_audit').select('*').order('id', { ascending: false }).limit(30)) as FlAudit[];
  }
}

/** Una regola di skill in parole, per la scheda e il pannello del Leader. */
export function ruleSummary(r: FlRule): string {
  const parts: string[] = [];
  if (r.when === 'absent') parts.push('se assente');
  else if (r.when === 'always') parts.push('sempre');
  if (r.outcome) parts.push(r.outcome === 'W' ? 'se vince' : r.outcome === 'L' ? 'se perde' : 'se pareggia');
  if (r.goals_min !== undefined) parts.push(`con almeno ${r.goals_min} gol`);
  if (r.goals_max !== undefined) parts.push(r.goals_max === 0 ? 'senza segnare' : `con al massimo ${r.goals_max} gol`);
  if (r.conceded_lt !== undefined) parts.push(`se la squadra subisce meno di ${r.conceded_lt} gol`);
  if (r.conceded_gt !== undefined) parts.push(`se la squadra subisce più di ${r.conceded_gt} gol`);
  if (r.mvp) parts.push('se è il migliore in campo');
  if (r.worst) parts.push('se è il peggiore della squadra');
  if (r.avg_gt !== undefined) parts.push(`con media sopra ${r.avg_gt}`);
  if (r.avg_lt !== undefined) parts.push(`con media sotto ${r.avg_lt}`);
  const to: Record<string, string> = {
    self: 'a lui', teammates: 'ai compagni in campo', self_teammates: 'a lui e ai compagni', opponents: 'agli avversari in campo',
    fanta_others: 'agli altri della fantasquadra', fanta_all: 'a tutta la fantasquadra',
  };
  const per: Record<string, string> = {
    goal: 'per ogni suo gol', own_goal: 'per ogni autogol', conceded: 'per ogni gol subito', diff_abs: 'per ogni gol di scarto',
    diff_sign: 'secondo l’esito', goals_vs: 'per ogni gol di differenza dal rivale', consecutive: 'per ogni presenza consecutiva',
  };
  const eff = r.zero ? 'punti azzerati' : r.special === 'half_lowest' ? 'metà del punteggio più basso dei presenti'
    : `${r.amount !== undefined && r.amount > 0 ? '+' : ''}${String(r.amount ?? 0).replace('.', ',')}${r.per ? ' ' + per[r.per] : ''}`;
  return `${parts.join(', ') || 'quando gioca'}: ${eff} ${to[r.to] ?? ''}`.trim();
}

export function fmtPts(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return (Math.round(n * 100) / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}
