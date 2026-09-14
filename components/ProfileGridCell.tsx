import { memo } from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { ProfileAvatar } from './ProfileAvatar';
import { useThemedStyles } from '../lib/appTheme';
import { type RankedProfile } from '../lib/rankings';
import { type ThemeColors } from '../theme';

type Props = {
    item: RankedProfile;
    onPress: (item: RankedProfile) => void;
};

export const ProfileGridCell = memo(function ProfileGridCell({ item, onPress }: Props) {
    const styles = useThemedStyles(createProfileGridCellStyles);

    return (
        <TouchableOpacity
            style={styles.dirCell}
            onPress={() => onPress(item)}
            activeOpacity={0.85}
        >
            <ProfileAvatar
                uri={item.avatar_url}
                name={item.nombre}
                size={56}
                recyclingKey={item.id}
                priority="normal"
            />
            <Text style={styles.dirName} numberOfLines={2}>
                {item.nombre}
            </Text>
        </TouchableOpacity>
    );
}, (prev, next) => prev.item.id === next.item.id && prev.onPress === next.onPress);

function createProfileGridCellStyles(c: ThemeColors) {
    return StyleSheet.create({
        dirCell: {
            flex: 1,
            alignItems: 'center',
            paddingHorizontal: 4,
            marginBottom: 14,
        },
        dirName: {
            marginTop: 6,
            fontSize: 11,
            fontWeight: '700',
            color: c.text,
            textAlign: 'center',
            lineHeight: 14,
        },
    });
}
