/**
 * Partes del aviso social en tarjetas de plan (amigos + conocidos).
 * El UI pone en negrita `friends` / `coincided` y añade "en este plan".
 */
export type SocialJoinedParts = {
    friends: string | null;
    coincided: string | null;
};

export function formatSocialJoinedBanner(opts: {
    friendsCount: number;
    coincidedCount: number;
    friendsAllFemale: boolean;
    coincidedAllFemale: boolean;
    t: (key: string, params?: Record<string, string | number>) => string;
}): SocialJoinedParts | null {
    const { friendsCount, coincidedCount, friendsAllFemale, coincidedAllFemale, t } = opts;
    if (friendsCount <= 0 && coincidedCount <= 0) return null;

    const friends =
        friendsCount <= 0
            ? null
            : friendsCount === 1
              ? t(friendsAllFemale ? 'card.nounFriendOneF' : 'card.nounFriendOne')
              : t(friendsAllFemale ? 'card.nounFriendManyF' : 'card.nounFriendMany', {
                    n: friendsCount,
                });

    const coincided =
        coincidedCount <= 0
            ? null
            : coincidedCount === 1
              ? t(coincidedAllFemale ? 'card.nounCoincidedOneF' : 'card.nounCoincidedOne')
              : t(coincidedAllFemale ? 'card.nounCoincidedManyF' : 'card.nounCoincidedMany', {
                    n: coincidedCount,
                });

    return { friends, coincided };
}
