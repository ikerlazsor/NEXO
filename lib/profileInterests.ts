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
        selectedBg: '#D1FAE5',
        selectedBorder: '#34D399',
    },
    Viajero: {
        bg: '#EFF6FF',
        icon: '#1D4ED8',
        border: '#BFDBFE',
        selectedBg: '#DBEAFE',
        selectedBorder: '#60A5FA',
    },
    Aventurero: {
        bg: '#FFF7ED',
        icon: '#C2410C',
        border: '#FED7AA',
        selectedBg: '#FFEDD5',
        selectedBorder: '#FB923C',
    },
    Tranquilo: {
        bg: '#F0FDF4',
        icon: '#15803D',
        border: '#BBF7D0',
        selectedBg: '#DCFCE7',
        selectedBorder: '#4ADE80',
    },
    Yoga: {
        bg: '#F5F3FF',
        icon: '#6D28D9',
        border: '#DDD6FE',
        selectedBg: '#EDE9FE',
        selectedBorder: '#A78BFA',
    },
    Foodie: {
        bg: '#FFF1F2',
        icon: '#BE123C',
        border: '#FECDD3',
        selectedBg: '#FFE4E6',
        selectedBorder: '#FB7185',
    },
    Fiestero: {
        bg: '#FDF4FF',
        icon: '#A21CAF',
        border: '#F5D0FE',
        selectedBg: '#FAE8FF',
        selectedBorder: '#E879F9',
    },
    Lectura: {
        bg: '#F8FAFC',
        icon: '#334155',
        border: '#E2E8F0',
        selectedBg: '#F1F5F9',
        selectedBorder: '#94A3B8',
    },
    'De terraceo': {
        bg: '#FFFBEB',
        icon: '#B45309',
        border: '#FDE68A',
        selectedBg: '#FEF3C7',
        selectedBorder: '#FBBF24',
    },
    'Más de noche': {
        bg: '#EEF2FF',
        icon: '#4338CA',
        border: '#C7D2FE',
        selectedBg: '#E0E7FF',
        selectedBorder: '#818CF8',
    },
    'Más de día': {
        bg: '#FEFCE8',
        icon: '#A16207',
        border: '#FEF08A',
        selectedBg: '#FEF9C3',
        selectedBorder: '#EAB308',
    },
};

const DEFAULT_ACCENT: InterestAccent = {
    bg: '#EFF6FF',
    icon: '#1D4ED8',
    border: '#BFDBFE',
    selectedBg: '#DBEAFE',
    selectedBorder: '#60A5FA',
};

export function getInterestIcon(tag: string): IoniconName {
    return INTEREST_ICON[tag] ?? 'sparkles-outline';
}

export function getInterestAccent(tag: string): InterestAccent {
    return INTEREST_ACCENT[tag] ?? DEFAULT_ACCENT;
}

export const PERSONALITY_MAX = 4;
export const PERSONALITY_MIN = 1;
export const INTEREST_VISIBLE_MAX = 4;
