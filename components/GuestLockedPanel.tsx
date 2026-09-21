import { useAuthSession } from '../lib/authSession';
import type { AuthIntent } from '../lib/authIntent';
import { guestCopyKeys } from '../lib/authIntent';
import { useT } from '../lib/i18n';
import { NexoEmptyState } from './ui/NexoState';

const PENGUIN_CHATS_EMPTY = require('../assets/images/Pinguino vacio chats.png');

type Props = {
    intent: Extract<AuthIntent, { type: 'chats' | 'my-plans' | 'search' | 'create-plan' | 'generic' }>;
};

export function GuestLockedPanel({ intent }: Props) {
    const { t } = useT();
    const { requireAccount } = useAuthSession();
    const copy = guestCopyKeys(intent);
    const isChats = intent.type === 'chats';

    return (
        <NexoEmptyState
            {...(isChats
                ? { image: PENGUIN_CHATS_EMPTY, imageSize: 188 }
                : { icon: 'person-add-outline' as const })}
            title={t(copy.title)}
            actionLabel={t('login.access')}
            onAction={() => {
                requireAccount(intent);
            }}
            style={{ flex: 1, justifyContent: 'flex-start', paddingTop: isChats ? 96 : 48 }}
        />
    );
}
