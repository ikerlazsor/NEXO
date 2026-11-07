/** A profile read may outlive its screen, session, or an optimistic edit. */
export function createProfileLoadGuard(
    currentUserId: () => string | null,
    currentEditRevision: () => number,
) {
    let generation = 0;
    return {
        begin(userId: string): () => boolean {
            const request = ++generation;
            const editRevision = currentEditRevision();
            return () => request === generation
                && currentUserId() === userId
                && currentEditRevision() === editRevision;
        },
        invalidate(): void {
            generation += 1;
        },
    };
}
