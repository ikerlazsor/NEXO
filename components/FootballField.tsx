import { SportLineupField } from './SportLineupField';
import type { FutbolFormato } from '../lib/sportFormations';

interface Props {
    planId: string;
    formato: FutbolFormato;
    currentUserId: string | null;
    canPlay: boolean;
    onRequireJoin: () => void;
    router: { push: (opts: { pathname: string; params: { id: string } }) => void };
}

export function FootballField(props: Props) {
    return <SportLineupField sportType="futbol" {...props} />;
}
