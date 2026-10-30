/** Un pezzo di riga: testo normale o in grassetto (**così**). */
export interface InfoSeg {
  text: string;
  bold: boolean;
}

/** Blocchi della pagina Info: titoletto (# ), elenco (- ) o paragrafo. */
export interface InfoBlock {
  kind: 'h' | 'ul' | 'p';
  lines: InfoSeg[][];
}

function segs(line: string): InfoSeg[] {
  return line.split(/\*\*(.+?)\*\*/g).map((text, i) => ({ text, bold: i % 2 === 1 })).filter((s) => s.text !== '');
}

/**
 * Trasforma il testo del Leader in blocchi da mostrare con il template (mai come HTML):
 * righe vuote separano i paragrafi, «# » fa un titoletto, «- » una voce di elenco, **testo** è in grassetto.
 */
export function parseInfo(text: string | null | undefined): InfoBlock[] {
  const out: InfoBlock[] = [];
  let cur: InfoBlock | null = null;
  for (const raw of (text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { cur = null; continue; }
    const h = line.match(/^#{1,3}\s+(.*)$/);
    const li = line.match(/^\s*[-•*]\s+(.*)$/);
    if (h) {
      out.push({ kind: 'h', lines: [segs(h[1])] });
      cur = null;
    } else if (li) {
      if (cur?.kind !== 'ul') { cur = { kind: 'ul', lines: [] }; out.push(cur); }
      cur.lines.push(segs(li[1]));
    } else {
      if (cur?.kind !== 'p') { cur = { kind: 'p', lines: [] }; out.push(cur); }
      cur.lines.push(segs(line.trim()));
    }
  }
  return out;
}
