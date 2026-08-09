/**
 * Texto unificado del aviso social en tarjetas de plan (amigos + conocidos).
 */
export function formatSocialJoinedBanner(opts: {
    friendsCount: number;
    coincidedCount: number;
    friendsAllFemale: boolean;
    coincidedAllFemale: boolean;
    t: (key: string, params?: Record<string, string | number>) => string;
}): string | null {
    const { friendsCount, coincidedCount, friendsAllFemale, coincidedAllFemale, t } = opts;
    if (friendsCount <= 0 && coincidedCount <= 0) return null;

    const friendPart =
        friendsCount <= 0
            ? null
            : friendsCount === 1
              ? t(friendsAllFemale ? 'card.nounFriendOneF' : 'card.nounFriendOne')
              : t(friendsAllFemale ? 'card.nounFriendManyF' : 'card.nounFriendMany', {
                    n: friendsCount,
                });

    const coincidedPart =
        coincidedCount <= 0
            ? null
            : coincidedCount === 1
              ? t(coincidedAllFemale ? 'card.nounCoincidedOneF' : 'card.nounCoincidedOne')
              : t(coincidedAllFemale ? 'card.nounCoincidedManyF' : 'card.nounCoincidedMany', {
                    n: coincidedCount,
                });

    const allFemale =
        (friendsCount <= 0 || friendsAllFemale) &&
        (coincidedCount <= 0 || coincidedAllFemale);

    if (friendPart && coincidedPart) {
        return t(allFemale ? 'card.socialJoinedBothF' : 'card.socialJoinedBoth', {
            friends: friendPart,
            coincided: coincidedPart,
        });
    }
    const who = friendPart ?? coincidedPart!;
    const onlyCount = friendPart ? friendsCount : coincidedCount;
    if (onlyCount === 1) {
        return t(allFemale ? 'card.socialJoinedOnlyOneF' : 'card.socialJoinedOnlyOne', { who });
    }
    return t(allFemale ? 'card.socialJoinedOnlyF' : 'card.socialJoinedOnly', { who });
}
