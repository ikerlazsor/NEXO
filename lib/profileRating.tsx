import { Ionicons } from '@expo/vector-icons';
import React from 'react';

export const STAR_COLOR = '#FFB800';
export const DEFAULT_RATING = 5;
export const DEFAULT_REVIEW_COUNT = 0;
export const DEFAULT_PLANS_DONE = 0;

export function renderRatingStars(scoreOutOf10: number, size = 14) {
    const scoreOutOf5 = scoreOutOf10 / 2;
    const stars = [];

    for (let i = 1; i <= 5; i++) {
        let name: 'star' | 'star-half' | 'star-outline' = 'star-outline';

        if (scoreOutOf5 >= i) {
            name = 'star';
        } else if (scoreOutOf5 > i - 1) {
            name = 'star-half';
        }

        stars.push(<Ionicons key={i} name={name} size={size} color={STAR_COLOR} />);
    }

    return stars;
}

export function formatRatingLabel(scoreOutOf10: number, reviewCount: number) {
    return `${scoreOutOf10.toFixed(1)}/10 · ${reviewCount} reseñas`;
}
