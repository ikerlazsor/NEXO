import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import type { DeporteTipo } from '../lib/sportFormations';

const IONICONS: Record<Exclude<DeporteTipo, 'padel'>, keyof typeof Ionicons.glyphMap> = {
    futbol: 'football',
    basket: 'basketball',
    tenis: 'tennisball-outline',
    running: 'walk',
};

interface SportIconProps {
    sport: DeporteTipo;
    size?: number;
    color: string;
}

/** Icono del subdeporte (pádel = raqueta). */
export function SportIcon({ sport, size = 20, color }: SportIconProps) {
    if (sport === 'padel') {
        return <MaterialIcons name="sports-tennis" size={size} color={color} />;
    }
    return <Ionicons name={IONICONS[sport]} size={size} color={color} />;
}
