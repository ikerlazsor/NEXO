import { useT } from '../../lib/i18n';
import { NexoEmptyState } from '../../components/ui/NexoState';

export const EmptySearch = ({
  onClear,
  onCreate,
  loadError,
  onRetry,
}: {
  onClear: () => void;
  onCreate: () => void;
  loadError?: boolean;
  onRetry?: () => void;
}) => {
  const { t } = useT();

  if (loadError) {
    return (
      <NexoEmptyState
        icon="cloud-offline-outline"
        title={t('feed.loadError')}
        actionLabel={t('feed.retry')}
        onAction={onRetry}
      />
    );
  }

  return (
    <NexoEmptyState
      icon="compass-outline"
      title={t('feed.empty')}
      description={t('feed.emptySub')}
      actionLabel={t('feed.emptyCreate')}
      onAction={onCreate}
      secondaryLabel={t('feed.emptySeeAll')}
      onSecondaryAction={onClear}
    />
  );
};
