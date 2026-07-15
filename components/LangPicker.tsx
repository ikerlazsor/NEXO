import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LANG_OPTIONS, type Lang } from '../lib/i18n';

const BORDER = '#E2E8F0';
const ACCENT = '#2563EB';

interface Props {
    lang: Lang;
    onChange: (lang: Lang) => void;
    compact?: boolean;
}

export function LangPicker({ lang, onChange, compact }: Props) {
    return (
        <View style={[styles.row, compact && styles.rowCompact]}>
            {LANG_OPTIONS.map((opt) => (
                <TouchableOpacity
                    key={opt.code}
                    style={[styles.option, lang === opt.code && styles.optionActive]}
                    onPress={() => onChange(opt.code)}
                    activeOpacity={0.8}
                >
                    <Text style={styles.flag}>{opt.flag}</Text>
                    {!compact && <Text style={[styles.label, lang === opt.code && styles.labelActive]}>{opt.label}</Text>}
                </TouchableOpacity>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        justifyContent: 'center',
    },
    rowCompact: { gap: 6 },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#FFF',
    },
    optionActive: {
        borderColor: ACCENT,
        backgroundColor: '#EFF6FF',
    },
    flag: { fontSize: 18 },
    label: { fontSize: 13, fontWeight: '600', color: '#64748B' },
    labelActive: { color: ACCENT },
});
