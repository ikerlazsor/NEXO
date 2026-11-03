import { Linking, Text, type StyleProp, type TextStyle } from 'react-native';

const URL_RE = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function cleanUrl(raw: string): { visible: string; href: string } {
    let visible = raw;
    let extra = '';
    while (visible.length > 0 && /[),.;!?]$/.test(visible)) {
        extra = visible.slice(-1) + extra;
        visible = visible.slice(0, -1);
    }
    const href = /^https?:\/\//i.test(visible) ? visible : `https://${visible}`;
    return { visible: visible + extra, href };
}

export function linkifyParts(text: string): { text: string; href?: string }[] {
    const parts: { text: string; href?: string }[] = [];
    let last = 0;
    for (const match of text.matchAll(URL_RE)) {
        const index = match.index ?? 0;
        if (index > last) parts.push({ text: text.slice(last, index) });
        const { visible, href } = cleanUrl(match[0]);
        const tail = match[0].slice(visible.length);
        parts.push({ text: visible, href });
        if (tail) parts.push({ text: tail });
        last = index + match[0].length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
    return parts.length ? parts : [{ text }];
}

export function LinkifiedText({
    text,
    style,
    linkStyle,
    numberOfLines,
}: {
    text: string;
    style?: StyleProp<TextStyle>;
    linkStyle?: StyleProp<TextStyle>;
    numberOfLines?: number;
}) {
    const parts = linkifyParts(text);
    return (
        <Text style={style} numberOfLines={numberOfLines}>
            {parts.map((part, index) =>
                part.href ? (
                    <Text
                        key={`${index}-${part.href}`}
                        style={linkStyle}
                        onPress={() => {
                            void Linking.openURL(part.href!);
                        }}
                    >
                        {part.text}
                    </Text>
                ) : (
                    <Text key={index} style={style}>{part.text}</Text>
                ),
            )}
        </Text>
    );
}
