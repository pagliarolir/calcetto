/**
 * Prepara la foto profilo nel browser prima di caricarla: quadrato da 320 px in JPEG.
 * Pesa poche decine di KB e, ridisegnata su canvas, perde i metadati dello scatto
 * (posizione GPS compresa). L'orientamento della foto del telefono viene rispettato.
 */
export async function toSquareJpeg(file: File, size = 320, quality = 0.85): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Scegli un\'immagine (JPEG, PNG o simili).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Non riesco a leggere questa immagine: prova con un\'altra foto.'));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const side = Math.min(w, h);
    const sx = (w - side) / 2;
    // nelle foto verticali il viso di solito sta in alto: si ritaglia un po' sopra il centro
    const sy = h > w ? (h - side) * 0.25 : (h - side) / 2;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Il browser non riesce a elaborare la foto.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversione della foto non riuscita.'))), 'image/jpeg', quality),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function loadImage(file: File): Promise<{ img: HTMLImageElement; done: () => void }> {
  if (!file.type.startsWith('image/')) throw new Error('Scegli un\'immagine (PNG, JPEG o simili).');
  const url = URL.createObjectURL(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Non riesco a leggere questa immagine: prova con un\'altra.'));
    i.src = url;
  }).catch((e) => { URL.revokeObjectURL(url); throw e; });
  return { img, done: () => URL.revokeObjectURL(url) };
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversione non riuscita.'))), 'image/png'));
}

/** Logo del tabellone: intero, trasparenza conservata, nessuno sfondo. */
export async function toLogoPng(file: File, size = 256): Promise<Blob> {
  const { img, done } = await loadImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.min(size / img.naturalWidth, size / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return await toPng(canvas);
  } finally {
    done();
  }
}

/**
 * Icona dell'app.
 * - 'cover': l'immagine riempie tutto il quadrato (si ritagliano i bordi in eccesso): nessuno sfondo;
 * - 'contain': l'immagine intera su un colore scelto (le parti trasparenti prendono quel colore).
 * Su iPhone la trasparenza diventerebbe nera, quindi l'icona non è mai trasparente.
 */
export async function toIconPng(file: File, size: number, mode: 'cover' | 'contain', background: string): Promise<Blob> {
  const { img, done } = await loadImage(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingQuality = 'high';
    if (mode === 'cover') {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    } else {
      const box = size * 0.8;   // margine per gli angoli arrotondati delle icone
      const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    }
    return await toPng(canvas);
  } finally {
    done();
  }
}

/** Colore medio delle parti visibili del logo (per "intera sul colore del logo"). */
export async function logoColor(file: File): Promise<string> {
  const { img, done } = await loadImage(file);
  try {
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, 48, 48);
    const d = ctx.getImageData(0, 0, 48, 48).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
    }
    if (!n) return '#1F6B45';
    const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } finally {
    done();
  }
}
