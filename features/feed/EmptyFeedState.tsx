import { useT } from '../../lib/i18n';
import { NexoEmptyState } from '../../components/ui/NexoState';

export const EmptySearch = ({
  onClear,
  onCreate,
  loadError,
  onRetry,
  nearbyKm,
  nearestDistanceLabel,
  onWidenNearby,
}: {
  onClear: () => void;
  onCreate: () => void;
  loadError?: boolean;
  onRetry?: () => void;
  nearbyKm?: number | null;
  nearestDistanceLabel?: string;
  onWidenNearby?: () => void;
}) => {
  const { t } = useT();
  const nearbyTitle =
    nearbyKm === 4
      ? t('feed.emptyNearbyNear')
      : nearbyKm === 10
        ? t('feed.emptyNearbyCity')
        : nearbyKm != null
          ? t('feed.emptyNearby', { n: nearbyKm })
          : '';

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

  if (nearbyKm != null && nearestDistanceLabel) {
    return (
      <NexoEmptyState
        icon="navigate-outline"
        title={nearbyTitle}
        description={t('feed.emptyNearbySub', { distance: nearestDistanceLabel })}
        actionLabel={t('feed.emptyNearbySeeCloser')}
        onAction={onWidenNearby}
        secondaryLabel={t('feed.emptyCreate')}
        onSecondaryAction={onCreate}
      />
    );
  }

  if (nearbyKm != null) {
    return (
      <NexoEmptyState
        icon="navigate-outline"
        title={nearbyTitle}
        description={t('feed.emptySub')}
        actionLabel={t('feed.emptyCreate')}
        onAction={onCreate}
        secondaryLabel={t('feed.emptySeeAll')}
        onSecondaryAction={onClear}
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
