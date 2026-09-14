import { useAuthSession } from '../lib/authSession';
import type { AuthIntent } from '../lib/authIntent';
import { guestCopyKeys } from '../lib/authIntent';
import { useT } from '../lib/i18n';
import { NexoEmptyState } from './ui/NexoState';

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
            icon="person-add-outline"
            title={t(copy.title)}
            description={isChats ? undefined : t(copy.body)}
            actionLabel={t('login.tabRegister')}
            onAction={() => {
                requireAccount(intent);
            }}
            style={{ flex: 1, justifyContent: 'flex-start', paddingTop: isChats ? 72 : 48 }}
        />
    );
}
