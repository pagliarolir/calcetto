import { computed, inject, Injectable, signal } from '@angular/core';
import { toSquarePng } from './image';
import { Supabase } from './supabase';

/**
 * Logo dell'app scelto dal Leader. Sta nel contenitore pubblico "branding" (il telefono
 * scarica l'icona senza accesso) come <id>-512.png e <id>-180.png.
 * All'avvio diventa icona della scheda, icona per iPhone (apple-touch-icon) e icona del manifest:
 * il telefono la usa quando si aggiunge l'app alla schermata Home.
 */
@Injectable({ providedIn: 'root' })
export class Branding {
  private readonly sb = inject(Supabase).client;
  readonly logoId = signal<string | null>(null);
  readonly logo512 = computed(() => (this.logoId() ? this.url(`${this.logoId()}-512.png`) : null));
  private readonly defaults = new Map<Element, string>();

  async load(): Promise<void> {
    try {
      const { data } = await this.sb.rpc('app_branding');
      this.logoId.set((data as { logo_id: string | null } | null)?.logo_id ?? null);
      await this.apply();
    } catch {
      /* senza logo restano le icone predefinite */
    }
  }

  /** il Leader carica un nuovo logo: si prepara, si carica, si collega e si tolgono i file vecchi */
  async upload(file: File): Promise<void> {
    const [big, small] = await Promise.all([toSquarePng(file, 512), toSquarePng(file, 180)]);
    const id = crypto.randomUUID();
    const bucket = this.sb.storage.from('branding');
    for (const [name, blob] of [[`${id}-512.png`, big], [`${id}-180.png`, small]] as const) {
      const r = await bucket.upload(name, blob, { contentType: 'image/png', cacheControl: '31536000', upsert: false });
      if (r.error) throw r.error;
    }
    const old = this.logoId();
    const { error } = await this.sb.rpc('set_app_logo', { p_logo: id });
    if (error) {
      await bucket.remove([`${id}-512.png`, `${id}-180.png`]);
      throw error;
    }
    if (old) await bucket.remove([`${old}-512.png`, `${old}-180.png`]);
    this.logoId.set(id);
    await this.apply();
  }

  async remove(): Promise<void> {
    const old = this.logoId();
    const { error } = await this.sb.rpc('set_app_logo', { p_logo: null });
    if (error) throw error;
    if (old) await this.sb.storage.from('branding').remove([`${old}-512.png`, `${old}-180.png`]);
    this.logoId.set(null);
    await this.apply();
  }

  private url(path: string): string {
    return this.sb.storage.from('branding').getPublicUrl(path).data.publicUrl;
  }

  /** aggiorna icone e manifest della pagina (o rimette quelli predefiniti) */
  private async apply(): Promise<void> {
    const id = this.logoId();
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
    // manifest riscritto con il logo; gli indirizzi relativi diventano assoluti perché il nuovo manifest non sta più accanto alla pagina
    const base = document.baseURI;
    const m = await (await fetch(new URL(original, base).href)).json();
    const abs = (u: string) => new URL(u, base).href;
    const logo = this.url(`${id}-512.png`);
    m.id = abs(m.id ?? './');
    m.start_url = abs(m.start_url ?? './');
    m.scope = abs(m.scope ?? './');
    m.icons = [
      { src: logo, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: logo, sizes: '192x192', type: 'image/png', purpose: 'any' },
    ];
    m.shortcuts = (m.shortcuts ?? []).map((s: { url: string }) => ({ ...s, url: abs(s.url), icons: [{ src: logo, sizes: '512x512' }] }));
    link.setAttribute('href', URL.createObjectURL(new Blob([JSON.stringify(m)], { type: 'application/manifest+json' })));
  }

  private setLink(selector: string, href: string | null): void {
    const el = document.querySelector(selector);
    if (!el) return;
    if (!this.defaults.has(el)) this.defaults.set(el, el.getAttribute('href') ?? '');
    el.setAttribute('href', href ?? this.defaults.get(el)!);
  }
}
