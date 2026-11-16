import { useCallback, useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from '../../lib/nexoAlert';
import { useT } from '../../lib/i18n';
import { uploadChatFile } from '../../lib/chatUpload';
import { encodeMoments, type MomentItem } from '../../lib/planMoments';
import { parseStoredDuration, type Message } from './chatModel';
import type { PendingChatFile } from './ChatComposer';

type Props = { roomId: string | undefined; kind?: 'plan' | 'event'; viewerId?: string | null; accessDenied: boolean; messages: Message[];
  send: (type: Message['tipo'], url?: string, duration?: number, content?: string) => Promise<unknown> };
export function useChatMedia({ roomId: planId, kind = 'plan', viewerId, accessDenied, messages, send }: Props) {
  const { t } = useT();
  const sendRef = useRef(send); sendRef.current = send;
  const room = `${viewerId}:${kind}:${planId}`;
  const currentRoom = useRef(room); currentRoom.current = room;
  const transfer = useRef(false);
  const current = (scope: string) => isMountedRef.current && currentRoom.current === scope;
  const [pendingFiles, setPendingFiles] = useState<PendingChatFile[]>([]);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [audioDurations, setAudioDurations] = useState<Record<string, number>>({});
  const [recordingDuration, setRecordingDuration] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isMountedRef = useRef(true);
  const loadingDurationsRef = useRef(new Set<string>());
  const recordingRef = useRef(recording); recordingRef.current = recording;
  const prepared = useRef<{ files: PendingChatFile[]; uploaded: MomentItem[]; scope: string } | null>(null);
  useEffect(() => () => { void recordingRef.current?.stopAndUnloadAsync().catch(() => {}); }, []);
  useEffect(() => {
    setPendingFiles([]); prepared.current = null;
    setRecording(null); setPlayingMessageId(null); setAudioDurations({});
    return () => {
      void recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      void soundRef.current?.unloadAsync().catch(() => {});
      soundRef.current = null;
    };
  }, [room]);
    const stopAudio = useCallback(async () => {
        if (soundRef.current) {
            await soundRef.current.unloadAsync();
            soundRef.current = null;
        }
        setPlayingMessageId(null);
    }, []);

    useEffect(() => {
        isMountedRef.current = true;

        return () => {
            isMountedRef.current = false;
            soundRef.current?.unloadAsync();
        };
    }, []);

    const loadAudioDuration = useCallback(async (messageId: string, audioUrl: string) => {
        if (loadingDurationsRef.current.has(messageId)) return;
        loadingDurationsRef.current.add(messageId);

        try {
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });
            const { sound } = await Audio.Sound.createAsync({ uri: audioUrl }, { shouldPlay: false });
            const status = await sound.getStatusAsync();
            await sound.unloadAsync();

            if (status.isLoaded && status.durationMillis) {
                const seconds = Math.max(1, Math.round(status.durationMillis / 1000));
                setAudioDurations((prev) => ({ ...prev, [messageId]: seconds }));
            }
        } catch {
            /* duración opcional */
        } finally {
            loadingDurationsRef.current.delete(messageId);
        }
    }, []);

    useEffect(() => {
        messages.forEach((message) => {
            if (message.tipo !== 'audio' || !message.archivo_url) return;
            if (parseStoredDuration(message.contenido)) return;
            if (audioDurations[message.id]) return;
            loadAudioDuration(message.id, message.archivo_url);
        });
    }, [messages, audioDurations, loadAudioDuration]);

    useEffect(() => {
        if (!recording) {
            setRecordingDuration(0);
            return;
        }

        const interval = setInterval(async () => {
            try {
                const status = await recording.getStatusAsync();
                if (status.isRecording && status.durationMillis) {
                    setRecordingDuration(Math.floor(status.durationMillis / 1000));
                }
            } catch {
                // ignore polling errors while recording
            }
        }, 500);

        return () => clearInterval(interval);
    }, [recording]);

    const pickMedia = async () => {
        const scope = room;
        if (isUploading || accessDenied) return;

        const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permissionResult.granted) {
            Alert.alert(t('chat.permRequired'), t('chat.galleryPerm'));
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsEditing: false,
            quality: 0.8,
            videoMaxDuration: 120,
        });

        if (!current(scope) || result.canceled || !result.assets[0]) return;
        const selectedAsset = result.assets[0];
        setPendingFiles([{
            uri: selectedAsset.uri,
            type: selectedAsset.type === 'video' ? 'video' : 'image',
        }]);
    };

    const pickMoments = async () => {
        const scope = room;
        if (isUploading || accessDenied) return;
        const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permissionResult.granted) {
            Alert.alert(t('chat.permRequired'), t('chat.galleryPerm'));
            return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images', 'videos'],
            allowsMultipleSelection: true,
            selectionLimit: 12,
            quality: 0.7,
            videoMaxDuration: 60,
        });
        if (!current(scope) || result.canceled || !result.assets?.length) return;
        setPendingFiles(result.assets.slice(0, 12).map((asset) => ({
            uri: asset.uri,
            type: asset.type === 'video' ? 'video' : 'image',
        })));
    };

    const sendPendingFiles = async () => {
        const scope = room; const sendMessage = sendRef.current;
        if (!pendingFiles.length || !planId || isUploading || transfer.current) return;
        transfer.current = true;
        const batch = pendingFiles;
        setPendingFiles([]);
        setIsUploading(true);
        const reuse = prepared.current?.files === batch && prepared.current.scope === scope;
        const uploaded: MomentItem[] = reuse ? prepared.current!.uploaded : [];
        try {
        for (const file of reuse ? [] : batch) {
            if (!current(scope)) return;
            const url = await uploadChatFile(file.uri, file.type === 'video' ? 'video' : 'image', planId, kind);
            if (url) uploaded.push({ url, type: file.type });
        }
        if (!current(scope)) return;
        setIsUploading(false);
        if (!uploaded.length) {
            setPendingFiles(batch);
            Alert.alert(t('chat.errorTitle'), t('chat.uploadError'));
            return;
        }
        prepared.current = { files: batch, uploaded, scope };
        if (uploaded.length === 1) {
            await sendMessage(uploaded[0].type === 'video' ? 'video' : 'imagen', uploaded[0].url);
            return;
        }
        await sendMessage('imagen', uploaded[0].url, undefined, encodeMoments(uploaded));
        } catch (error) { if (current(scope)) setPendingFiles(batch); throw error; }
        finally { transfer.current = false; if (current(scope)) setIsUploading(false); }
    };

    const startRecording = async () => {
        const scope = room;
        if (isUploading || accessDenied) return;

        try {
            const permission = await Audio.requestPermissionsAsync();
            if (permission.status !== 'granted') {
                Alert.alert(t('chat.permRequired'), t('chat.micPerm'));
                return;
            }

            await stopAudio();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });

            const { recording: newRecording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            if (!current(scope)) { await newRecording.stopAndUnloadAsync(); return; }
            setRecording(newRecording);
        } catch (err) {
            console.error('Fallo al iniciar la grabación', err);
            Alert.alert(t('chat.errorTitle'), t('chat.recordError'));
        }
    };

    const stopRecording = async () => {
        const scope = room;
        if (!recording || !planId) return;

        const sendMessage = sendRef.current;
        const activeRecording = recording;
        setRecording(null);

        try {
            const status = await activeRecording.getStatusAsync();
            const durationSec = Math.max(
                1,
                Math.round((status.durationMillis ?? recordingDuration * 1000) / 1000)
            );

            const uri = activeRecording.getURI();
            await activeRecording.stopAndUnloadAsync();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            if (!uri) return;

            setIsUploading(true);
            const uploadedUrl = await uploadChatFile(uri, 'audio', planId, kind);
            setIsUploading(false);

            if (!current(scope)) return;
            if (uploadedUrl) {
                await sendMessage('audio', uploadedUrl, durationSec);
            } else {
                Alert.alert(t('chat.errorTitle'), t('chat.voiceError'));
            }
        } catch (err) {
            console.error('Fallo al detener la grabación', err);
            setIsUploading(false);
        }
    };

    const playAudio = useCallback(async (messageId: string, audioUrl: string) => {
        const scope = room;
        try {
            if (playingMessageId === messageId) {
                await stopAudio();
                return;
            }

            await stopAudio();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: false,
                playsInSilentModeIOS: true,
            });

            const { sound: newSound } = await Audio.Sound.createAsync(
                { uri: audioUrl },
                { shouldPlay: true }
            );

            if (!current(scope)) { await newSound.unloadAsync(); return; }
            soundRef.current = newSound;
            setPlayingMessageId(messageId);

            newSound.setOnPlaybackStatusUpdate((status) => {
                if (status.isLoaded && status.didJustFinish) {
                    soundRef.current = null;
                    setPlayingMessageId(null);
                }
            });
        } catch (error) {
            if (__DEV__) console.error('Error reproduciendo audio:', error);
            setPlayingMessageId(null);
        }
    }, [playingMessageId, stopAudio, room]);

  return { pendingFiles, setPendingFiles, recording, recordingDuration, playingMessageId,
    isUploading, audioDurations, pickMedia, pickMoments, sendPendingFiles, startRecording, stopRecording, playAudio };
}
