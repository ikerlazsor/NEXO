import type { Ionicons } from '@expo/vector-icons';

type IoniconName = keyof typeof Ionicons.glyphMap;

export type InterestAccent = {
    bg: string;
    icon: string;
    border: string;
    selectedBg: string;
    selectedBorder: string;
};

export const INTEREST_ICON: Record<string, IoniconName> = {
    Deportista: 'bicycle-outline',
    Viajero: 'airplane-outline',
    Aventurero: 'compass-outline',
    Tranquilo: 'leaf-outline',
    Yoga: 'body-outline',
    Foodie: 'restaurant-outline',
    Fiestero: 'wine-outline',
    Lectura: 'book-outline',
    'De terraceo': 'sunny-outline',
    'Más de noche': 'moon-outline',
    'Más de día': 'partly-sunny-outline',
};

export const INTEREST_ACCENT: Record<string, InterestAccent> = {
    Deportista: {
        bg: '#ECFDF5',
        icon: '#047857',
        border: '#A7F3D0',
        selectedBg: '#059669',
        selectedBorder: '#047857',
    },
    Viajero: {
        bg: '#EFF6FF',
        icon: '#1D4ED8',
        border: '#BFDBFE',
        selectedBg: '#2563EB',
        selectedBorder: '#1D4ED8',
    },
    Aventurero: {
        bg: '#FFF7ED',
        icon: '#C2410C',
        border: '#FED7AA',
        selectedBg: '#EA580C',
        selectedBorder: '#C2410C',
    },
    Tranquilo: {
        bg: '#F0FDF4',
        icon: '#15803D',
        border: '#BBF7D0',
        selectedBg: '#16A34A',
        selectedBorder: '#15803D',
    },
    Yoga: {
        bg: '#F5F3FF',
        icon: '#6D28D9',
        border: '#DDD6FE',
        selectedBg: '#7C3AED',
        selectedBorder: '#6D28D9',
    },
    Foodie: {
        bg: '#FFF1F2',
        icon: '#BE123C',
        border: '#FECDD3',
        selectedBg: '#E11D48',
        selectedBorder: '#BE123C',
    },
    Fiestero: {
        bg: '#FDF4FF',
        icon: '#A21CAF',
        border: '#F5D0FE',
        selectedBg: '#C026D3',
        selectedBorder: '#A21CAF',
    },
    Lectura: {
        bg: '#F8FAFC',
        icon: '#334155',
        border: '#E2E8F0',
        selectedBg: '#475569',
        selectedBorder: '#334155',
    },
    'De terraceo': {
        bg: '#FFFBEB',
        icon: '#B45309',
        border: '#FDE68A',
        selectedBg: '#D97706',
        selectedBorder: '#B45309',
    },
    'Más de noche': {
        bg: '#EEF2FF',
        icon: '#4338CA',
        border: '#C7D2FE',
        selectedBg: '#4F46E5',
        selectedBorder: '#4338CA',
    },
    'Más de día': {
        bg: '#FEFCE8',
        icon: '#A16207',
        border: '#FEF08A',
        selectedBg: '#CA8A04',
        selectedBorder: '#A16207',
    },
};

const DEFAULT_ACCENT: InterestAccent = {
    bg: '#EFF6FF',
    icon: '#1D4ED8',
    border: '#BFDBFE',
    selectedBg: '#2563EB',
    selectedBorder: '#1D4ED8',
};

export function getInterestIcon(tag: string): IoniconName {
    return INTEREST_ICON[tag] ?? 'sparkles-outline';
}

export function getInterestAccent(tag: string): InterestAccent {
    return INTEREST_ACCENT[tag] ?? DEFAULT_ACCENT;
}

export const PERSONALITY_MAX = 4;
export const PERSONALITY_MIN = 1;
/** Cuántas aficiones se muestran en el perfil antes del “+N”. */
export const INTEREST_VISIBLE_MAX = 6;
