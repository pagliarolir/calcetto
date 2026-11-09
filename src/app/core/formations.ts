/** Disposizioni in campo da 5 a 8 giocatori per squadra. Coordinate in percentuale sulla metà
 *  campo della squadra A (porta in alto); la squadra B è speculare. */
/** kind: tipo di posto per i valori (gk portiere, dc difensore centrale, ed esterno difensivo, est laterale = media tra esterno difensivo e offensivo, cen centrocampista centrale, pu punta) */
export interface Position { slot: number; label: string; short: string; x: number; y: number; kind: 'gk' | 'dc' | 'ed' | 'est' | 'cen' | 'pu' }

const F: Record<number, Position[]> = {
  5: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 8, kind: 'gk' },
    { slot: 2, label: 'Difensore', short: 'Difensore', x: 50, y: 22, kind: 'dc' },
    { slot: 3, label: 'Laterale sinistro', short: 'Laterale sx', x: 20, y: 33, kind: 'est' },
    { slot: 4, label: 'Laterale destro', short: 'Laterale dx', x: 80, y: 33, kind: 'est' },
    { slot: 5, label: 'Pivot', short: 'Pivot', x: 50, y: 42, kind: 'pu' },
  ],
  6: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 8, kind: 'gk' },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 30, y: 20, kind: 'ed' },
    { slot: 3, label: 'Difensore destro', short: 'Difensore dx', x: 70, y: 20, kind: 'ed' },
    { slot: 4, label: 'Laterale sinistro', short: 'Laterale sx', x: 15, y: 33, kind: 'est' },
    { slot: 5, label: 'Laterale destro', short: 'Laterale dx', x: 85, y: 33, kind: 'est' },
    { slot: 6, label: 'Attaccante', short: 'Attaccante', x: 50, y: 42, kind: 'pu' },
  ],
  7: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 7, kind: 'gk' },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 18, y: 19, kind: 'ed' },
    { slot: 3, label: 'Difensore centrale', short: 'Centrale', x: 50, y: 18, kind: 'dc' },
    { slot: 4, label: 'Difensore destro', short: 'Difensore dx', x: 82, y: 19, kind: 'ed' },
    { slot: 5, label: 'Centrocampista sinistro', short: 'Mediano sx', x: 30, y: 31, kind: 'est' },
    { slot: 6, label: 'Centrocampista destro', short: 'Mediano dx', x: 70, y: 31, kind: 'est' },
    { slot: 7, label: 'Attaccante', short: 'Attaccante', x: 50, y: 43, kind: 'pu' },
  ],
  8: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 7, kind: 'gk' },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 18, y: 18, kind: 'ed' },
    { slot: 3, label: 'Difensore centrale', short: 'Centrale', x: 50, y: 17, kind: 'dc' },
    { slot: 4, label: 'Difensore destro', short: 'Difensore dx', x: 82, y: 18, kind: 'ed' },
    { slot: 5, label: 'Centrocampista sinistro', short: 'Mediano sx', x: 18, y: 31, kind: 'est' },
    { slot: 6, label: 'Centrocampista centrale', short: 'Mediano', x: 50, y: 30, kind: 'cen' },
    { slot: 7, label: 'Centrocampista destro', short: 'Mediano dx', x: 82, y: 31, kind: 'est' },
    { slot: 8, label: 'Attaccante', short: 'Attaccante', x: 50, y: 43, kind: 'pu' },
  ],
};

export const formation = (playersPerTeam: number | null | undefined): Position[] => F[playersPerTeam ?? 5] ?? F[5];
