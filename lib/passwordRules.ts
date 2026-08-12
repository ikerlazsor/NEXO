/** Política de la app: longitud razonable y mezcla básica de caracteres. */
export function isStrongPassword(pass: string): boolean {
    return (
        pass.length >= 10 &&
        /[a-z]/.test(pass) &&
        /[A-Z]/.test(pass) &&
        /\d/.test(pass)
    );
}

export function isPasswordPolicyError(message: string): boolean {
    return /password|weak|at least|uppercase|lowercase|digit|character/i.test(message);
}
