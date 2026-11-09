import { useEffect, useState } from 'react';
import { useIsFocused, useNavigation } from '@react-navigation/native';

/** Native maps/large sections mount only after the incoming stack animation. */
export function useScreenTransitionReady(): boolean {
    const focused = useIsFocused();
    const navigation = useNavigation();
    const [ready, setReady] = useState(false);
    useEffect(() => {
        if (!focused) { setReady(false); return; }
        // transitionEnd is native-stack's completion event. A bounded fallback
        // covers initial/deep-linked screens that have no transition event.
        const timer = setTimeout(() => setReady(true), 340);
        const stop = (navigation as any).addListener('transitionEnd', (event: { data?: { closing?: boolean } }) => {
            if (!event.data?.closing) { clearTimeout(timer); setReady(true); }
        });
        return () => { clearTimeout(timer); stop(); };
    }, [focused, navigation]);
    return focused && ready;
}
