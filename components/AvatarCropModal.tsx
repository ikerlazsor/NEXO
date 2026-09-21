import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ActivityIndicator,
    Image as RNImage,
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    useWindowDimensions,
    View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../lib/appTheme';
import { cropAvatarToSquare } from '../lib/avatarCrop';
import { useT } from '../lib/i18n';

type Props = {
    visible: boolean;
    uri: string | null;
    imageWidth?: number | null;
    imageHeight?: number | null;
    onCancel: () => void;
    onConfirm: (croppedUri: string) => void;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
        RNImage.getSize(
            uri,
            (width, height) => resolve({ width, height }),
            () => resolve(null),
        );
    });
}

export function AvatarCropModal({
    visible,
    uri,
    imageWidth,
    imageHeight,
    onCancel,
    onConfirm,
}: Props) {
    const { t } = useT();
    const { colors } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { width: screenW, height: screenH } = useWindowDimensions();

    const [imgW, setImgW] = useState(0);
    const [imgH, setImgH] = useState(0);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    const cropSize = Math.min(screenW * 0.86, screenH * 0.52, 360);
    const centerX = screenW / 2;
    const centerY = screenH / 2;

    const cover =
        imgW > 0 && imgH > 0 ? Math.max(cropSize / imgW, cropSize / imgH) : 1;
    const displayW = imgW * cover;
    const displayH = imgH * cover;
    const ready = imgW > 0 && imgH > 0 && !!uri;

    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const startScale = useSharedValue(1);
    const startTX = useSharedValue(0);
    const startTY = useSharedValue(0);
    const dispW = useSharedValue(displayW);
    const dispH = useSharedValue(displayH);
    const cropSv = useSharedValue(cropSize);

    useEffect(() => {
        dispW.value = displayW;
        dispH.value = displayH;
        cropSv.value = cropSize;
    }, [displayW, displayH, cropSize, dispW, dispH, cropSv]);

    useEffect(() => {
        if (!visible || !uri) {
            setImgW(0);
            setImgH(0);
            setError(false);
            setBusy(false);
            return;
        }
        let cancelled = false;
        scale.value = 1;
        translateX.value = 0;
        translateY.value = 0;

        const w = imageWidth && imageWidth > 0 ? imageWidth : null;
        const h = imageHeight && imageHeight > 0 ? imageHeight : null;
        if (w && h) {
            setImgW(w);
            setImgH(h);
            return;
        }

        void getImageSize(uri).then((size) => {
            if (cancelled) return;
            if (!size) {
                setError(true);
                return;
            }
            setImgW(size.width);
            setImgH(size.height);
        });
        return () => {
            cancelled = true;
        };
    }, [visible, uri, imageWidth, imageHeight, scale, translateX, translateY]);

    const pinch = useMemo(
        () =>
            Gesture.Pinch()
                .onBegin(() => {
                    startScale.value = scale.value;
                })
                .onUpdate((e) => {
                    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale.value * e.scale));
                    scale.value = next;
                    const maxX = Math.max(0, (dispW.value * next - cropSv.value) / 2);
                    const maxY = Math.max(0, (dispH.value * next - cropSv.value) / 2);
                    translateX.value = Math.min(maxX, Math.max(-maxX, translateX.value));
                    translateY.value = Math.min(maxY, Math.max(-maxY, translateY.value));
                }),
        [cropSv, dispH, dispW, scale, startScale, translateX, translateY],
    );

    const pan = useMemo(
        () =>
            Gesture.Pan()
                .onBegin(() => {
                    startTX.value = translateX.value;
                    startTY.value = translateY.value;
                })
                .onUpdate((e) => {
                    const s = scale.value;
                    const maxX = Math.max(0, (dispW.value * s - cropSv.value) / 2);
                    const maxY = Math.max(0, (dispH.value * s - cropSv.value) / 2);
                    translateX.value = Math.min(maxX, Math.max(-maxX, startTX.value + e.translationX));
                    translateY.value = Math.min(maxY, Math.max(-maxY, startTY.value + e.translationY));
                }),
        [cropSv, dispH, dispW, scale, startTX, startTY, translateX, translateY],
    );

    const gesture = useMemo(() => Gesture.Simultaneous(pinch, pan), [pinch, pan]);

    const imageStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    const handleConfirm = useCallback(async () => {
        if (!uri || busy || !ready) return;
        setBusy(true);
        setError(false);
        try {
            const s = scale.value;
            const tx = translateX.value;
            const ty = translateY.value;
            const scaledW = displayW * s;
            const scaledH = displayH * s;
            const imageLeft = centerX + tx - scaledW / 2;
            const imageTop = centerY + ty - scaledH / 2;
            const cropLeft = centerX - cropSize / 2;
            const cropTop = centerY - cropSize / 2;
            const sizeInImage = (cropSize / scaledW) * imgW;
            let originX = ((cropLeft - imageLeft) / scaledW) * imgW;
            let originY = ((cropTop - imageTop) / scaledH) * imgH;
            originX = Math.min(Math.max(0, originX), Math.max(0, imgW - sizeInImage));
            originY = Math.min(Math.max(0, originY), Math.max(0, imgH - sizeInImage));

            const cropped = await cropAvatarToSquare(uri, {
                originX,
                originY,
                size: sizeInImage,
            });
            onConfirm(cropped);
        } catch {
            setError(true);
        } finally {
            setBusy(false);
        }
    }, [
        busy,
        centerX,
        centerY,
        cropSize,
        displayH,
        displayW,
        imgH,
        imgW,
        onConfirm,
        ready,
        scale,
        translateX,
        translateY,
        uri,
    ]);

    const overlayColor = 'rgba(0,0,0,0.62)';
    const frameLeft = (screenW - cropSize) / 2;
    const frameTop = (screenH - cropSize) / 2;

    return (
        <Modal
            visible={visible}
            animationType="fade"
            transparent={false}
            onRequestClose={busy ? undefined : onCancel}
            statusBarTranslucent
        >
            <GestureHandlerRootView style={styles.root}>
                <View style={[styles.root, { backgroundColor: '#0B1220' }]}>
                    <View style={styles.stage}>
                        {ready ? (
                            <GestureDetector gesture={gesture}>
                                <Animated.View style={styles.gestureLayer}>
                                    <Animated.Image
                                        source={{ uri }}
                                        style={[
                                            styles.image,
                                            {
                                                width: displayW,
                                                height: displayH,
                                                left: centerX - displayW / 2,
                                                top: centerY - displayH / 2,
                                            },
                                            imageStyle,
                                        ]}
                                    />
                                </Animated.View>
                            </GestureDetector>
                        ) : (
                            <View style={styles.loadingWrap}>
                                <ActivityIndicator color="#FFF" />
                            </View>
                        )}

                        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                            <View style={{ height: frameTop, backgroundColor: overlayColor }} />
                            <View style={{ flexDirection: 'row', height: cropSize }}>
                                <View style={{ width: frameLeft, backgroundColor: overlayColor }} />
                                <View style={[styles.cropFrame, { width: cropSize, height: cropSize }]} />
                                <View style={{ flex: 1, backgroundColor: overlayColor }} />
                            </View>
                            <View style={{ flex: 1, backgroundColor: overlayColor }} />
                        </View>
                    </View>

                    <View
                        style={[styles.header, { paddingTop: Math.max(insets.top, 12) + 4 }]}
                        pointerEvents="box-none"
                    >
                        <Text style={styles.title}>{t('avatarCrop.title')}</Text>
                        <Text style={styles.hint}>{t('avatarCrop.hint')}</Text>
                    </View>

                    <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
                        {error ? <Text style={styles.error}>{t('avatarCrop.error')}</Text> : null}
                        <View style={styles.actions}>
                            <TouchableOpacity
                                style={[styles.btn, styles.btnGhost]}
                                onPress={onCancel}
                                disabled={busy}
                                accessibilityRole="button"
                            >
                                <Text style={styles.btnGhostText}>{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.btn, { backgroundColor: colors.primary }]}
                                onPress={() => {
                                    void handleConfirm();
                                }}
                                disabled={busy || !ready}
                                accessibilityRole="button"
                            >
                                {busy ? (
                                    <ActivityIndicator color="#FFF" />
                                ) : (
                                    <Text style={styles.btnPrimaryText}>{t('avatarCrop.use')}</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </GestureHandlerRootView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: { flex: 1 },
    stage: { ...StyleSheet.absoluteFillObject },
    gestureLayer: { ...StyleSheet.absoluteFillObject },
    image: { position: 'absolute' },
    cropFrame: {
        borderWidth: 2,
        borderColor: '#FFFFFF',
        backgroundColor: 'transparent',
    },
    loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    header: {
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    title: {
        color: '#FFF',
        fontSize: 18,
        fontWeight: '700',
        textAlign: 'center',
    },
    hint: {
        marginTop: 6,
        color: 'rgba(255,255,255,0.78)',
        fontSize: 14,
        textAlign: 'center',
    },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 20,
    },
    error: {
        color: '#FCA5A5',
        textAlign: 'center',
        marginBottom: 10,
        fontSize: 13,
    },
    actions: { flexDirection: 'row', gap: 12 },
    btn: {
        flex: 1,
        height: 52,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnGhost: {
        backgroundColor: 'rgba(255,255,255,0.12)',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.22)',
    },
    btnGhostText: { color: '#FFF', fontSize: 16, fontWeight: '600' },
    btnPrimaryText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
});
