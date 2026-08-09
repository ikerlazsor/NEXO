/** Reglas alineadas con la política típica de Supabase Auth (letras + mayúscula + número). */
export function isStrongPassword(pass: string): boolean {
    return (
        pass.length >= 6 &&
        /[a-z]/.test(pass) &&
        /[A-Z]/.test(pass) &&
        /\d/.test(pass)
    );
}

export function isPasswordPolicyError(message: string): boolean {
    return /password|weak|at least|uppercase|lowercase|digit|character/i.test(message);
}
