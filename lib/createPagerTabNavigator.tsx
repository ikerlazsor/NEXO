import { createNavigatorFactory, TabRouter, useNavigationBuilder } from '@react-navigation/native';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';

/**
 * Tabs horizontales con PagerView: al deslizar se ve la pantalla adyacente
 * (mismo comportamiento que el gesto atrás del stack).
 */
function PagerTabNavigator(props: Record<string, unknown>) {
    const {
        id,
        initialRouteName,
        backBehavior,
        children,
        layout,
        screenListeners,
        screenOptions,
        screenLayout,
        UNSTABLE_router,
    } = props as any;

    const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder(TabRouter, {
        id,
        initialRouteName,
        backBehavior,
        children,
        layout,
        screenListeners,
        screenOptions,
        screenLayout,
        UNSTABLE_router,
    });

    const pagerRef = useRef<PagerView>(null);
    const pageIndexRef = useRef(state.index);

    useEffect(() => {
        if (pageIndexRef.current === state.index) return;
        pageIndexRef.current = state.index;
        requestAnimationFrame(() => {
            pagerRef.current?.setPage(state.index);
        });
    }, [state.index]);

    return (
        <NavigationContent>
            <PagerView
                ref={pagerRef}
                style={styles.pager}
                initialPage={state.index}
                overdrag
                offscreenPageLimit={3}
                onPageSelected={(e) => {
                    const position = e.nativeEvent.position;
                    pageIndexRef.current = position;
                    const route = state.routes[position];
                    if (!route) return;
                    if (state.index !== position) {
                        navigation.navigate(route.name);
                    }
                }}
            >
                {state.routes.map((route: { key: string; name: string }) => (
                    <View key={route.key} collapsable={false} style={styles.page}>
                        {descriptors[route.key].render()}
                    </View>
                ))}
            </PagerView>
        </NavigationContent>
    );
}

const styles = StyleSheet.create({
    pager: { flex: 1 },
    page: { flex: 1 },
});

export function createPagerTabNavigator(config?: unknown) {
    return createNavigatorFactory(PagerTabNavigator)(config as never);
}
