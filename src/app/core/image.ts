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

/**
 * Logo per l'icona dell'app: l'immagine intera (non ritagliata) al centro di un quadrato
 * bianco, con un margine così gli angoli arrotondati delle icone non la tagliano. PNG.
 */
export async function toSquarePng(file: File, size: number, margin = 0.1): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Scegli un\'immagine (PNG, JPEG o simili).');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Non riesco a leggere questa immagine: prova con un\'altra.'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Il browser non riesce a elaborare l\'immagine.');
    ctx.fillStyle = '#ffffff';   // su iPhone la trasparenza diventerebbe nera
    ctx.fillRect(0, 0, size, size);
    const box = size * (1 - 2 * margin);
    const scale = Math.min(box / img.naturalWidth, box / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Conversione non riuscita.'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
