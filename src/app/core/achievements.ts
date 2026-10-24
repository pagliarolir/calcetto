import { computed, inject, Injectable, signal } from '@angular/core';
import { toLogoPng } from './image';
import { Achievement, PlayerAchievement } from './models';
import { Session } from './session';
import { Supabase } from './supabase';

/**
 * Obiettivi (sticker): elenco, chi li ha sbloccati e missioni (solo quelle che si possono vedere).
 * Le immagini stanno nel contenitore pubblico "stickers" e le carica il Leader.
 */
@Injectable({ providedIn: 'root' })
export class Achievements {
  private readonly sb = inject(Supabase).client;
  private readonly session = inject(Session);
  readonly list = signal<Achievement[]>([]);
  readonly unlocked = signal<PlayerAchievement[]>([]);
  readonly missions = signal<Map<string, string | null>>(new Map());
  readonly loaded = signal(false);

  /** sticker di un giocatore, in ordine di numero */
  of(userId: string): Achievement[] {
    const ids = new Set(this.unlocked().filter((u) => u.user_id === userId).map((u) => u.achievement_id));
    return this.list().filter((a) => ids.has(a.id));
  }

  holders(achievementId: string): PlayerAchievement[] {
    return this.unlocked().filter((u) => u.achievement_id === achievementId).sort((a, b) => a.unlocked_at.localeCompare(b.unlocked_at));
  }

  mine(achievementId: string): PlayerAchievement | undefined {
    return this.unlocked().find((u) => u.achievement_id === achievementId && u.user_id === this.session.uid());
  }

  /** classifica: giocatori in ordine di sticker (poi chi li ha presi prima) */
  readonly ranking = computed(() => {
    const by = new Map<string, PlayerAchievement[]>();
    for (const u of this.unlocked()) by.set(u.user_id, [...(by.get(u.user_id) ?? []), u]);
    return [...by.entries()]
      .map(([user_id, rows]) => ({ user_id, count: rows.length, last: rows.map((r) => r.unlocked_at).sort().at(-1)! }))
      .sort((a, b) => b.count - a.count || a.last.localeCompare(b.last));
  });

  /** sticker vinti nelle ultime 24 ore (per l'avviso a tutti) */
  readonly recent = computed(() => {
    const since = Date.now() - 24 * 3600 * 1000;
    return this.unlocked()
      .filter((u) => u.announced && new Date(u.unlocked_at).getTime() >= since)
      .sort((a, b) => b.unlocked_at.localeCompare(a.unlocked_at));
  });

  imageUrl(a: Achievement | undefined | null): string | null {
    return a?.image_path ? this.sb.storage.from('stickers').getPublicUrl(a.image_path).data.publicUrl : null;
  }

  byId(id: string): Achievement | undefined {
    return this.list().find((a) => a.id === id);
  }

  async load(): Promise<void> {
    const [a, u, m] = await Promise.all([
      this.sb.from('achievements').select('id, code, number, name, image_path, created_at').order('number'),
      this.sb.from('player_achievements').select('*'),
      this.sb.rpc('achievement_missions'),
    ]);
    if (a.error) throw a.error;
    if (u.error) throw u.error;
    this.list.set(a.data as Achievement[]);
    this.unlocked.set(u.data as PlayerAchievement[]);
    this.missions.set(new Map(((m.data ?? []) as { id: string; mission: string | null }[]).map((x) => [x.id, x.mission])));
    this.loaded.set(true);
  }

  // ------------------------------------------------------------ strumenti del Leader
  async create(name: string, mission: string | null, image: File | null): Promise<void> {
    const { data, error } = await this.sb.rpc('create_achievement', { p_name: name, p_mission: mission });
    if (error) throw error;
    if (image) await this.setImage(data as string, image, false);
    await this.load();
  }

  async update(id: string, name: string, mission: string | null): Promise<void> {
    const { error } = await this.sb.rpc('update_achievement', { p_id: id, p_name: name, p_mission: mission });
    if (error) throw error;
    await this.load();
  }

  async setImage(id: string, file: File, reload = true): Promise<void> {
    const png = await toLogoPng(file, 256);
    const path = `${id}-${crypto.randomUUID()}.png`;
    const bucket = this.sb.storage.from('stickers');
    const up = await bucket.upload(path, png, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
    if (up.error) throw up.error;
    const { data, error } = await this.sb.rpc('set_achievement_image', { p_id: id, p_path: path });
    if (error) {
      await bucket.remove([path]);
      throw error;
    }
    if (data) await bucket.remove([data as string]);
    if (reload) await this.load();
  }

  async remove(id: string): Promise<void> {
    const { data, error } = await this.sb.rpc('delete_achievement', { p_id: id });
    if (error) throw error;
    if (data) await this.sb.storage.from('stickers').remove([data as string]);
    await this.load();
  }

  async award(id: string, userId: string): Promise<void> {
    const { error } = await this.sb.rpc('award_achievement', { p_id: id, p_user: userId });
    if (error) throw error;
    await this.load();
  }

  async revoke(id: string, userId: string): Promise<void> {
    const { error } = await this.sb.rpc('revoke_achievement', { p_id: id, p_user: userId });
    if (error) throw error;
    await this.load();
  }
}
