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
