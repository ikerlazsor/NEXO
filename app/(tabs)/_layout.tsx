import { Stack } from 'expo-router';

export default function TabLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                freezeOnBlur: true,
                animation: 'fade',
                animationDuration: 160,
            }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="explore" />
        </Stack>
    );
}
