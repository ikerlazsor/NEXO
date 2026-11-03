import type { ProfilePlace } from './profilePlace';

type PlacePickListener = (place: ProfilePlace) => void;

let listener: PlacePickListener | null = null;

export function subscribePlacePick(fn: PlacePickListener): () => void {
    listener = fn;
    return () => {
        if (listener === fn) listener = null;
    };
}

export function publishPlacePick(place: ProfilePlace): void {
    listener?.(place);
}
