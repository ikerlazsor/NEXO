import { createNavigatorFactory, TabRouter, useNavigationBuilder } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { subscribeMainTab } from './mainTab';
import { subscribeCreatePlanClosed } from './createPlanIntent';
import { TabPagerScrollProvider, useTabPagerScroll } from './tabPagerScroll';

/**
 * Tabs horizontales con PagerView: al deslizar se ve la pantalla adyacente
 * (mismo comportamiento que el gesto atrás del stack).
 * Crear plan solo desde la barra inferior.
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
    const { scrollEnabled } = useTabPagerScroll();
    const pagerWasLockedRef = useRef(false);
    const [holdPager, setHoldPager] = useState(false);

    useEffect(() => {
        if (pageIndexRef.current === state.index) return;
        pageIndexRef.current = state.index;
        requestAnimationFrame(() => {
            pagerRef.current?.setPage(state.index);
        });
    }, [state.index]);

    useEffect(() => {
        if (!scrollEnabled) {
            pagerWasLockedRef.current = true;
            return;
        }
        if (pagerWasLockedRef.current) {
            pagerWasLockedRef.current = false;
            requestAnimationFrame(() => {
                pagerRef.current?.setPageWithoutAnimation(state.index);
            });
        }
    }, [scrollEnabled, state.index]);

    useEffect(() => {
        return subscribeCreatePlanClosed(() => {
            setHoldPager(false);
            requestAnimationFrame(() => {
                pagerRef.current?.setPageWithoutAnimation(pageIndexRef.current);
            });
        });
    }, []);

    useEffect(() => {
        return subscribeMainTab((routeName) => {
            const index = state.routes.findIndex((route: { name: string }) => route.name === routeName);
            if (index < 0) return;
            if (state.index !== index) {
                navigation.navigate(routeName);
            }
            requestAnimationFrame(() => {
                pagerRef.current?.setPageWithoutAnimation(index);
            });
        });
    }, [navigation, state.index, state.routes]);

    return (
        <NavigationContent>
            <PagerView
                ref={pagerRef}
                style={styles.pager}
                initialPage={state.index}
                scrollEnabled={scrollEnabled && !holdPager}
                overdrag={false}
                offscreenPageLimit={1}
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
                {state.routes.map((route: { key: string; name: string }, index: number) => {
                    const isInMountWindow = Math.abs(index - state.index) <= 2;
                    return (
                        <View key={route.key} collapsable={false} style={styles.page}>
                            {isInMountWindow ? descriptors[route.key].render() : null}
                        </View>
                    );
                })}
            </PagerView>
        </NavigationContent>
    );
}

const styles = StyleSheet.create({
    pager: { flex: 1 },
    page: { flex: 1 },
});

function PagerTabNavigatorWithScrollLock(props: Record<string, unknown>) {
    return (
        <TabPagerScrollProvider>
            <PagerTabNavigator {...props} />
        </TabPagerScrollProvider>
    );
}

export function createPagerTabNavigator() {
    return createNavigatorFactory(PagerTabNavigatorWithScrollLock)();
}
