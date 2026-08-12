import { supabase } from './supabase';

export const MESSAGE_REPORT_REASONS = [
    'acoso',
    'odio',
    'sexual',
    'violencia',
    'spam',
    'estafa',
    'otro',
] as const;

export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

export async function reportMessage(
    messageId: string,
    reason: MessageReportReason,
    details?: string,
): Promise<{ error: string | null }> {
    const { error } = await supabase.rpc('report_message', {
        p_message_id: messageId,
        p_reason: reason,
        p_details: details?.trim().slice(0, 1000) || null,
    });
    if (!error) return { error: null };

    const message = error.message || '';
    if (/message_already_reported|duplicate|unique/i.test(message)) {
        return { error: 'already_reported' };
    }
    if (/message_report_daily_limit/i.test(message)) {
        return { error: 'message_report_daily_limit' };
    }
    if (/message_not_found_or_forbidden/i.test(message)) {
        return { error: 'message_not_found_or_forbidden' };
    }
    return { error: message };
}

