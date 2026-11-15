import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, Modal, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthSession } from '../../lib/authSession';
import { useAppTheme, useThemedStyles } from '../../lib/appTheme';
import { useT } from '../../lib/i18n';
import { Alert } from '../../lib/nexoAlert';
import { ProfileAvatar } from '../../components/ProfileAvatar';
import { ChatMessageRow } from '../../components/ChatMessageRow';
import { ReactionEmojiPicker } from '../../components/MessageReactionsBar';
import { MomentsAlbum } from '../../components/MomentsAlbum';
import { ChatHeader } from '../../features/chat/ChatHeader';
import { ChatTimeline } from '../../features/chat/ChatTimeline';
import { ChatComposer } from '../../features/chat/ChatComposer';
import { ChatMediaModals } from '../../features/chat/ChatMediaModals';
import { useChatMedia } from '../../features/chat/useChatMedia';
import { createChatStyles } from '../../features/chat/chatStyles';
import { parseStoredDuration, type Message } from '../../features/chat/chatModel';
import { useInvertedChatStickiness } from '../../lib/chatScroll';
import { ChatKeyboardAnimated, useChatKeyboardBottomPad } from '../../lib/chatKeyboard';
import { encodeReplyContent, previewForReply, type ReplyQuote } from '../../lib/chatReply';
import { resolveChatFileUrls } from '../../lib/chatUpload';
import type { MomentItem } from '../../lib/planMoments';
import { useEventChat } from '../../features/events/useEventChat';
import { eventChatMessage } from '../../features/events/chatAdapter';
import { fetchEvent, fetchEventPeople, reportEventMessage, toggleEventReaction, deleteEventMessage, setEventChatPreferences, fetchEventChatThreads } from '../../features/events/api';
import { peekEvent } from '../../features/events/cache';
import { EventArtwork } from '../../features/events/EventCards';
import type { EventPerson } from '../../features/events/types';

export default function EventChatRoute() {
  const params = useLocalSearchParams<{ id: string; fromEvent?: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const { userId } = useAuthSession();
  return <EventConversation key={JSON.stringify([id, userId])} id={id} userId={userId} fromEvent={params.fromEvent === '1'} />;
}
function EventConversation({ id, userId, fromEvent }: { id: string; userId: string | null; fromEvent: boolean }) {
  const router = useRouter();
  const { t } = useT();
  const { colors } = useAppTheme();
  const styles = useThemedStyles(createChatStyles);
  const insets = useSafeAreaInsets();
  const keyboardStyle = useChatKeyboardBottomPad(insets.bottom);
  const chat = useEventChat(id, userId);
  const [event, setEvent] = useState(() => peekEvent(id));
  const [people, setPeople] = useState<EventPerson[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [reply, setReply] = useState<ReplyQuote | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [image, setImage] = useState<string | null>(null), [video, setVideo] = useState<string | null>(null);
  const [moments, setMoments] = useState<MomentItem[] | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    void fetchEvent(id, abort.signal).then(value => { if (!abort.signal.aborted) setEvent(value); }).catch(() => {});
    return () => abort.abort();
  }, [id]);
  useEffect(() => {
    if (!chat.member) return;
    const abort = new AbortController();
    void fetchEventPeople(id, undefined, abort.signal).then(value => { if (!abort.signal.aborted) setPeople(value); }).catch(() => {});
    return () => abort.abort();
  }, [id, chat.member, membersOpen]);
  useEffect(() => {
    let active = true;
    const rows = chat.messages.map(row => eventChatMessage(row, chat.profiles));
    // Text paints immediately; private attachments acquire fresh member-only URLs.
    setMessages(rows.map(row => row.archivo_url?.startsWith('event_') ? { ...row, archivo_url: null } : row));
    void resolveChatFileUrls(rows).then(value => { if (active) setMessages(value); });
    return () => { active = false; };
  }, [chat.messages, chat.profiles]);
  const scroll = useInvertedChatStickiness<Message>();
  const newest = messages[0]?.id;
  const { maybeStickAfterIncoming } = scroll;
  useEffect(() => { maybeStickAfterIncoming(); }, [newest, maybeStickAfterIncoming]);
  useEffect(() => {
    if (!chat.member) return;
    void setEventChatPreferences(id, { read: true, hidden: false }).catch(() => {});
  }, [id, chat.member, newest]);
  useEffect(() => {
    if (!chat.member) return;
    void fetchEventChatThreads().then(threads => { if (alive.current) setMuted(threads.find(thread => thread.event.id === id)?.muted || false); }).catch(() => {});
  }, [id, chat.member]);
  const send = async (type: Message['tipo'] = 'texto', file?: string, duration?: number, content?: string) => {
    const text = content ?? (type === 'texto' ? (reply ? encodeReplyContent(chat.text.trim(), reply) : chat.text.trim()) : type === 'audio' ? String(duration || 1) : type === 'video' ? t('chat.videoLabel') : t('chats.previewImage'));
    try {
      if (await chat.send(text, type, file || null)) {
        if (alive.current) { setReply(null); scroll.scrollToLatest(true); }
      }
    } catch (error) {
      if (alive.current) Alert.alert(t('chat.errorTitle'), t('events.sentFailed'));
      throw error;
    }
  };
  const media = useChatMedia({ roomId: id, kind: 'event', accessDenied: !chat.member, messages, send });
  const action = () => {
    if (media.isUploading || chat.sending) return;
    if (media.pendingFiles.length) void media.sendPendingFiles().catch(() => {});
    else if (chat.text.trim()) void send().catch(() => {});
    else if (media.recording) void media.stopRecording();
    else void media.startRecording();
  };
  const { refresh } = chat;
  const mutate = useCallback(async (work: () => Promise<unknown>) => {
    try { await work(); if (alive.current) { setPicked(null); await refresh(); } }
    catch { if (alive.current) Alert.alert(t('chat.errorTitle'), t('events.error')); }
  }, [refresh, t]);
  const selected = messages.find(row => row.id === picked);
  const report = () => {
    if (!picked || !userId) return;
    Alert.alert(t('events.report'), t('events.reportReason'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('events.report'), onPress: () => { if (alive.current) void mutate(() => reportEventMessage(picked, userId, t('events.reportReason'))); } },
    ]);
  };
  const renderItem = useCallback(({ item }: { item: Message }) => <ChatMessageRow item={item} currentUserId={userId}
    isPlaying={media.playingMessageId === item.id} audioDurationSec={media.audioDurations[item.id] || parseStoredDuration(item.contenido) || undefined}
    reactions={chat.reactions} videoLabel={t('chat.videoLabel')}
    onOpenProfile={uid => router.push({ pathname: '/user-profile/[id]', params: { id: uid } })}
    onOpenImage={setImage} onOpenVideo={setVideo} onOpenMoments={setMoments} onPlayAudio={media.playAudio}
    onLongPressMessage={setPicked} onReplyMessage={messageId => {
      const row = messages.find(value => value.id === messageId); if (!row) return;
      setReply({ id: row.id, name: chat.names[row.emisor_id] || 'Nexo', preview: previewForReply(row.contenido, row.tipo) });
    }} onPickReaction={(message, emoji) => { void mutate(() => toggleEventReaction(id, message, emoji)); }}
  />, [userId, media.playingMessageId, media.audioDurations, media.playAudio, chat.reactions, chat.names, t, router, messages, id, mutate]);
  const title = event?.title || t('events.chat');
  const subtitle = useMemo(() => people.map(person => person.nombre).join(', '), [people]);
  return <View style={styles.container}>
    <ChatHeader title={title} subtitle={subtitle} onBack={() => router.canGoBack() ? router.back() : router.replace('/chats')}
      onInfo={() => fromEvent && router.canGoBack() ? router.back() : router.push({ pathname: '/event/[id]', params: { id } })}
      image={<TouchableOpacity style={styles.planHeaderImageWrap} onPress={() => setMembersOpen(true)}>
        {event ? <EventArtwork event={event} style={styles.planHeaderImage} /> : null}
      </TouchableOpacity>}
      actions={<><TouchableOpacity style={styles.membersBtn} onPress={() => setMembersOpen(true)} accessibilityRole="button" accessibilityLabel={t('events.people')}>
        <Ionicons name="people" size={22} color={colors.brand} />
      </TouchableOpacity><TouchableOpacity style={styles.membersBtn} disabled={!chat.member} onPress={() => {
        void setEventChatPreferences(id, { muted: !muted }).then(() => { if (alive.current) setMuted(!muted); }).catch(() => Alert.alert(t('chat.errorTitle'), t('events.error')));
      }} accessibilityRole="button" accessibilityLabel={t(muted ? 'chat.unmute' : 'chat.mute')}>
        <Ionicons name={muted ? 'notifications-off' : 'notifications-outline'} size={20} color={muted ? colors.textMuted : colors.brand} />
      </TouchableOpacity></>} />
    {chat.failed && <TouchableOpacity onPress={() => void chat.refresh()}><Text style={{ color: colors.danger, padding: 12 }}>{t('events.error')} · {t('events.retry')}</Text></TouchableOpacity>}
    <ChatKeyboardAnimated.View style={[{ flex: 1 }, keyboardStyle]}>
      {chat.loading && !chat.member ? <View style={styles.loading}><ActivityIndicator color={colors.brand} /></View> : !chat.member ? <View style={styles.accessDenied}><Ionicons name="lock-closed-outline" size={48} color={colors.textMuted} />
        <Text style={styles.accessDeniedTitle}>{t('chat.accessDenied')}</Text><Text style={styles.accessDeniedText}>{t('events.chatNotice')}</Text>
      </View> : <View style={styles.messagesPanel}>
        <ChatTimeline listRef={scroll.listRef} messages={messages} renderItem={renderItem} onScroll={scroll.onScroll}
          onScrollBeginDrag={scroll.onScrollBeginDrag} onScrollEndDrag={scroll.onScrollEndDrag}
          onMomentumScrollEnd={scroll.onMomentumScrollEnd} onContentSizeChange={scroll.onContentSizeChange}
          onEndReached={() => { if (chat.more && chat.messages.length) void chat.refresh(chat.messages.at(-1)); }}
          footer={chat.more ? <ActivityIndicator color={colors.brand} /> : null} />
        {!messages.length && <View style={styles.emptyChatOverlay} pointerEvents="none"><Text style={styles.emptyChatText}>{t('chat.emptyThread')}</Text></View>}
      </View>}
      <ChatComposer replyTo={reply} onCancelReply={() => setReply(null)} pendingFiles={media.pendingFiles} onClearFiles={() => media.setPendingFiles([])}
        inputDisabled={!chat.member || chat.sending || media.isUploading} accessDenied={!chat.member} recording={!!media.recording}
        recordingDuration={media.recordingDuration} messageText={chat.text} onChangeText={chat.setText} maxLength={2000}
        onPickMedia={() => void media.pickMedia()} onPickMoments={() => void media.pickMoments()} onAction={action}
        actionIcon={chat.sending || media.isUploading ? 'hourglass' : media.pendingFiles.length || chat.text.trim() ? 'send' : media.recording ? 'stop' : 'mic'} />
    </ChatKeyboardAnimated.View>
    <ReactionEmojiPicker visible={!!picked} onClose={() => setPicked(null)}
      onPick={emoji => { if (picked) void mutate(() => toggleEventReaction(id, picked, emoji)); }}
      onReport={selected?.emisor_id !== userId ? report : undefined}
      onDelete={selected?.emisor_id === userId ? () => Alert.alert(t('common.delete'), t('chat.deleteMessageConfirm'), [
        { text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => { if (picked && alive.current) void mutate(() => deleteEventMessage(id, picked)); } },
      ]) : undefined} />
    <ChatMediaModals imageUrl={image} videoUrl={video} onCloseImage={() => setImage(null)} onCloseVideo={() => setVideo(null)} />
    <MomentsAlbum items={moments} onClose={() => setMoments(null)} onOpenImage={setImage} onOpenVideo={setVideo} />
    <Modal visible={membersOpen} animationType="slide" onRequestClose={() => setMembersOpen(false)}>
      <View style={[styles.container, { paddingTop: insets.top + 16, paddingHorizontal: 20 }]}>
        <TouchableOpacity onPress={() => setMembersOpen(false)}><Text style={{ color: colors.brand, fontWeight: '700', paddingBottom: 20 }}>{t('common.back')}</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('events.people')}</Text>
        {people.map(person => <TouchableOpacity key={person.user_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 }}
          onPress={() => { setMembersOpen(false); router.push({ pathname: '/user-profile/[id]', params: { id: person.user_id } }); }}>
          <ProfileAvatar uri={person.avatar_url} size={42} /><Text style={{ color: colors.text }}>{person.nombre}</Text>
        </TouchableOpacity>)}
      </View>
    </Modal>
  </View>;
}
