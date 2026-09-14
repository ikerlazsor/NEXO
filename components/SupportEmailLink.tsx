import { StyleSheet, Text } from 'react-native';
import { NEXO_SUPPORT_EMAIL, openSupportEmail } from '../lib/brand';

type Props = {
    prefix: string;
    style?: object;
};

export function SupportEmailLink({ prefix, style }: Props) {
    return (
        <Text style={[styles.text, style]}>
            {prefix}{' '}
            <Text style={styles.link} onPress={() => void openSupportEmail()}>
                {NEXO_SUPPORT_EMAIL}
            </Text>
        </Text>
    );
}

const styles = StyleSheet.create({
    text: {
        marginTop: 8,
        fontSize: 14,
        lineHeight: 21,
        color: '#64748B',
        fontWeight: '500',
    },
    link: {
        color: '#2563EB',
        fontWeight: '700',
    },
});
