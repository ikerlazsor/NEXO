import { Redirect } from 'expo-router';

/** Legacy route; redirige al feed. */
export default function ExploreScreen() {
    return <Redirect href="/" />;
}
