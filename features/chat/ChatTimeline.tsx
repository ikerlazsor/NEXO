import type { ComponentProps, Ref } from 'react';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { chatMessageItemType } from '../../components/ChatMessageRow';
import { FLASH_LIST_DRAW_DISTANCE } from '../../lib/listConfig';
import { useThemedStyles } from '../../lib/appTheme';
import { createChatStyles } from './chatStyles';
import { chatListKey, type Message } from './chatModel';

type ListProps = ComponentProps<typeof FlashList<Message>>;
type Props = Pick<ListProps, 'renderItem' | 'onScroll' | 'onScrollBeginDrag' | 'onScrollEndDrag' |
  'onMomentumScrollEnd' | 'onContentSizeChange' | 'onEndReached'> & {
  listRef?: Ref<FlashListRef<Message>>;
  messages: Message[];
  footer?: ListProps['ListFooterComponent'];
};
export function ChatTimeline({ listRef, messages, footer, ...props }: Props) {
  const styles = useThemedStyles(createChatStyles);
  return <FlashList ref={listRef} style={{ flex: 1 }} data={messages}
    keyExtractor={chatListKey} getItemType={chatMessageItemType} inverted
    drawDistance={FLASH_LIST_DRAW_DISTANCE} contentContainerStyle={styles.listContent}
    keyboardShouldPersistTaps="handled" scrollEventThrottle={16}
    onEndReachedThreshold={0.3} ListFooterComponent={footer} {...props} />;
}
