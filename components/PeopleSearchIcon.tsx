import { MaterialCommunityIcons } from '@expo/vector-icons';

/** Lupa con persona: buscar gente (feed, chats, perfil). */
export function PeopleSearchIcon({
    size = 24,
    color,
}: {
    size?: number;
    color: string;
}) {
    return <MaterialCommunityIcons name="account-search" size={size} color={color} />;
}
