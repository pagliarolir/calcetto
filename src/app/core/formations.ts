/** Disposizioni in campo da 5 a 8 giocatori per squadra. Coordinate in percentuale sulla metà
 *  campo della squadra A (porta in alto); la squadra B è speculare. */
export interface Position { slot: number; label: string; short: string; x: number; y: number }

const F: Record<number, Position[]> = {
  5: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 8 },
    { slot: 2, label: 'Difensore', short: 'Difensore', x: 50, y: 22 },
    { slot: 3, label: 'Laterale sinistro', short: 'Laterale sx', x: 20, y: 33 },
    { slot: 4, label: 'Laterale destro', short: 'Laterale dx', x: 80, y: 33 },
    { slot: 5, label: 'Pivot', short: 'Pivot', x: 50, y: 42 },
  ],
  6: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 8 },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 30, y: 20 },
    { slot: 3, label: 'Difensore destro', short: 'Difensore dx', x: 70, y: 20 },
    { slot: 4, label: 'Laterale sinistro', short: 'Laterale sx', x: 15, y: 33 },
    { slot: 5, label: 'Laterale destro', short: 'Laterale dx', x: 85, y: 33 },
    { slot: 6, label: 'Attaccante', short: 'Attaccante', x: 50, y: 42 },
  ],
  7: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 7 },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 18, y: 19 },
    { slot: 3, label: 'Difensore centrale', short: 'Centrale', x: 50, y: 18 },
    { slot: 4, label: 'Difensore destro', short: 'Difensore dx', x: 82, y: 19 },
    { slot: 5, label: 'Centrocampista sinistro', short: 'Mediano sx', x: 30, y: 31 },
    { slot: 6, label: 'Centrocampista destro', short: 'Mediano dx', x: 70, y: 31 },
    { slot: 7, label: 'Attaccante', short: 'Attaccante', x: 50, y: 43 },
  ],
  8: [
    { slot: 1, label: 'Portiere', short: 'Portiere', x: 50, y: 7 },
    { slot: 2, label: 'Difensore sinistro', short: 'Difensore sx', x: 18, y: 18 },
    { slot: 3, label: 'Difensore centrale', short: 'Centrale', x: 50, y: 17 },
    { slot: 4, label: 'Difensore destro', short: 'Difensore dx', x: 82, y: 18 },
    { slot: 5, label: 'Centrocampista sinistro', short: 'Mediano sx', x: 18, y: 31 },
    { slot: 6, label: 'Centrocampista centrale', short: 'Mediano', x: 50, y: 30 },
    { slot: 7, label: 'Centrocampista destro', short: 'Mediano dx', x: 82, y: 31 },
    { slot: 8, label: 'Attaccante', short: 'Attaccante', x: 50, y: 43 },
  ],
};

export const formation = (playersPerTeam: number | null | undefined): Position[] => F[playersPerTeam ?? 5] ?? F[5];
