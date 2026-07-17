/** Re-export de categorías e imágenes de planes. */
export {
    MAIN_CATEGORIES,
    MAIN_CATEGORY_IDS,
    SUBCATEGORIES,
    FEED_PLAN_CATEGORIES,
    PLACEHOLDER_COVER,
    resolvePlanCategories,
    resolvePlanSport,
    getPlanCategoryDisplay,
    PLACEHOLDER_COVER_URI,
    getCoverImages,
    encodeCoverImageKey,
    resolvePlanImageSource,
    normalizeMainCategory,
    normalizeSubcategory,
    isMainCategoryId,
    MAIN_CATEGORY_ICONS,
    SUBCATEGORY_ICONS,
    type MainCategoryId,
} from './categories';

/** @deprecated Usar MainCategoryId */
export type MainCategory = import('./categories').MainCategoryId;
