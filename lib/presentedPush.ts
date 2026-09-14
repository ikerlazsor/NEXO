import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { dismissInAppToasts, type InAppToast } from './inAppToast';
import { normalizePushData } from './push';

export type PresentedPushMatch = {
    types?: string[];
    screens?: string[];
    planId?: string;
    otherUserId?: string;
};

function str(data: Record<string, unknown> | undefined, key: string): string {
    const value = data?.[key];
    return value == null ? '' : String(value);
}

function toastMatches(toast: InAppToast, match: PresentedPushMatch): boolean {
    return dataMatches(toast.data, match);
}

function dataMatches(raw: Record<string, unknown> | undefined, match: PresentedPushMatch): boolean {
    const data = normalizePushData(raw);
    if (!data) return false;
    const type = str(data, 'type');
    const screen = str(data, 'screen');
    const planId = str(data, 'planId');
    const otherUserId = str(data, 'otherUserId');

    if (match.types?.length && !match.types.includes(type)) return false;
    if (match.screens?.length && screen && !match.screens.includes(screen)) return false;
    if (match.planId && planId && match.planId !== planId) return false;
    if (match.planId && !planId) return false;
    if (match.otherUserId && otherUserId && match.otherUserId !== otherUserId) return false;
    if (match.otherUserId && !otherUserId) return false;
    return true;
}

function identifierMatches(identifier: string, match: PresentedPushMatch): boolean {
    if (!match.planId) return false;
    const id = identifier.toLowerCase();
    const planId = match.planId.toLowerCase();
    if (!id.includes(planId)) return false;
    if (!match.types?.length) return true;
    return match.types.some((type) => {
        if (type === 'rating_ready') return id.startsWith('rating:');
        if (type === 'plan_today') return id.startsWith('plan-today:');
        if (type === 'plan_message') return id.includes('plan-msg') || id.includes('chat');
        return id.includes(type.replace(/_/g, '-'));
    });
}

/** Quita del sistema y del toast in-app las notis que ya has visto al entrar a esa pantalla. */
export async function dismissPresentedPush(match: PresentedPushMatch): Promise<void> {
    dismissInAppToasts((toast) => toastMatches(toast, match));
    if (Platform.OS === 'web') return;
    try {
        const presented = await Notifications.getPresentedNotificationsAsync();
        await Promise.all(
            presented.map(async (item) => {
                const data = item.request.content.data as Record<string, unknown> | undefined;
                const identifier = item.request.identifier;
                if (!dataMatches(data, match) && !identifierMatches(identifier, match)) return;
                await Notifications.dismissNotificationAsync(identifier).catch(() => {});
            }),
        );
    } catch {
        /* simulador / permiso */
    }
}

export function dismissPushForPlanChat(planId: string): void {
    if (!planId) return;
    void dismissPresentedPush({ types: ['plan_message'], planId, screens: ['chat'] });
}

export function dismissPushForDirectChat(otherUserId: string): void {
    if (!otherUserId) return;
    void dismissPresentedPush({ types: ['direct_message'], otherUserId, screens: ['direct-chat'] });
}

export function dismissPushForPlanDetail(planId: string): void {
    if (!planId) return;
    void dismissPresentedPush({
        planId,
        types: ['plan_invite', 'plan_join_request', 'plan_joined', 'plan_join_accepted', 'plan_today'],
    });
}

export function dismissPushForFriends(): void {
    void dismissPresentedPush({
        types: ['friend_request', 'friend_accepted', 'plan_invite'],
    });
}

export function dismissPushForMyPlans(): void {
    void dismissPresentedPush({ types: ['plan_join_request', 'plan_joined', 'plan_cancelled'] });
}

export function dismissPushForRating(planId: string): void {
    if (!planId) return;
    void dismissPresentedPush({ types: ['rating_ready'], planId, screens: ['rate-plan'] });
}

export function dismissPushFromPayload(raw: Record<string, unknown> | undefined): void {
    const data = normalizePushData(raw);
    if (!data) return;
    const type = str(data, 'type');
    const planId = str(data, 'planId');
    const otherUserId = str(data, 'otherUserId');
    void dismissPresentedPush({
        types: type ? [type] : undefined,
        planId: planId || undefined,
        otherUserId: otherUserId || undefined,
    });
}
