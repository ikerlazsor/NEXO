import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LANG_OPTIONS, type Lang } from '../lib/i18n';
import { hapticSelection } from '../lib/haptics';

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
                    style={[
                        styles.option,
                        compact && styles.optionCompact,
                        lang === opt.code && styles.optionActive,
                    ]}
                    onPress={() => {
                        if (opt.code === lang) return;
                        hapticSelection();
                        onChange(opt.code);
                    }}
                    activeOpacity={0.8}
                >
                    <Text style={[styles.code, compact && styles.codeCompact, lang === opt.code && styles.codeActive]}>
                        {opt.label}
                    </Text>
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
    rowCompact: { gap: 4 },
    option: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: BORDER,
        backgroundColor: '#FFF',
        minWidth: 44,
    },
    optionCompact: {
        paddingHorizontal: 7,
        paddingVertical: 4,
        minWidth: 30,
        borderRadius: 8,
    },
    optionActive: {
        borderColor: ACCENT,
        backgroundColor: '#EFF6FF',
    },
    code: { fontSize: 14, fontWeight: '800', color: '#64748B' },
    codeCompact: { fontSize: 11 },
    codeActive: { color: ACCENT },
});
