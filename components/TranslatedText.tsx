import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { LinkifiedText } from './LinkifiedText';
import { useT } from '../lib/i18n';
import { translateIfNeeded } from '../lib/liveTranslate';

export function TranslatedText({
    text,
    style,
    numberOfLines,
    empty,
    showHint = true,
}: {
    text?: string | null;
    style?: StyleProp<TextStyle>;
    numberOfLines?: number;
    empty?: string;
    showHint?: boolean;
}) {
    const { t, lang } = useT();
    const original = (text ?? '').trim();
    const [shown, setShown] = useState(original);
    const [didTranslate, setDidTranslate] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);

    useEffect(() => {
        setShown(original);
        setDidTranslate(false);
        setShowOriginal(false);
        if (!original) return;
        let alive = true;
        void translateIfNeeded(original, lang).then((next) => {
            if (!alive || !next || next === original) return;
            setShown(next);
            setDidTranslate(true);
        });
        return () => {
            alive = false;
        };
    }, [original, lang]);

    if (!original) {
        return empty ? <Text style={style}>{empty}</Text> : null;
    }

    const value = showOriginal ? original : shown;

    return (
        <View pointerEvents="box-none">
            <LinkifiedText
                text={value}
                style={style}
                linkStyle={styles.link}
                numberOfLines={numberOfLines}
            />
            {didTranslate && showHint ? (
                <Pressable
                    onPress={() => setShowOriginal((v) => !v)}
                    hitSlop={12}
                    style={styles.hintBtn}
                    accessibilityRole="button"
                >
                    <Text style={styles.hint}>
                        {showOriginal ? t('translate.seeTranslation') : t('translate.translated')}
                    </Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    link: { color: '#2563EB', fontWeight: '700', textDecorationLine: 'underline' },
    hintBtn: { alignSelf: 'flex-start', marginTop: 6, zIndex: 2 },
    hint: { color: '#64748B', fontSize: 12, fontWeight: '700' },
});
