export {
    FORMATIONS,
    TEAM_BORDER_COLORS,
    TEAM_CRESTS,
    getFormation,
    type FutbolFormato,
    type Slot,
} from './sportFormations';

import { formatPlayersPerTeam as playersPerTeam, type FutbolFormato } from './sportFormations';

export function formatPlayersPerTeam(formato: FutbolFormato): number {
    return playersPerTeam('futbol', formato);
}
