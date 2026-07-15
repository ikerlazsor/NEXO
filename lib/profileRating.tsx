import { Ionicons } from '@expo/vector-icons';
import React from 'react';

export const STAR_COLOR = '#FFB800';

/** Estrellas sobre 5 (escala de estadisticas_usuario.valoracion_media). */
export function renderRatingStars(scoreOutOf5: number, size = 14) {
    const stars = [];

    for (let i = 1; i <= 5; i++) {
        let name: 'star' | 'star-half' | 'star-outline' = 'star-outline';

        if (scoreOutOf5 >= i - 0.25) {
            name = 'star';
        } else if (scoreOutOf5 > i - 0.75) {
            name = 'star-half';
        }

        stars.push(<Ionicons key={i} name={name} size={size} color={STAR_COLOR} />);
    }

    return stars;
}

export function formatRatingLabel(scoreOutOf5: number, reviewCount: number) {
    return `${scoreOutOf5.toFixed(1)}/5 · ${reviewCount} reseñas`;
}
