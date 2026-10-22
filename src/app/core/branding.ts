import { computed, inject, Injectable, signal } from '@angular/core';
import { toIconPng, toLogoPng } from './image';
import { Supabase } from './supabase';

export type IconMode = 'cover' | 'contain';

/**
 * Due loghi scelti dal Leader, nel contenitore pubblico "branding" (il telefono scarica l'icona senza accesso):
 * - logo del tabellone: <id>-header.png, trasparente, compare nel tabellone della partita;
 * - icona dell'app: <id>-512.png e <id>-180.png, mai trasparente; all'avvio diventa icona della scheda,
 *   icona per iPhone (apple-touch-icon) e icona del manifest, usata quando si aggiunge l'app alla Home.
 */
@Injectable({ providedIn: 'root' })
export class Branding {
  private readonly sb = inject(Supabase).client;
  readonly iconId = signal<string | null>(null);
  readonly headerId = signal<string | null>(null);
  readonly icon512 = computed(() => (this.iconId() ? this.url(`${this.iconId()}-512.png`) : null));
  readonly headerUrl = computed(() => (this.headerId() ? this.url(`${this.headerId()}-header.png`) : null));
  private readonly defaults = new Map<Element, string>();

  async load(): Promise<void> {
    try {
      const { data } = await this.sb.rpc('app_branding');
      const b = (data ?? {}) as { logo_id?: string | null; header_logo_id?: string | null };
      this.iconId.set(b.logo_id ?? null);
      this.headerId.set(b.header_logo_id ?? null);
      await this.apply();
    } catch {
      /* senza loghi restano le icone predefinite */
    }
  }

  async uploadHeader(file: File): Promise<void> {
    const id = crypto.randomUUID();
    await this.put([[`${id}-header.png`, await toLogoPng(file)]]);
    await this.swap('set_header_logo', id, this.headerId(), (old) => [`${old}-header.png`], [`${id}-header.png`]);
    this.headerId.set(id);
  }

  async removeHeader(): Promise<void> {
    await this.swap('set_header_logo', null, this.headerId(), (old) => [`${old}-header.png`], []);
    this.headerId.set(null);
  }

  async uploadIcon(file: File, mode: IconMode, background: string): Promise<void> {
    const id = crypto.randomUUID();
    const [big, small] = await Promise.all([toIconPng(file, 512, mode, background), toIconPng(file, 180, mode, background)]);
    await this.put([[`${id}-512.png`, big], [`${id}-180.png`, small]]);
    await this.swap('set_app_logo', id, this.iconId(), (old) => [`${old}-512.png`, `${old}-180.png`], [`${id}-512.png`, `${id}-180.png`]);
    this.iconId.set(id);
    await this.apply();
  }

  async removeIcon(): Promise<void> {
    await this.swap('set_app_logo', null, this.iconId(), (old) => [`${old}-512.png`, `${old}-180.png`], []);
    this.iconId.set(null);
    await this.apply();
  }

  private async put(files: [string, Blob][]): Promise<void> {
    for (const [name, blob] of files) {
      const r = await this.sb.storage.from('branding').upload(name, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
      if (r.error) throw r.error;
    }
  }

  /** collega il nuovo logo; se non riesce toglie i file appena caricati, se riesce toglie quelli vecchi */
  private async swap(fn: string, id: string | null, old: string | null, oldFiles: (old: string) => string[], newFiles: string[]): Promise<void> {
    const bucket = this.sb.storage.from('branding');
    const { error } = await this.sb.rpc(fn, { p_logo: id });
    if (error) {
      if (newFiles.length) await bucket.remove(newFiles);
      throw error;
    }
    if (old) await bucket.remove(oldFiles(old));
  }

  private url(path: string): string {
    return this.sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }

  /** aggiorna icone e manifest della pagina (o rimette quelli predefiniti) */
  private async apply(): Promise<void> {
    const id = this.iconId();
    this.setLink('link[rel="icon"]', id ? this.url(`${id}-512.png`) : null);
    this.setLink('link[rel="apple-touch-icon"]', id ? this.url(`${id}-180.png`) : null);
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return;
    if (!this.defaults.has(link)) this.defaults.set(link, link.getAttribute('href') ?? 'manifest.webmanifest');
    const original = this.defaults.get(link)!;
    if (!id) {
      link.setAttribute('href', original);
      return;
    }
    // manifest riscritto con l'icona; gli indirizzi relativi diventano assoluti perché il nuovo manifest non sta più accanto alla pagina
    const base = document.baseURI;
    const m = await (await fetch(new URL(original, base).href)).json();
    const abs = (u: string) => new URL(u, base).href;
    const icon = this.url(`${id}-512.png`);
    m.id = abs(m.id ?? './');
    m.start_url = abs(m.start_url ?? './');
    m.scope = abs(m.scope ?? './');
    m.icons = [
      { src: icon, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icon, sizes: '192x192', type: 'image/png', purpose: 'any' },
    ];
    m.shortcuts = (m.shortcuts ?? []).map((s: { url: string }) => ({ ...s, url: abs(s.url), icons: [{ src: icon, sizes: '512x512' }] }));
    link.setAttribute('href', URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' })));
  }

  private setLink(selector: string, href: string | null): void {
    const el = document.querySelector(selector);
    if (!el) return;
    if (!this.defaults.has(el)) this.defaults.set(el, el.getAttribute('href') ?? '');
    el.setAttribute('href', href ?? this.defaults.get(el)!);
  }
}
