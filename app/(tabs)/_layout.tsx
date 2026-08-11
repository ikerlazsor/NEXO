import { withLayoutContext } from 'expo-router';
import { MainChrome } from '../../components/MainChrome';
import { createPagerTabNavigator } from '../../lib/createPagerTabNavigator';

const { Navigator } = createPagerTabNavigator();
const PagerTabs = withLayoutContext(Navigator);

/**
 * Orden del deslizamiento: chats → mis planes → feed → buscar.
 * PagerView enseña la pantalla de destino mientras deslizas.
 */
export default function TabLayout() {
    return (
        <MainChrome>
            <PagerTabs
                initialRouteName="index"
                screenOptions={{
                    swipeEnabled: true,
                    lazy: true,
                }}
            >
                <PagerTabs.Screen name="chats" />
                <PagerTabs.Screen name="my-plans" />
                <PagerTabs.Screen name="index" />
                <PagerTabs.Screen name="search-profiles" />
            </PagerTabs>
        </MainChrome>
    );
}
