// Development-only conversation fixture. No account, server or production writes.
import { registerRootComponent } from 'expo';
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ChatHeader } from '../../features/chat/ChatHeader';
import { ChatTimeline } from '../../features/chat/ChatTimeline';
import { ChatComposer } from '../../features/chat/ChatComposer';
import { ChatMessageRow } from '../../components/ChatMessageRow';
import { createChatStyles } from '../../features/chat/chatStyles';
import type { Message } from '../../features/chat/chatModel';
import { useThemedStyles, useAppTheme } from '../../lib/appTheme';
import { encodeReplyContent, previewForReply, type ReplyQuote } from '../../lib/chatReply';
import { ChatKeyboardAnimated, useChatKeyboardBottomPad } from '../../lib/chatKeyboard';
import { Ionicons } from '@expo/vector-icons';
const seed: Message[] = [{ id: 'sample-1', emisor_id: 'peer', creado_en: '2026-11-15T10:30:00Z', tipo: 'texto', archivo_url: null,
  contenido: '¡Hola! ¿Nos encontramos diez minutos antes?', perfiles: { nombre: 'Ana', avatar_url: null } }];
function Conversation() {
  const [kind, setKind] = useState('plan');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState(seed);
  const [reply, setReply] = useState<ReplyQuote | null>(null);
  const styles = useThemedStyles(createChatStyles);
  const { colors } = useAppTheme();
  const keyboardStyle = useChatKeyboardBottomPad(0);
  return <View style={[styles.container, { maxWidth: 520, width: '100%', alignSelf: 'center' }]}>
    <View style={{ flexDirection: 'row', padding: 6, gap: 20 }}>
      <Text style={{ color: colors.textMuted }}>Vista de prueba · datos ficticios</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cambiar origen" onPress={() => setKind(kind === 'plan' ? 'event' : 'plan')}><Text style={{ color: colors.primary }}>Cambiar origen</Text></TouchableOpacity>
    </View>
    <ChatHeader title={kind === 'plan' ? 'Senderismo con amigos' : 'Senderismo · actividad de Madrid'} subtitle="Ana, Leo y tú" onBack={() => {}} onInfo={() => {}}
      image={<View style={[styles.planHeaderImage,{alignItems:'center',justifyContent:'center'}]}><Ionicons name="people" size={24} color={colors.primary}/></View>}
    />
    <ChatKeyboardAnimated.View style={[{ flex: 1 }, keyboardStyle]}>
      <View style={styles.messagesPanel}><ChatTimeline messages={messages} renderItem={({item}) => <ChatMessageRow item={item} currentUserId="me"
        isPlaying={false} reactions={[]} videoLabel="Vídeo" onOpenProfile={() => {}} onOpenImage={() => {}} onOpenVideo={() => {}} onPlayAudio={() => {}}
        onLongPressMessage={() => {}} onReplyMessage={() => setReply({id:item.id,name:'Ana',preview:previewForReply(item.contenido,item.tipo)})} onPickReaction={() => {}} />}/></View>
      <ChatComposer replyTo={reply} onCancelReply={() => setReply(null)} pendingFiles={[]} onClearFiles={() => {}}
        inputDisabled={false} accessDenied={false} recording={false} recordingDuration={0} messageText={text} onChangeText={setText}
        onPickMedia={() => {}} onPickMoments={() => {}} actionIcon={text.trim() ? 'send' : 'mic'} onAction={() => {
          if (!text.trim()) return;
          setMessages(rows => [{ ...seed[0], id: `message-${rows.length}`, emisor_id:'me', contenido: reply ? encodeReplyContent(text,reply) : text, perfiles:{nombre:'Tú',avatar_url:null} }, ...rows]);setText('');setReply(null);
        }} />
    </ChatKeyboardAnimated.View>
  </View>;
}
registerRootComponent(() => <GestureHandlerRootView style={{flex:1}}><SafeAreaProvider><Conversation /></SafeAreaProvider></GestureHandlerRootView>);
