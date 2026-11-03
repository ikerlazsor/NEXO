/** Tarjeta de invitación a plan embebida en un chat de grupo. */

export const PLAN_INVITE_CARD_MARK = '@@nexo_plan_invite:';

export type PlanInviteCardMember = {
    id: string;
    nombre: string;
    avatarUrl?: string | null;
};

export type PlanInviteCardPayload = {
    planId: string;
    titulo: string;
    imagenUrl?: string | null;
    whenLabel?: string | null;
    place?: string | null;
    inviterId: string;
    inviterName: string;
    inviterAvatarUrl?: string | null;
    members?: PlanInviteCardMember[];
};

export function encodePlanInviteCard(payload: PlanInviteCardPayload): string {
    return `${PLAN_INVITE_CARD_MARK}${JSON.stringify(payload)}`;
}

export function parsePlanInviteCard(contenido: string | null | undefined): PlanInviteCardPayload | null {
    if (!contenido) return null;
    const trimmed = contenido.trim();
    if (!trimmed.startsWith(PLAN_INVITE_CARD_MARK)) return null;
    try {
        const raw = JSON.parse(trimmed.slice(PLAN_INVITE_CARD_MARK.length)) as Partial<PlanInviteCardPayload>;
        if (!raw?.planId || !raw?.titulo || !raw?.inviterId) return null;
        const members = Array.isArray(raw.members)
            ? raw.members
                  .filter((m) => m && typeof m === 'object' && (m as PlanInviteCardMember).id)
                  .map((m) => {
                      const row = m as PlanInviteCardMember;
                      return {
                          id: String(row.id),
                          nombre: String(row.nombre || 'Nexo'),
                          avatarUrl: row.avatarUrl ?? null,
                      };
                  })
                  .slice(0, 12)
            : [];
        return {
            planId: String(raw.planId),
            titulo: String(raw.titulo),
            imagenUrl: raw.imagenUrl ?? null,
            whenLabel: raw.whenLabel ?? null,
            place: raw.place ?? null,
            inviterId: String(raw.inviterId),
            inviterName: String(raw.inviterName || 'Nexo'),
            inviterAvatarUrl: raw.inviterAvatarUrl ?? null,
            members,
        };
    } catch {
        return null;
    }
}

export function isPlanInviteCardContent(contenido: string | null | undefined): boolean {
    return parsePlanInviteCard(contenido) != null;
}
