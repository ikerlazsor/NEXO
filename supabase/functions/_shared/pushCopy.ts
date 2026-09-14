export type PushLang = 'es' | 'en';

export type PushCopyType =
    | 'friend_request'
    | 'friend_accepted'
    | 'plan_join_request'
    | 'plan_joined'
    | 'plan_join_accepted'
    | 'plan_invite'
    | 'plan_message'
    | 'direct_message'
    | 'plan_today'
    | 'rating_ready'
    | 'compliment'
    | 'spark'
    | 'plan_cancelled'
    | 'plan_updated';

export type PushCopyInput = {
    type: PushCopyType;
    lang: PushLang;
    senderName?: string;
    planTitle?: string;
    place?: string;
    time?: string;
    messagePreview?: string;
    extraCount?: number;
    firstJoin?: boolean;
    seed?: string;
    trait?: string;
    /** Cambios en plan_updated: fecha y/o ubicación. */
    changedDate?: boolean;
    changedPlace?: boolean;
};

function fill(template: string, vars: Record<string, string | number>): string {
    let out = template;
    for (const [key, value] of Object.entries(vars)) {
        out = out.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    return out;
}

export function parsePushLang(value: unknown): PushLang {
    return value === 'en' ? 'en' : 'es';
}

export function avatarFallbackUrl(name: string): string {
    const label = (name || 'N').trim() || 'N';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(label)}&background=4DA6FF&color=fff&size=128`;
}

export function resolveAvatarUrl(url: string | null | undefined, name: string): string {
    const trimmed = String(url ?? '').trim();
    if (trimmed.startsWith('https://')) return trimmed;
    return avatarFallbackUrl(name);
}

export function fallbackPlanTitle(lang: PushLang): string {
    return lang === 'en' ? 'your plan' : 'tu plan';
}

const TRAIT_LABEL: Record<PushLang, Record<string, string>> = {
    es: {
        agradable: 'Buen rollo',
        puntual: 'Puntual',
        respetuoso: 'Respetuoso',
        cercano: 'Cercano',
        divertido: 'Divertido',
        social: 'Buena compañía',
        organizado: 'Bien organizado',
        buen_ambiente: 'Buen ambiente',
        puntual_org: 'Puntual',
        comunicacion: 'Comunicación clara',
        fiel_anuncio: 'Fiel a lo anunciado',
    },
    en: {
        agradable: 'Good vibe',
        puntual: 'Punctual',
        respetuoso: 'Respectful',
        cercano: 'Warm',
        divertido: 'Fun',
        social: 'Great company',
        organizado: 'Well organized',
        buen_ambiente: 'Good vibe',
        puntual_org: 'On time',
        comunicacion: 'Clear communication',
        fiel_anuncio: 'As advertised',
    },
};

function traitLabel(lang: PushLang, key: string): string {
    const trimmed = key.trim();
    if (!trimmed) return '';
    return TRAIT_LABEL[lang][trimmed] || trimmed;
}

export function previewMessage(opts: {
    tipo?: unknown;
    contenido?: unknown;
    lang: PushLang;
}): string {
    const type = String(opts.tipo ?? 'texto');
    if (type === 'imagen') return opts.lang === 'en' ? 'Photo' : 'Foto';
    if (type === 'video') return opts.lang === 'en' ? 'Video' : 'Vídeo';
    if (type === 'audio') return opts.lang === 'en' ? 'Voice message' : 'Audio';

    let content = String(opts.contenido ?? '');
    if (content.startsWith('@@nexo_system:')) {
        return opts.lang === 'en' ? 'Someone joined' : 'Alguien se ha unido';
    }
    const mark = '@@nexo_reply:';
    if (content.startsWith(mark)) {
        const end = content.indexOf('@@\n', mark.length);
        if (end >= 0) content = content.slice(end + 3);
    }
    const text = content.replace(/\s+/g, ' ').trim().slice(0, 100);
    if (text) return text;
    return opts.lang === 'en' ? 'Message' : 'Mensaje';
}

/** Copy estilo WhatsApp/IG: título corto (nombre o plan), cuerpo directo. */
export function buildPushCopy(input: PushCopyInput): { title: string; body: string } {
    const lang: PushLang = input.lang === 'en' ? 'en' : 'es';
    const name = (input.senderName || (lang === 'en' ? 'Someone' : 'Alguien')).trim();
    const plan = (input.planTitle || fallbackPlanTitle(lang)).trim();
    const extra = Math.max(0, input.extraCount ?? 0);
    const vars = { name, plan, place: (input.place || '').trim(), time: input.time || '', n: extra };
    const en = lang === 'en';

    if (input.type === 'friend_request') {
        return {
            title: name,
            body: en ? 'Wants to be your friend' : 'Quiere ser tu amigo',
        };
    }

    if (input.type === 'friend_accepted') {
        return {
            title: name,
            body: en ? 'Accepted your friend request' : 'Ha aceptado tu solicitud',
        };
    }

    if (input.type === 'plan_join_request') {
        return {
            title: name,
            body:
                extra > 0
                    ? en
                        ? fill('And {n} more want to join "{plan}"', vars)
                        : fill('Y {n} más quieren unirse a «{plan}»', vars)
                    : en
                      ? fill('Wants to join "{plan}"', vars)
                      : fill('Quiere unirse a tu plan', vars),
        };
    }

    if (input.type === 'plan_joined') {
        return {
            title: name,
            body: en ? fill('Joined "{plan}"', vars) : fill('Se ha unido a «{plan}»', vars),
        };
    }

    if (input.type === 'plan_join_accepted') {
        return {
            title: en ? 'Accepted' : 'Aceptado',
            body: en ? fill('You\'re in "{plan}"', vars) : fill('Estás dentro de «{plan}»', vars),
        };
    }

    if (input.type === 'plan_invite') {
        return {
            title: name,
            body: en ? fill('Invited you to "{plan}"', vars) : fill('Te ha invitado a un plan', vars),
        };
    }

    if (input.type === 'plan_message') {
        const preview = input.messagePreview || (en ? 'Message' : 'Mensaje');
        return {
            title: plan,
            body: `${name}: ${preview}`,
        };
    }

    if (input.type === 'direct_message') {
        const preview = input.messagePreview || (en ? 'Message' : 'Mensaje');
        return {
            title: name,
            body: preview,
        };
    }

    if (input.type === 'plan_today') {
        const time = vars.time;
        const place = vars.place;
        return {
            title: en ? 'Today' : 'Hoy',
            body:
                time && place
                    ? en
                        ? fill('"{plan}" at {time} · {place}', vars)
                        : fill('«{plan}» a las {time} · {place}', vars)
                    : time
                      ? en
                          ? fill('"{plan}" at {time}', vars)
                          : fill('«{plan}» a las {time}', vars)
                      : en
                        ? fill('"{plan}"', vars)
                        : fill('«{plan}»', vars),
        };
    }

    if (input.type === 'rating_ready') {
        return {
            title: plan,
            body: en ? 'Rate the people who went' : 'Valora a los participantes',
        };
    }

    if (input.type === 'compliment') {
        const trait = traitLabel(lang, input.trait || '');
        return {
            title: en ? 'New compliment' : 'Nuevo cumplido',
            body: trait
                ? en
                    ? fill('{trait} — from "{plan}"', { ...vars, trait })
                    : fill('{trait} en «{plan}»', { ...vars, trait })
                : en
                  ? fill('Someone from "{plan}" would hang with you again', vars)
                  : fill('Alguien de «{plan}» repetiría plan contigo', vars),
        };
    }

    if (input.type === 'spark') {
        return {
            title: name,
            body: en
                ? fill('Also highlighted you on "{plan}"', vars)
                : fill('También te ha destacado', vars),
        };
    }

    if (input.type === 'plan_cancelled') {
        return {
            title: en ? 'Cancelled' : 'Cancelado',
            body: en ? fill('"{plan}" was cancelled', vars) : fill('«{plan}» ya no se celebra', vars),
        };
    }

    if (input.type === 'plan_updated') {
        const changedDate = !!input.changedDate;
        const changedPlace = !!input.changedPlace;
        const place = vars.place;
        const time = vars.time;

        if (changedDate && changedPlace) {
            return {
                title: en ? 'Plan update' : 'Cambio en el plan',
                body:
                    time && place
                        ? en
                            ? fill('"{plan}" · {time} · {place}', vars)
                            : fill('«{plan}» · {time} · {place}', vars)
                        : en
                          ? fill('"{plan}" was updated', vars)
                          : fill('Han actualizado «{plan}»', vars),
            };
        }
        if (changedDate) {
            return {
                title: en ? 'Plan update' : 'Cambio en el plan',
                body: time
                    ? en
                        ? fill('"{plan}" is now at {time}', vars)
                        : fill('«{plan}» ahora a las {time}', vars)
                    : en
                      ? fill('Time changed for "{plan}"', vars)
                      : fill('Nueva hora en «{plan}»', vars),
            };
        }
        return {
            title: en ? 'Plan update' : 'Cambio en el plan',
            body: place
                ? en
                    ? fill('"{plan}" moves to {place}', vars)
                    : fill('«{plan}» ahora en {place}', vars)
                : en
                  ? fill('Location changed for "{plan}"', vars)
                  : fill('Nuevo lugar en «{plan}»', vars),
        };
    }

    return { title: 'Nexo!', body: '' };
}
