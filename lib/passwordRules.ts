/** Política de la app: mínimo 6 caracteres y al menos un número. */
export const PASSWORD_MIN_LENGTH = 6;

export function isStrongPassword(pass: string): boolean {
    return pass.length >= PASSWORD_MIN_LENGTH && /\d/.test(pass);
}

export function isPasswordPolicyError(message: string, code?: string): boolean {
    if (code === 'weak_password') return true;
    return (
        /password.*(weak|invalid|requirements|policy|at least|least|short|length|uppercase|lowercase|digit|number|symbol|pwned|breach|compromised|leaked|common)/i.test(
            message,
        ) || /weak.*password/i.test(message)
    );
}
