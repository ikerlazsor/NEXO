import { Stack } from 'expo-router';

export default function ChatLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
                animation: 'slide_from_right',
                animationDuration: 260,
                contentStyle: { backgroundColor: '#F8FAFC' },
                gestureEnabled: true,
                fullScreenGestureEnabled: true,
                animationMatchesGesture: true,
            }}
        />
    );
}
