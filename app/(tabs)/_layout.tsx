import { Tabs } from 'expo-router';

export default function TabLayout() {
    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarStyle: { display: 'none' },
                freezeOnBlur: true,
            }}
        >
            <Tabs.Screen name="index" />
            <Tabs.Screen name="chats" />
            <Tabs.Screen name="my-plans" />
            <Tabs.Screen name="search-profiles" />
            <Tabs.Screen name="explore" options={{ href: null }} />
        </Tabs>
    );
}
