import { Stack } from 'expo-router';

export default function TabLayout() {
    return (
        <Stack screenOptions={{ headerShown: false, freezeOnBlur: true }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="profile" />
            <Stack.Screen name="explore" />
        </Stack>
    );
}
