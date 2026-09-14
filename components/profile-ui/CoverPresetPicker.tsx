import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { PROFILE_COVER_PRESETS, coverPresetKey, isCoverPresetKey } from '../../lib/profileCover';
import { INK } from './ProfileRedesign';

export function CoverPresetPicker({
    value,
    onSelect,
    onPickCustom,
    customPreviewUri,
    pickingCustom = false,
    wide = false,
    presets,
}: {
    value?: string | null;
    onSelect: (key: string) => void;
    onPickCustom?: () => void;
    customPreviewUri?: string | null;
    pickingCustom?: boolean;
    t?: (key: string) => string;
    wide?: boolean;
    presets?: readonly { id: string; image: number; labelKey?: string }[];
}) {
    const coverPresets = presets ?? PROFILE_COVER_PRESETS;
    const customSelected = !!value && !isCoverPresetKey(value);
    const preview =
        customPreviewUri
        || (customSelected && /^https?:\/\//i.test(value ?? '') ? value : null);
    const imageStyle = wide ? styles.imageWide : styles.image;

    return (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
            {onPickCustom ? (
                <TouchableOpacity
                    style={[styles.card, wide && styles.cardWide, customSelected && styles.cardOn]}
                    onPress={onPickCustom}
                    activeOpacity={0.9}
                    accessibilityRole="button"
                >
                    {preview ? (
                        <Image source={{ uri: preview }} style={imageStyle} contentFit="cover" />
                    ) : (
                        <View style={[imageStyle, styles.galleryTile]}>
                            <Ionicons name="image-outline" size={22} color={INK} />
                            <View style={styles.galleryPlus}>
                                <Ionicons name="add" size={12} color="#FFF" />
                            </View>
                        </View>
                    )}
                    {pickingCustom ? (
                        <View style={styles.busy}>
                            <ActivityIndicator color="#FFF" />
                        </View>
                    ) : null}
                    {customSelected && !pickingCustom ? (
                        <View style={styles.check}>
                            <Ionicons name="checkmark" size={14} color="#FFF" />
                        </View>
                    ) : null}
                </TouchableOpacity>
            ) : null}
            {coverPresets.map((preset) => {
                const key = coverPresetKey(preset.id);
                const selected = value === key;
                return (
                    <TouchableOpacity
                        key={preset.id}
                        style={[styles.card, wide && styles.cardWide, selected && styles.cardOn]}
                        onPress={() => onSelect(key)}
                        activeOpacity={0.9}
                    >
                        <Image source={preset.image} style={imageStyle} contentFit="cover" />
                        {selected ? (
                            <View style={styles.check}>
                                <Ionicons name="checkmark" size={14} color="#FFF" />
                            </View>
                        ) : null}
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    row: { gap: 10, paddingRight: 8 },
    card: {
        width: 108,
        borderRadius: 16,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
        backgroundColor: '#F8FAFC',
    },
    cardOn: { borderColor: INK },
    image: { width: 104, height: 78 },
    cardWide: { width: 148 },
    imageWide: { width: 144, height: 72 },
    galleryTile: {
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#EEF2FF',
    },
    galleryPlus: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: INK,
        alignItems: 'center',
        justifyContent: 'center',
    },
    busy: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(15,23,42,0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    check: {
        position: 'absolute',
        top: 8,
        right: 8,
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: INK,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
