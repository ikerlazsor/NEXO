export type PushLang = 'es' | 'en' | 'fr' | 'de' | 'pt' | 'it';

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
    const v = String(value ?? '').toLowerCase().split('-')[0];
    if (v === 'es' || v === 'en' || v === 'fr' || v === 'de' || v === 'pt' || v === 'it') return v;
    return 'en';
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

const FALLBACK_PLAN: Record<PushLang, string> = {
    es: 'tu plan',
    en: 'your plan',
    fr: 'ton plan',
    de: 'dein Plan',
    pt: 'o teu plano',
    it: 'il tuo piano',
};

export function fallbackPlanTitle(lang: PushLang): string {
    return FALLBACK_PLAN[lang] || FALLBACK_PLAN.en;
}

const SOMEONE: Record<PushLang, string> = {
    es: 'Alguien',
    en: 'Someone',
    fr: 'Quelqu’un',
    de: 'Jemand',
    pt: 'Alguém',
    it: 'Qualcuno',
};

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
    fr: {
        agradable: 'Bonne ambiance',
        puntual: 'Ponctuel',
        respetuoso: 'Respectueux',
        cercano: 'Chaleureux',
        divertido: 'Amusant',
        social: 'Bonne compagnie',
        organizado: 'Bien organisé',
        buen_ambiente: 'Bonne ambiance',
        puntual_org: 'À l’heure',
        comunicacion: 'Communication claire',
        fiel_anuncio: 'Fidèle à l’annonce',
    },
    de: {
        agradable: 'Gute Stimmung',
        puntual: 'Pünktlich',
        respetuoso: 'Respektvoll',
        cercano: 'Warmherzig',
        divertido: 'Lustig',
        social: 'Gute Gesellschaft',
        organizado: 'Gut organisiert',
        buen_ambiente: 'Gute Atmosphäre',
        puntual_org: 'Pünktlich',
        comunicacion: 'Klare Kommunikation',
        fiel_anuncio: 'Wie angekündigt',
    },
    pt: {
        agradable: 'Bom ambiente',
        puntual: 'Pontual',
        respetuoso: 'Respeitoso',
        cercano: 'Acolhedor',
        divertido: 'Divertido',
        social: 'Boa companhia',
        organizado: 'Bem organizado',
        buen_ambiente: 'Bom ambiente',
        puntual_org: 'Pontual',
        comunicacion: 'Comunicação clara',
        fiel_anuncio: 'Fiel ao anúncio',
    },
    it: {
        agradable: 'Bel clima',
        puntual: 'Puntuale',
        respetuoso: 'Rispettoso',
        cercano: 'Accogliente',
        divertido: 'Divertente',
        social: 'Ottima compagnia',
        organizado: 'Ben organizzato',
        buen_ambiente: 'Bel clima',
        puntual_org: 'In orario',
        comunicacion: 'Comunicazione chiara',
        fiel_anuncio: 'Fedele all’annuncio',
    },
};

function traitLabel(lang: PushLang, key: string): string {
    const trimmed = key.trim();
    if (!trimmed) return '';
    return TRAIT_LABEL[lang]?.[trimmed] || TRAIT_LABEL.en[trimmed] || trimmed;
}

const MSG: Record<PushLang, { photo: string; video: string; audio: string; joined: string; message: string }> = {
    es: { photo: 'Foto', video: 'Vídeo', audio: 'Audio', joined: 'Alguien se ha unido', message: 'Mensaje' },
    en: { photo: 'Photo', video: 'Video', audio: 'Voice message', joined: 'Someone joined', message: 'Message' },
    fr: { photo: 'Photo', video: 'Vidéo', audio: 'Message vocal', joined: 'Quelqu’un a rejoint', message: 'Message' },
    de: { photo: 'Foto', video: 'Video', audio: 'Sprachnachricht', joined: 'Jemand ist beigetreten', message: 'Nachricht' },
    pt: { photo: 'Foto', video: 'Vídeo', audio: 'Mensagem de voz', joined: 'Alguém entrou', message: 'Mensagem' },
    it: { photo: 'Foto', video: 'Video', audio: 'Messaggio vocale', joined: 'Qualcuno si è unito', message: 'Messaggio' },
};

export function previewMessage(opts: {
    tipo?: unknown;
    contenido?: unknown;
    lang: PushLang;
}): string {
    const lang = parsePushLang(opts.lang);
    const type = String(opts.tipo ?? 'texto');
    const m = MSG[lang];
    if (String(opts.contenido ?? '').startsWith('nexo_moments:v1:')) {
        return lang === 'es' ? 'Momentos del plan' : 'Plan moments';
    }
    if (type === 'imagen') return m.photo;
    if (type === 'video') return m.video;
    if (type === 'audio') return m.audio;

    let content = String(opts.contenido ?? '');
    if (content.startsWith('@@nexo_system:')) return m.joined;
    if (content.startsWith('@@nexo_plan_invite:')) {
        return lang === 'es' ? 'Te ha invitado a un plan' : 'Invited you to a plan';
    }
    const mark = '@@nexo_reply:';
    if (content.startsWith(mark)) {
        const end = content.indexOf('@@\n', mark.length);
        if (end >= 0) content = content.slice(end + 3);
    }
    const text = content.replace(/\s+/g, ' ').trim().slice(0, 100);
    if (text) return text;
    return m.message;
}

/** Copy estilo WhatsApp/IG: título corto (nombre o plan), cuerpo directo. */
export function buildPushCopy(input: PushCopyInput): { title: string; body: string } {
    const lang = parsePushLang(input.lang);
    const name = (input.senderName || SOMEONE[lang]).trim();
    const plan = (input.planTitle || fallbackPlanTitle(lang)).trim();
    const extra = Math.max(0, input.extraCount ?? 0);
    const vars = { name, plan, place: (input.place || '').trim(), time: input.time || '', n: extra };

    const t = {
        es: {
            friendReq: 'Quiere ser tu amigo',
            friendAcc: 'Ha aceptado tu solicitud',
            joinReqExtra: 'Y {n} más quieren unirse a «{plan}»',
            joinReq: 'Quiere unirse a tu plan',
            joined: 'Se ha unido a «{plan}»',
            acceptedTitle: 'Aceptado',
            acceptedBody: 'Estás dentro de «{plan}»',
            invite: 'Te ha invitado a un plan',
            today: 'Hoy',
            todayFull: '«{plan}» a las {time} · {place}',
            todayTime: '«{plan}» a las {time}',
            todayPlan: '«{plan}»',
            rate: 'Valora a los participantes',
            complimentTitle: 'Alguien te ha valorado',
            complimentTrait: 'Te han votado como {trait} en «{plan}»',
            complimentGeneric: 'Alguien de «{plan}» te ha dejado un cumplido',
            spark: 'También te ha destacado',
            cancelledTitle: 'Cancelado',
            cancelledBody: '«{plan}» ya no se celebra',
            updateTitle: 'Cambio en el plan',
            updateBoth: '«{plan}» · {time} · {place}',
            updateGeneric: 'Han actualizado «{plan}»',
            updateTime: '«{plan}» ahora a las {time}',
            updateTimeOnly: 'Nueva hora en «{plan}»',
            updatePlace: '«{plan}» ahora en {place}',
            updatePlaceOnly: 'Nuevo lugar en «{plan}»',
        },
        en: {
            friendReq: 'Wants to be your friend',
            friendAcc: 'Accepted your friend request',
            joinReqExtra: 'And {n} more want to join "{plan}"',
            joinReq: 'Wants to join "{plan}"',
            joined: 'Joined "{plan}"',
            acceptedTitle: 'Accepted',
            acceptedBody: 'You\'re in "{plan}"',
            invite: 'Invited you to "{plan}"',
            today: 'Today',
            todayFull: '"{plan}" at {time} · {place}',
            todayTime: '"{plan}" at {time}',
            todayPlan: '"{plan}"',
            rate: 'Rate the people who went',
            complimentTitle: 'Someone rated you',
            complimentTrait: 'They marked you as {trait} in "{plan}"',
            complimentGeneric: 'Someone from "{plan}" left you a compliment',
            spark: 'Also highlighted you on "{plan}"',
            cancelledTitle: 'Cancelled',
            cancelledBody: '"{plan}" was cancelled',
            updateTitle: 'Plan update',
            updateBoth: '"{plan}" · {time} · {place}',
            updateGeneric: '"{plan}" was updated',
            updateTime: '"{plan}" is now at {time}',
            updateTimeOnly: 'Time changed for "{plan}"',
            updatePlace: '"{plan}" moves to {place}',
            updatePlaceOnly: 'Location changed for "{plan}"',
        },
        fr: {
            friendReq: 'Veut être ton ami',
            friendAcc: 'A accepté ta demande d’ami',
            joinReqExtra: 'Et {n} autres veulent rejoindre «{plan}»',
            joinReq: 'Veut rejoindre «{plan}»',
            joined: 'A rejoint «{plan}»',
            acceptedTitle: 'Accepté',
            acceptedBody: 'Tu es dans «{plan}»',
            invite: 'T’a invité à «{plan}»',
            today: 'Aujourd’hui',
            todayFull: '«{plan}» à {time} · {place}',
            todayTime: '«{plan}» à {time}',
            todayPlan: '«{plan}»',
            rate: 'Note les participants',
            complimentTitle: 'Nouveau compliment',
            complimentTrait: '{trait} — de «{plan}»',
            complimentGeneric: 'Quelqu’un de «{plan}» referait un plan avec toi',
            spark: 'T’a aussi mis en avant sur «{plan}»',
            cancelledTitle: 'Annulé',
            cancelledBody: '«{plan}» a été annulé',
            updateTitle: 'Plan mis à jour',
            updateBoth: '«{plan}» · {time} · {place}',
            updateGeneric: '«{plan}» a été mis à jour',
            updateTime: '«{plan}» est maintenant à {time}',
            updateTimeOnly: 'Nouvelle heure pour «{plan}»',
            updatePlace: '«{plan}» se déplace à {place}',
            updatePlaceOnly: 'Nouveau lieu pour «{plan}»',
        },
        de: {
            friendReq: 'Möchte dein Freund sein',
            friendAcc: 'Hat deine Freundschaftsanfrage angenommen',
            joinReqExtra: 'Und {n} weitere wollen „{plan}“ beitreten',
            joinReq: 'Möchte „{plan}“ beitreten',
            joined: 'Ist „{plan}“ beigetreten',
            acceptedTitle: 'Angenommen',
            acceptedBody: 'Du bist bei „{plan}“ dabei',
            invite: 'Hat dich zu „{plan}“ eingeladen',
            today: 'Heute',
            todayFull: '„{plan}“ um {time} · {place}',
            todayTime: '„{plan}“ um {time}',
            todayPlan: '„{plan}“',
            rate: 'Bewerte die Teilnehmer',
            complimentTitle: 'Neues Kompliment',
            complimentTrait: '{trait} — von „{plan}“',
            complimentGeneric: 'Jemand von „{plan}“ würde wieder mit dir planen',
            spark: 'Hat dich auch bei „{plan}“ hervorgehoben',
            cancelledTitle: 'Abgesagt',
            cancelledBody: '„{plan}“ wurde abgesagt',
            updateTitle: 'Plan-Update',
            updateBoth: '„{plan}“ · {time} · {place}',
            updateGeneric: '„{plan}“ wurde aktualisiert',
            updateTime: '„{plan}“ ist jetzt um {time}',
            updateTimeOnly: 'Neue Uhrzeit für „{plan}“',
            updatePlace: '„{plan}“ findet jetzt in {place} statt',
            updatePlaceOnly: 'Neuer Ort für „{plan}“',
        },
        pt: {
            friendReq: 'Quer ser teu amigo',
            friendAcc: 'Aceitou o teu pedido de amizade',
            joinReqExtra: 'E mais {n} querem juntar-se a «{plan}»',
            joinReq: 'Quer juntar-se a «{plan}»',
            joined: 'Juntou-se a «{plan}»',
            acceptedTitle: 'Aceite',
            acceptedBody: 'Estás dentro de «{plan}»',
            invite: 'Convidou-te para «{plan}»',
            today: 'Hoje',
            todayFull: '«{plan}» às {time} · {place}',
            todayTime: '«{plan}» às {time}',
            todayPlan: '«{plan}»',
            rate: 'Avalia os participantes',
            complimentTitle: 'Novo elogio',
            complimentTrait: '{trait} — de «{plan}»',
            complimentGeneric: 'Alguém de «{plan}» repetiria um plano contigo',
            spark: 'Também te destacou em «{plan}»',
            cancelledTitle: 'Cancelado',
            cancelledBody: '«{plan}» foi cancelado',
            updateTitle: 'Atualização do plano',
            updateBoth: '«{plan}» · {time} · {place}',
            updateGeneric: '«{plan}» foi atualizado',
            updateTime: '«{plan}» é agora às {time}',
            updateTimeOnly: 'Nova hora em «{plan}»',
            updatePlace: '«{plan}» muda para {place}',
            updatePlaceOnly: 'Novo local em «{plan}»',
        },
        it: {
            friendReq: 'Vuole essere tuo amico',
            friendAcc: 'Ha accettato la tua richiesta di amicizia',
            joinReqExtra: 'E altri {n} vogliono unirsi a «{plan}»',
            joinReq: 'Vuole unirsi a «{plan}»',
            joined: 'Si è unito a «{plan}»',
            acceptedTitle: 'Accettato',
            acceptedBody: 'Sei dentro «{plan}»',
            invite: 'Ti ha invitato a «{plan}»',
            today: 'Oggi',
            todayFull: '«{plan}» alle {time} · {place}',
            todayTime: '«{plan}» alle {time}',
            todayPlan: '«{plan}»',
            rate: 'Valuta i partecipanti',
            complimentTitle: 'Nuovo complimento',
            complimentTrait: '{trait} — da «{plan}»',
            complimentGeneric: 'Qualcuno di «{plan}» rifarebbe un piano con te',
            spark: 'Ti ha anche messo in evidenza su «{plan}»',
            cancelledTitle: 'Annullato',
            cancelledBody: '«{plan}» è stato annullato',
            updateTitle: 'Piano aggiornato',
            updateBoth: '«{plan}» · {time} · {place}',
            updateGeneric: '«{plan}» è stato aggiornato',
            updateTime: '«{plan}» è ora alle {time}',
            updateTimeOnly: 'Nuovo orario per «{plan}»',
            updatePlace: '«{plan}» si sposta a {place}',
            updatePlaceOnly: 'Nuovo luogo per «{plan}»',
        },
    }[lang];

    if (input.type === 'friend_request') return { title: name, body: t.friendReq };
    if (input.type === 'friend_accepted') return { title: name, body: t.friendAcc };
    if (input.type === 'plan_join_request') {
        return {
            title: name,
            body: extra > 0 ? fill(t.joinReqExtra, vars) : fill(t.joinReq, vars),
        };
    }
    if (input.type === 'plan_joined') return { title: name, body: fill(t.joined, vars) };
    if (input.type === 'plan_join_accepted') {
        return { title: t.acceptedTitle, body: fill(t.acceptedBody, vars) };
    }
    if (input.type === 'plan_invite') return { title: name, body: fill(t.invite, vars) };
    if (input.type === 'plan_message') {
        const preview = input.messagePreview || MSG[lang].message;
        return { title: plan, body: `${name}: ${preview}` };
    }
    if (input.type === 'direct_message') {
        const preview = input.messagePreview || MSG[lang].message;
        return { title: name, body: preview };
    }
    if (input.type === 'plan_today') {
        const time = vars.time;
        const place = vars.place;
        return {
            title: t.today,
            body:
                time && place
                    ? fill(t.todayFull, vars)
                    : time
                      ? fill(t.todayTime, vars)
                      : fill(t.todayPlan, vars),
        };
    }
    if (input.type === 'rating_ready') return { title: plan, body: t.rate };
    if (input.type === 'compliment') {
        const trait = traitLabel(lang, input.trait || '');
        return {
            title: t.complimentTitle,
            body: trait
                ? fill(t.complimentTrait, { ...vars, trait })
                : fill(t.complimentGeneric, vars),
        };
    }
    if (input.type === 'spark') return { title: name, body: fill(t.spark, vars) };
    if (input.type === 'plan_cancelled') {
        return { title: t.cancelledTitle, body: fill(t.cancelledBody, vars) };
    }
    if (input.type === 'plan_updated') {
        const changedDate = !!input.changedDate;
        const changedPlace = !!input.changedPlace;
        const place = vars.place;
        const time = vars.time;
        if (changedDate && changedPlace) {
            return {
                title: t.updateTitle,
                body: time && place ? fill(t.updateBoth, vars) : fill(t.updateGeneric, vars),
            };
        }
        if (changedDate) {
            return {
                title: t.updateTitle,
                body: time ? fill(t.updateTime, vars) : fill(t.updateTimeOnly, vars),
            };
        }
        return {
            title: t.updateTitle,
            body: place ? fill(t.updatePlace, vars) : fill(t.updatePlaceOnly, vars),
        };
    }

    return { title: 'Nexo!', body: '' };
}
