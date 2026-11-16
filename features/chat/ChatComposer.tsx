import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { PressScale } from '../../components/PressScale';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { useT } from '../../lib/i18n';
import type { ReplyQuote } from '../../lib/chatReply';
import { theme } from '../../theme';
import { createChatStyles } from './chatStyles';
import { formatDuration } from './chatModel';

export type PendingChatFile = { uri: string; type: 'image' | 'video' };
type Props = {
  replyTo: ReplyQuote | null; onCancelReply: () => void;
  pendingFiles: PendingChatFile[]; onClearFiles: () => void;
  inputDisabled: boolean; accessDenied: boolean; recording: boolean; recordingDuration: number;
  messageText: string; onChangeText: (text: string) => void;
  onPickMedia: () => void; onPickMoments: () => void; onAction: () => void;
  actionIcon: keyof typeof Ionicons.glyphMap; maxLength?: number;
};
/** One composer for user plans and external activities, including media and replies. */
export function ChatComposer({ replyTo, onCancelReply, pendingFiles, onClearFiles, inputDisabled,
  accessDenied, recording, recordingDuration, messageText, onChangeText, onPickMedia, onPickMoments, onAction, actionIcon, maxLength }: Props) {
  const { scheme } = useAppTheme();
  const styles = useThemedStyles(createChatStyles);
  const { t } = useT();
  return <>
                {replyTo ? (
                    <View style={styles.replyChip}>
                        <View style={styles.replyChipBody}>
                            <Text style={styles.replyChipName} numberOfLines={1}>
                                {t('chat.replyingTo', { name: replyTo.name })}
                            </Text>
                            <Text style={styles.replyChipPreview} numberOfLines={1}>
                                {replyTo.preview}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={onCancelReply} hitSlop={8}>
                            <Ionicons name="close" size={20} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>
                ) : null}

                {pendingFiles.length ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 }}>
                        <Image
                            source={{ uri: pendingFiles[0].uri }}
                            style={{ width: 48, height: 48, borderRadius: 10 }}
                            contentFit="cover"
                        />
                        <Text style={{ flex: 1, color: theme.colors.text, fontWeight: '700' }} numberOfLines={1}>
                            {pendingFiles.length > 1
                                ? `${t('chat.moments')} · ${pendingFiles.length}`
                                : t('chat.readyToSend')}
                        </Text>
                        <TouchableOpacity onPress={onClearFiles} hitSlop={8}>
                            <Ionicons name="close" size={20} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                    </View>
                ) : null}

                <View style={styles.inputBar}>
                    <TouchableOpacity
                        onPress={onPickMedia}
                        style={styles.attachBtn}
                        disabled={inputDisabled}
                    >
                        <Ionicons
                            name="add"
                            size={26}
                            color={inputDisabled ? '#CBD5E1' : theme.colors.textMuted}
                        />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={onPickMoments}
                        style={styles.attachBtn}
                        disabled={inputDisabled}
                        accessibilityLabel={t('chat.moments')}
                    >
                        <Ionicons
                            name="folder-outline"
                            size={22}
                            color={inputDisabled ? '#CBD5E1' : theme.colors.textMuted}
                        />
                    </TouchableOpacity>

                    <View style={styles.inputContainer}>
                        <TextInput
                            testID="group-chat-message-input"
                            placeholder={
                                recording
                                    ? `${t('chat.recording')} ${formatDuration(recordingDuration)}...`
                                    : accessDenied
                                      ? t('chat.cannotWrite')
                                      : ''
                            }
                            placeholderTextColor={theme.colors.textMuted}
                            keyboardAppearance={scheme}
                            style={styles.textInput}
                            value={messageText}
                            onChangeText={onChangeText}
                            multiline
                            maxLength={maxLength}
                            editable={!recording && !inputDisabled}
                        />
                    </View>

                    <PressScale
                        testID="group-chat-send"
                        accessibilityLabel="Enviar mensaje"
                        onPress={onAction}
                        style={[
                            styles.sendCircle,
                            recording && styles.recordingActive,
                            inputDisabled && styles.sendCircleDisabled,
                        ]}
                        disabled={inputDisabled && !recording}
                        pressedScale={0.86}
                        minTouch={false}
                        haptic={false}
                    >
                        <Ionicons name={actionIcon} size={18} color="white" />
                    </PressScale>
                </View>
  </>;
}
