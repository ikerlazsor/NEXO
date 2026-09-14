import { withLayoutContext } from 'expo-router';
import { MainChrome } from '../../components/MainChrome';
import { createPagerTabNavigator } from '../../lib/createPagerTabNavigator';

const { Navigator } = createPagerTabNavigator();
const PagerTabs = withLayoutContext(Navigator);

/**
 * Orden del deslizamiento: planes → chats.
 * Buscar gente y Mis planes viven fuera del pager (stack).
 */
export default function TabLayout() {
    return (
        <MainChrome>
            <PagerTabs
                initialRouteName="index"
                screenOptions={{
                    swipeEnabled: true,
                    lazy: false,
                }}
            >
                <PagerTabs.Screen name="index" />
                <PagerTabs.Screen name="chats" />
            </PagerTabs>
        </MainChrome>
    );
}
