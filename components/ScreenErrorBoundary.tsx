import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useT } from '../lib/i18n';
import { useAppTheme } from '../lib/appTheme';

type Props = {
    children: ReactNode;
    /**
     * Si cambia mientras se muestra el error, la barrera se reinicia (p. ej. al
     * cambiar de pantalla). No usar como `key`: cambiar la key desmonta y vuelve a
     * montar todo lo que envuelve (la pila de navegación entera y el feed), y las
     * pantallas aparecen de golpe sin animación.
     */
    resetKey?: string;
};
type State = { failed: boolean };

class ScreenErrorBoundaryInner extends Component<
    Props & { fallback: (retry: () => void) => ReactNode },
    State
> {
    state: State = { failed: false };

    static getDerivedStateFromError(): State {
        return { failed: true };
    }

    componentDidUpdate(prev: Props) {
        if (this.state.failed && prev.resetKey !== this.props.resetKey) {
            this.setState({ failed: false });
        }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.warn('[ScreenErrorBoundary]', error.message, info.componentStack);
    }

    retry = () => {
        this.setState({ failed: false });
    };

    render() {
        if (this.state.failed) return this.props.fallback(this.retry);
        return this.props.children;
    }
}

function ErrorFallback({ onRetry }: { onRetry: () => void }) {
    const { t } = useT();
    const { colors } = useAppTheme();
    return (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: colors.backgroundAlt }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' }}>
                {t('screen.errorTitle')}
            </Text>
            <Text style={{ marginTop: 8, fontSize: 15, color: colors.textMuted, textAlign: 'center' }}>
                {t('screen.errorBody')}
            </Text>
            <TouchableOpacity
                onPress={onRetry}
                style={{
                    marginTop: 20,
                    backgroundColor: colors.primary,
                    paddingHorizontal: 22,
                    paddingVertical: 12,
                    borderRadius: 14,
                }}
            >
                <Text style={{ color: colors.onPrimary, fontWeight: '700' }}>{t('common.retry')}</Text>
            </TouchableOpacity>
        </View>
    );
}

/** Evita que un fallo de una pantalla tumbe toda la app. */
export function ScreenErrorBoundary({ children, resetKey }: Props) {
    return (
        <ScreenErrorBoundaryInner resetKey={resetKey} fallback={(retry) => <ErrorFallback onRetry={retry} />}>
            {children}
        </ScreenErrorBoundaryInner>
    );
}
