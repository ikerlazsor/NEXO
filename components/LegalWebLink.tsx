import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { openNexoPage } from '../lib/brand';
import { useT } from '../lib/i18n';

type Props = {
    url: string;
    label?: string;
};

export function LegalWebLink({ url, label }: Props) {
    const { t } = useT();
    return (
        <TouchableOpacity
            style={styles.row}
            onPress={() => void openNexoPage(url)}
            activeOpacity={0.75}
        >
            <Ionicons name="open-outline" size={18} color="#2563EB" />
            <Text style={styles.label}>{label ?? t('legal.openOnWeb')}</Text>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 14,
        alignSelf: 'flex-start',
    },
    label: { fontSize: 14, fontWeight: '700', color: '#2563EB' },
});
