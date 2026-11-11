import { formatCurrency, setLanguage, t, applyTranslations } from './js/modules/currency-lang.js?v=20260913-sell-step1';
import { auth, db, googleProvider } from './firebase-config.js?v=20260802';
import { listCars as listCarsCached } from './js/modules/car-service.js?v=20260916-cache';
import { listParts as listPartsCached } from './js/modules/part-service.js?v=20260916-cache';
import {
    createUserWithEmailAndPassword,
    EmailAuthProvider,
    fetchSignInMethodsForEmail,
    onAuthStateChanged,
    reauthenticateWithCredential,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    updatePassword,
    updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteField,
    deleteDoc,
    documentId,
    doc,
    getDoc,
    getDocs,
    increment,
    onSnapshot,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

googleProvider.setCustomParameters({ prompt: 'select_account' });

const CLOUDINARY_CLOUD_NAME = 'p75aqzql';
const CLOUDINARY_UPLOAD_PRESET = 'hscar_uploads';
const CLOUDINARY_IMAGE_UPLOAD_URL = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

const AUSSTATTUNG_CATEGORIES = {
    'Komfort & Innenausstattung': ['Klimaanlage', 'Klimaautomatik', 'Sitzheizung', 'Navigationssystem', 'Tempomat', 'Multifunktionslenkrad', 'Elektr. Fensterheber', 'Panorama-Dach', 'Standheizung'],
    'Sicherheit & Assistenz': ['ABS', 'ESP', 'Isofix', 'Totwinkel-Assistent', 'Spurhalteassistent', 'Notbremsassistent', 'Verkehrszeichenerkennung'],
    'Unterhaltung & Media': ['Bluetooth', 'Freisprecheinrichtung', 'Apple CarPlay', 'Android Auto', 'Soundsystem', 'Radio/DAB'],
    'Exterieur & Licht': ['Leichtmetallfelgen', 'LED-Scheinwerfer', 'Xenonscheinwerfer', 'Kurvenlicht', 'Anhängerkupplung', 'Schiebedach']
};
const FEATURE_GROUP_ORDER = Object.keys(AUSSTATTUNG_CATEGORIES);
const FEATURE_TO_GROUP = Object.fromEntries(    
    FEATURE_GROUP_ORDER.flatMap(group => AUSSTATTUNG_CATEGORIES[group].map(feature => [feature, group]))
);

const STATUS_LABELS = {
    active: 'Aktiv',
    reserved: 'Reserviert',
    sold: 'Verkauft'
};
const STATUS_CLASSES = {
    active: 'status-active',
    reserved: 'status-reserved',
    sold: 'status-sold'
};

function localizedStatusLabel(status = 'active') {
    const normalizedStatus = String(status || 'active').trim().toLowerCase();
    const keys = { active: 'status_active', reserved: 'status_reserved', sold: 'status_sold' };
    return t(keys[normalizedStatus] || keys.active) || STATUS_LABELS[normalizedStatus] || STATUS_LABELS.active;
}

function statusBadgeOverlay(status = 'active') {
    const normalizedStatus = String(status || 'active').trim().toLowerCase();
    const configStatus = STATUS_LABELS[normalizedStatus] ? normalizedStatus : 'active';
    return `<span class="badge-status-overlay ${STATUS_CLASSES[configStatus] || STATUS_CLASSES.active}">${localizedStatusLabel(configStatus)}</span>`;
}

let currentSearchCars = [];
let allCarsCache = [];
let currentSearchSort = 'newest';
let currentFavoritesTab = 'cars';
let favoritesRenderSequence = 0;
let authStateResolved = false;
let currentSearchMode = 'cars';
let allPartsCache = [];
let partsCatalogFiltered = [];
let partsCatalogPage = 1;
let partSelectedFiles = [];
let currentPartsSort = 'newest';
let currentMyListingsTab = 'cars';
let currentMyListingsPage = 1;
let currentMyListingsSelectedCarId = '';
let currentMyListingsSelectedPartId = '';
let favoriteCarIdsCache = new Set();
let favoritePartIdsCache = new Set();
let currentUserProfileCache = null;
const publicSellerProfileCache = new Map();
const publicSellerProfileData = new Map();
const myListingsLoadPromises = new Map();
const PUBLIC_SELLER_PROFILE_CACHE_TTL_MS = 15 * 60 * 1000;
let priceDropRealtimeUnsubscribe = [];
let priceDropState = { cars: [], parts: [] };
let activePriceDropNotifications = [];
let notificationReadIds = new Set();
let notificationDeletedIds = new Set();
let notificationPage = 1;
const NOTIFICATION_PAGE_SIZE = 4;
let currentDetailOrigin = 'search';
const PARTS_PAGE_SIZE = 12;
const SELLER_CATALOG_PAGE_SIZE = 12;
let currentSellerCatalog = null;
const CAR_CATALOG_FILTER_KEYS = ['make', 'model', 'body', 'fuel', 'transmission', 'priceMin', 'priceMax', 'kmMin', 'kmMax', 'yearMin', 'yearMax', 'powerMin', 'powerMax', 'color', 'status', 'doors', 'seatsMin', 'seatsMax', 'sellerType', 'zip', 'dealerOwnerId', 'dealerName'];
const CAR_CATALOG_NUMERIC_FILTER_KEYS = new Set(['priceMin', 'priceMax', 'kmMin', 'kmMax', 'yearMin', 'yearMax', 'powerMin', 'powerMax', 'seatsMin', 'seatsMax']);

function readCachedPublicSellerProfile(ownerId) {
    const key = String(ownerId || '').trim();
    if (!key) return null;
    try {
        const raw = sessionStorage.getItem(`hs_seller_profile_${key}`) ||
            localStorage.getItem(`hs_seller_profile_${key}`);
        const cached = raw ? JSON.parse(raw) : null;
        if (!cached?.profile || Date.now() - Number(cached.updatedAt || 0) > PUBLIC_SELLER_PROFILE_CACHE_TTL_MS) {
            return null;
        }
        return cached.profile;
    } catch (error) {
        console.warn('Unable to read cached seller profile:', error);
        return null;
    }
}

function writeCachedPublicSellerProfile(ownerId, profile) {
    const key = String(ownerId || '').trim();
    if (!key || !profile || typeof profile !== 'object') return;
    const serialized = JSON.stringify({ profile, updatedAt: Date.now() });
    try {
        sessionStorage.setItem(`hs_seller_profile_${key}`, serialized);
    } catch (error) {
        console.warn('Unable to cache seller profile:', error);
    }
    try {
        localStorage.setItem(`hs_seller_profile_${key}`, serialized);
    } catch (error) {
        console.warn('Unable to write shared seller profile cache:', error);
    }
}

function getMyListingsRouteState(params = new URLSearchParams(window.location.search)) {
    const searchParams = params instanceof URLSearchParams ? params : new URLSearchParams(window.location.search);
    const typeParam = String(searchParams.get('type') || '').toLowerCase();
    const pageParam = Number.parseInt(searchParams.get('page') || '1', 10);
    return {
        tab: typeParam === 'car-parts' ? 'parts' : 'cars',
        page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1
    };
}

function buildMyListingsUrl(tab = currentMyListingsTab, page = currentMyListingsPage) {
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    url.searchParams.delete('partId');
    url.searchParams.delete('catalog');
    CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
    url.searchParams.delete('step');
    url.searchParams.set('view', 'my-listings');
    url.searchParams.set('type', tab === 'parts' ? 'car-parts' : 'cars');
    url.searchParams.set('page', String(Math.max(1, Number(page) || 1)));
    return url;
}

function syncMyListingsStateFromUrl() {
    const { tab, page } = getMyListingsRouteState(new URLSearchParams(window.location.search));
    currentMyListingsTab = tab;
    currentMyListingsPage = page;
}

function pushMyListingsHistory(tab = currentMyListingsTab, page = currentMyListingsPage, options = {}) {
    if (suppressHistoryRouting) return;
    pushBrowserUrl(buildMyListingsUrl(tab, page), { replace: options.replace !== false, state: options.state });
}
const fahrzeugDaten = {
    'Audi': { 'A1': [], 'A3': [], 'A4': [], 'A5': [], 'A6': [], 'A6 e-tron': [], 'A7': [], 'A8': [], 'e-tron': [], 'e-tron GT': [], 'e-tron S': [], 'Q2': [], 'Q3': [], 'Q4 e-tron': [], 'Q5': [], 'Q6 e-tron': [], 'Q7': [], 'Q8': [], 'Q8 e-tron': [], 'R8': [], 'RS e-tron GT': [], 'RS3': [], 'RS4': [], 'RS5': [], 'RS6': [], 'RS7': [], 'RSQ8': [], 'S3': [], 'S4': [], 'S5': [], 'S6': [], 'S7': [], 'S8': [], 'SQ5': [], 'SQ6 e-tron': [], 'SQ7': [], 'SQ8': [], 'SQ8 e-tron': [], 'TT': [], 'TTRS': [], 'TTS': [] },
    'BMW': { '1M': [], '1er-Serie': [], '2er-Serie': [], '3er-Serie': [], '4er-Serie': [], '5er-Serie': [], '6er-Serie': [], '7er-Serie': [], '8er-Serie': [], 'i3': [], 'i4': [], 'i5': [], 'i7': [], 'i8': [], 'iX': [], 'iX1': [], 'iX2': [], 'iX3': [], 'M2': [], 'M3': [], 'M4': [], 'M5': [], 'M6': [], 'M8': [], 'X1': [], 'X2': [], 'X3': [], 'X3 M': [], 'X4': [], 'X4 M': [], 'X5': [], 'X5 M': [], 'X6': [], 'X6 M': [], 'X7': [], 'XM': [], 'Z4': [], 'Gran Turismo / GT': [] },
    'Mercedes-Benz': { 'A-Class': [], 'AMG GT': [], 'B-Class': [], 'C-Class': [], 'CL-Class': [], 'CLA-Class': [], 'CLE-Class': [], 'CLK-Class': [], 'CLS-Class': [], 'E-Class': [], 'EQA': [], 'EQB': [], 'EQC': [], 'EQE': [], 'EQE SUV': [], 'EQS': [], 'EQS SUV': [], 'G-Class': [], 'GL-Class': [], 'GLA-Class': [], 'GLB-Class': [], 'GLC-Class': [], 'GLE-Class': [], 'GLK-Class': [], 'GLS-Class': [], 'M-Class': [], 'R-Class': [], 'S-Class': [], 'SL-Class': [], 'SLC-Class': [], 'SLK-Class': [], 'SLS AMG': [], 'V-Class': [] },
    'Volkswagen': { 'CC': [], 'Eos': [], 'ID.4': [], 'ID.5': [], 'Golf': [], 'Beetle': [], 'Scirocco': [], 'Arteon': [], 'Jetta': [], 'Touareg': [], 'Tiguan': [], 'T-Roc': [], 'Passat': [], 'Phaeton': [], 'Polo': [] },
    'Porsche': { '911': [], 'Macan': [], 'Boxster': [], 'Cayman': [], 'Cayenne': [], 'Taycan': [], 'Panamera': [] },
    'Jaguar': { 'E-Pace': [], 'F-Pace': [], 'F-Type': [], 'I-Pace': [], 'S-Type': [], 'X-Type': [], 'XE': [], 'XF': [], 'XJ': [] },
    'MINI': { 'Aceman': [], 'Countryman': [], 'Cooper': [], 'Cooper Roadster': [], 'Cooper Convertible': [], 'Cooper Coupe': [], 'Clubman': [], 'Paceman': [] },
    'Volvo': { 'C30': [], 'C40': [], 'C70': [], 'EX30': [], 'EX40': [], 'S40': [], 'S60': [], 'S80': [], 'S90': [], 'V40': [], 'V50': [], 'V60': [], 'V90': [], 'XC40': [], 'XC60': [], 'XC70': [], 'XC90': [] },
    'Hyundai': { 'i30': [], 'i40': [], 'ST1': [], 'Galloper': [], 'Grandeur': [], 'Grace': [], 'Nexo': [], 'Maxcruz': [], 'Venue': [], 'Veracruz': [], 'Verna': [], 'Veloster': [], 'Starex': [], 'Staria': [], 'Santa Fe': [], 'Sonata': [], 'Solati': [], 'Avante / Elantra': [], 'Aslan': [], 'Ioniq': [], 'Ioniq 5': [], 'Ioniq 6': [], 'Ioniq 9': [], 'Equus': [], 'Accent': [], 'Genesis': [], 'Genesis Coupe': [], 'Casper': [], 'Casper Electric': [], 'Kona': [], 'Click': [], 'Terracan': [], 'Tuscani': [], 'Tucson': [], 'Trajet XG': [], 'Tiburon': [], 'Palisade': [], 'Porter': [] },
    'Kia': { 'EV3': [], 'EV4': [], 'EV5': [], 'EV6': [], 'EV9': [], 'K3': [], 'K5': [], 'K7': [], 'K8': [], 'K9': [], 'PV5': [], 'X-TREK': [], 'Niro': [], 'Ray': [], 'Lotze': [], 'Regal': [], 'Morning': [], 'Mohave': [], 'Bongo': [], 'Seltos': [], 'Stonic': [], 'Stinger': [], 'Spectra': [], 'Sportage': [], 'Cerato': [], 'Sorento': [], 'Soul': [], 'Opirus': [], 'Optima': [], 'Carnival': [], 'Carens': [], 'Carstar': [], 'Tasman': [], 'Forte': [], 'Pride': [] },
    'Genesis': { 'G70': [], 'G80': [], 'G90': [], 'GV60': [], 'GV70': [], 'GV80': [] },
    'Chevrolet': { 'Malibu': [], 'Volt': [], 'Volt EUV': [], 'Blazer': [], 'Spark': [], 'Aveo': [], 'Alpheon': [], 'Orlando': [], 'Equinox': [], 'Express Van': [], 'Impala': [], 'Camaro': [], 'Captiva': [], 'Colorado': [], 'Cruze': [], 'Traverse': [], 'Trax': [], 'Trailblazer': [] },
    'Ford': { 'F150': [], 'Mustang': [], 'Mondeo': [], 'Bronco': [], 'Escape': [], 'Explorer': [], 'Kuga': [], 'Taurus': [], 'Focus': [], 'Fusion': [] },
    'Toyota': { '86': [], 'bB': [], 'FJ Cruiser': [], 'RAV4': [], 'Supra': [], 'Sienna': [], 'Avalon': [], 'Camry': [], 'Corolla': [], 'Crown': [], 'Tundra': [], 'Prius': [], 'Highlander': [] },
    'Lexus': { 'CT': [], 'ES': [], 'GS': [], 'IS': [], 'LC': [], 'LM': [], 'LS': [], 'LX': [], 'NX': [], 'RC': [], 'RX': [], 'RZ': [], 'SC': [], 'UX': [] },
    'Honda': { 'CR-V': [], 'CR-Z': [], 'HR-V': [], 'N-BOX': [], 'N-ONE': [], 'S660': [], 'Legend': [], 'Civic': [], 'Accord': [], 'Odyssey': [], 'Insight': [], 'Pilot': [] },
    'Nissan': { '350Z': [], '370Z': [], 'GT-R': [], 'Rogue': [], 'Leaf': [], 'March': [], 'Maxima': [], 'Murano': [], 'Altima': [], 'X-Trail': [], 'Juke': [], 'Qashqai': [], 'Cube': [] },
    'Infiniti': { 'EX': [], 'FX': [], 'G': [], 'JX': [], 'M': [], 'Q30': [], 'Q50': [], 'Q60': [], 'Q70': [], 'QX30': [], 'QX50': [], 'QX60': [], 'QX70': [], 'QX80': [] },
    'Tesla': { 'Model 3': [], 'Model S': [], 'Model X': [], 'Model Y': [], 'Cybertruck': [] },
    'Jeep': { 'Grand Cherokee': [], 'Gladiator': [], 'Wrangler': [], 'Renegade': [], 'Avenger': [], 'Cherokee': [], 'Compass': [] },
    'Cadillac': { 'ATS': [], 'CT4': [], 'CT5': [], 'CT6': [], 'CTS': [], 'DTS': [], 'SRX': [], 'STS': [], 'XT4': [], 'XT5': [], 'XT6': [], 'Lyriq': [], 'Escalade': [] },
    'Renault': { 'QM3': [], 'QM5': [], 'QM6': [], 'SM3': [], 'SM5': [], 'SM6': [], 'SM7': [], 'XM3': [], 'Grand Koleos': [], 'Master': [], 'Scenic': [], 'Arkana': [], 'Zoe': [], 'Captur': [], 'Clio': [], 'Twizy': [], 'Filante': [] },
    'Peugeot': { '2008': [], '206': [], '207': [], '208': [], '3008': [], '307': [], '308': [], '407': [], '408': [], '5008': [], '508': [] },
    'Opel': { 'Vectra': [], 'Vita': [], 'Speedster': [], 'Astra': [], 'Corsa': [], 'Tigra': [] },
    'Dodge': { 'Dakota': [], 'Ram Pickup': [], 'Challenger': [], 'Caliber': [] },
    'Chrysler': { '200': [], '300C': [], 'PT Cruiser': [], 'Grand Voyager': [], 'Sebring': [], 'Pacifica': [] },
    'Aston Martin': { 'DB12': [], 'DB9': [], 'DBX': [], 'Rapide': [], 'Vantage': [] },
    'Lotus': { 'Emira': [], 'Exige': [], 'Eletre': [], 'Emeya': [], 'Evora': [], 'Elise': [], '2-Eleven': [], 'Esprit': [], 'Europa': [], 'Others': [] },
    'McLaren': { '570S': [], '650S': [], '720S': [], '765LT': [], 'MP4-12C': [], 'Artura': [] },
    'Lamborghini': { 'Gallardo': [], 'Murciélago': [], 'Aventador': [], 'Huracán': [], 'Urus': [] },
    'Rolls-Royce': { 'Ghost': [], 'Cullinan': [], 'Wraith': [], 'Phantom': [], 'Spectre': [], 'Dawn': [], 'Silver Spur': [], 'Corniche': [] },
    'Maybach': { '62': [], '57': [], '62s': [], '57s': [], '57 Zeppelin': [], '62 Zeppelin': [], '62s Landaulet': [] },
    'Bugatti': { 'Veyron 16.4': [], 'EB110': [] }
};
const MAKES_MODELS = Object.fromEntries(
    Object.entries(fahrzeugDaten).map(([brand, modelMap]) => [brand, Object.keys(modelMap)])
);
const STANDARD_BRANDS = Object.keys(MAKES_MODELS);
const VEHICLE_COLOR_OPTIONS = [
    'Weiß', 'Schwarz', 'Grau', 'Silber', 'Anthrazit', 'Dunkelblau', 'Rot', 'Beige', 'Blau',
    'Champagner', 'Braun', 'Grün', 'Gelb', 'Orange', 'Bordeauxrot', 'Graphitgrau', 'Bisonbraun',
    'Nachtblau', 'Bronze', 'Elfenbein', 'Sandbeige', 'Asphaltgrau', 'Titan-Grau', 'Petrolblau',
    'Kupfer', 'Olivgrün', 'Koralle', 'Gold', 'Matt-Schwarz', 'Matt-Grau'
];
const VEHICLE_COLOR_TRANSLATION_KEYS = [
    'sell_color_white', 'sell_color_black', 'sell_color_gray', 'sell_color_silver', 'sell_color_anthracite',
    'sell_color_dark_blue', 'sell_color_red', 'sell_color_beige', 'sell_color_blue', 'sell_color_champagne',
    'sell_color_brown', 'sell_color_green', 'sell_color_yellow', 'sell_color_orange', 'sell_color_burgundy',
    'sell_color_graphite_gray', 'sell_color_bison_brown', 'sell_color_night_blue', 'sell_color_bronze',
    'sell_color_ivory', 'sell_color_sand_beige', 'sell_color_asphalt_gray', 'sell_color_titanium_gray',
    'sell_color_petrol_blue', 'sell_color_copper', 'sell_color_olive_green', 'sell_color_coral',
    'sell_color_gold', 'sell_color_matt_black', 'sell_color_matt_gray'
];
window.fahrzeugDaten = fahrzeugDaten;
window.MAKES_MODELS = MAKES_MODELS;
const LANGUAGE_META = {
    de: { flag: 'lang_logos/de.svg', alt: 'German flag', code: 'DE' },
    en: { flag: 'lang_logos/gb.webp', alt: 'English flag', code: 'EN' },
    ru: { flag: 'lang_logos/ru.webp', alt: 'Russian flag', code: 'RU' },
    tr: { flag: 'lang_logos/tr.webp', alt: 'Turkish flag', code: 'TR' },
    pl: { flag: 'lang_logos/pl.webp', alt: 'Polish flag', code: 'PL' },
    fr: { flag: 'lang_logos/fr.webp', alt: 'French flag', code: 'FR' },
    it: { flag: 'lang_logos/it.svg', alt: 'Italian flag', code: 'IT' },
    nl: { flag: 'lang_logos/nl.svg', alt: 'Dutch flag', code: 'NL' }
};
const SELL_WIZARD_TOTAL_STEPS = 6;
const SELL_WIZARD_MAX_IMAGES = 20;
const SELL_WIZARD_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SELL_WIZARD_PHONE_REGEX = /^\+?[0-9\s()./-]{7,20}$/;
const SELL_WIZARD_DIAGRAM_LABELS = {
    inspection1: 'Exterieur / Karosserie',
    inspection2: 'Innenraum / Unterboden'
};
const SELL_WIZARD_DAMAGE_TYPES = [
    { label: 'Austausch / Wechsel', colorCode: '#dc2626' },
    { label: 'Blechschaden / Schweißen', colorCode: '#2563eb' },
    { label: 'Korrosion / Rost', colorCode: '#f59e0b' },
    { label: 'Kratzer', colorCode: '#16a34a' },
    { label: 'Dellen / Unebenheit', colorCode: '#9333ea' },
    { label: 'Beschädigung', colorCode: '#374151' }
];
const DAMAGE_TYPE_KEYS = {
    'Austausch / Wechsel': 'damage_replacement',
    'Blechschaden / Schweißen': 'damage_bodywork',
    'Korrosion / Rost': 'damage_corrosion',
    Kratzer: 'damage_scratch',
    'Dellen / Unebenheit': 'damage_dent',
    Beschädigung: 'damage_other'
};
function localizedDamageType(label) {
    const key = DAMAGE_TYPE_KEYS[label];
    return key ? tr(key, label) : label;
}
const ZUSTANDSBERICHT_TEXT_FELDER = [
    'zb-fahrzeugbezeichnung', 'zb-erstzulassungsdatum', 'zb-modelljahr', 'zb-kennzeichen', 'zb-hu-von', 'zb-hu-bis',
    'zb-fahrgestellnummer', 'zb-eigner-schaden', 'zb-historie-hinweise', 'zb-kilometerstand-messung', 'zb-tatsaechlicher-kilometerstand', 'zb-fahrgestellnummer-zustand',
    'zb-abgas-co', 'zb-abgas-hc', 'zb-tuning-umbauten', 'zb-sondernutzung-historie', 'zb-farbe-lackierung',
    'zb-wichtigste-ausstattung', 'zb-rueckrufaktion', 'zb-motor-laufverhalten', 'zb-oelleckage-zylinderkopfdeckel',
    'zb-oelleckage-zylinderkopfdichtung', 'zb-oelleckage-oelwanne', 'zb-motoroelstand-oeldruck', 'zb-kuehlmittelleckage-zylinderkopf',
    'zb-kuehlmittelleckage-radiator', 'zb-kuehlmittelleckage-wasserpumpe', 'zb-kuehlmittelstand', 'zb-automatik-oelleckage',
    'zb-automatik-oelstand-zustand', 'zb-schaltfunktion-kupplungsdruck', 'zb-schaltgetriebe-oelleckage',
    'zb-kupplungsscheibe-druckplatte', 'zb-antriebswelle-cv-gelenke', 'zb-radlager-achsschenkel', 'zb-differenzialgetriebe',
    'zb-lenkgetriebe-oelleckage', 'zb-lenkgetriebe-spurstangenkoepfe', 'zb-servopumpe-antriebsriemen',
    'zb-achsmanschetten-kugelgelenke', 'zb-hauptbremszylinder-leckage', 'zb-bremsfluessigkeit', 'zb-bremsverstaerker-unterdruck',
    'zb-lichtmaschine-generator', 'zb-anlasser-startermotor', 'zb-scheibenwischermotor', 'zb-geblaesemotor-lueftung',
    'zb-kuehlventilator-radiatorluefter', 'zb-elektrische-fensterheber', 'zb-kraftstoffleitung-dichtigkeit',
    'zb-gutachter-bemerkungen', 'zb-pruefer', 'zb-pruefdatum'
];
const ZUSTANDSBERICHT_RADIO_GRUPPEN = ['zb-kraftstoffart', 'zb-getriebeart', 'zb-garantietyp', 'zb-unfallhistorie', 'zb-karosseriereparatur', 'zb-rahmenreparatur'];
const ZUSTANDSBERICHT_DETAIL_SEKTIONEN = [
    {
        titel: 'Grundlegende Fahrzeuginformationen',
        zeilen: [
            ['Amtliches Kennzeichen', 'zb-kennzeichen'],
            ['HU / TÜV Gültigkeit von', 'zb-hu-von'],
            ['HU / TÜV Gültigkeit bis', 'zb-hu-bis'],
            ['Garantie-Typ', 'zb-garantietyp'],
            ['Eigener Schadensaufwand', 'zb-eigner-schaden'],
            ['Besondere Hinweise / Nutzungshistorie', 'zb-historie-hinweise']
        ]
    },
    {
        titel: 'Allgemeiner Fahrzeugzustand',
        zeilen: [
            ['Kilometerstand-Messung', 'zb-kilometerstand-messung'],
            ['Tatsächlicher Kilometerstand', 'zb-tatsaechlicher-kilometerstand'],
            ['Fahrgestellnummer-Zustand', 'zb-fahrgestellnummer-zustand'],
            ['Abgasemissionen CO (%)', 'zb-abgas-co'],
            ['Abgasemissionen HC (ppm)', 'zb-abgas-hc'],
            ['Tuning / Umbauten', 'zb-tuning-umbauten'],
            ['Sondernutzung / Historie', 'zb-sondernutzung-historie'],
            ['Farbe & Lackierung', 'zb-farbe-lackierung'],
            ['Wichtigste Ausstattung', 'zb-wichtigste-ausstattung'],
            ['Rückrufaktion (Recall)', 'zb-rueckrufaktion']
        ]
    },
    {
        titel: 'Unfall- & Karosseriehistorie',
        zeilen: [
            ['Unfallhistorie', 'zb-unfallhistorie'],
            ['Karosseriereparatur / Austausch', 'zb-karosseriereparatur'],
            ['Strukturelle Rahmenreparatur', 'zb-rahmenreparatur']
        ]
    },
    {
        titel: 'Detaillierter Zustandsbericht der Baugruppen',
        gruppen: [
            {
                titel: 'Motor',
                zeilen: [
                    ['Laufverhalten & Leerlauf', 'zb-motor-laufverhalten'],
                    ['Ölleckage Zylinderkopfdeckel', 'zb-oelleckage-zylinderkopfdeckel'],
                    ['Ölleckage Zylinderkopfdichtung', 'zb-oelleckage-zylinderkopfdichtung'],
                    ['Ölleckage Ölwanne', 'zb-oelleckage-oelwanne'],
                    ['Motorölstand & Öldruck', 'zb-motoroelstand-oeldruck'],
                    ['Kühlmittelleckage Zylinderkopf', 'zb-kuehlmittelleckage-zylinderkopf'],
                    ['Kühlmittelleckage Radiator', 'zb-kuehlmittelleckage-radiator'],
                    ['Kühlmittelleckage Wasserpumpe', 'zb-kuehlmittelleckage-wasserpumpe'],
                    ['Kühlmittelstand', 'zb-kuehlmittelstand']
                ]
            },
            {
                titel: 'Kraftübertragung & Getriebe',
                zeilen: [
                    ['Automatikgetriebe Ölleckage', 'zb-automatik-oelleckage'],
                    ['Ölstand & Zustandsprüfung', 'zb-automatik-oelstand-zustand'],
                    ['Schaltfunktion & Kupplungsdruck', 'zb-schaltfunktion-kupplungsdruck'],
                    ['Schaltgetriebe Ölleckage', 'zb-schaltgetriebe-oelleckage']
                ]
            },
            {
                titel: 'Kraftübertragungssystem',
                zeilen: [
                    ['Kupplungsscheibe & Druckplatte', 'zb-kupplungsscheibe-druckplatte'],
                    ['Antriebswelle & CV-Gelenke', 'zb-antriebswelle-cv-gelenke'],
                    ['Radlager & Achsschenkel', 'zb-radlager-achsschenkel'],
                    ['Differenzialgetriebe', 'zb-differenzialgetriebe']
                ]
            },
            {
                titel: 'Lenkung & Fahrwerk',
                zeilen: [
                    ['Lenkgetriebe Ölleckage', 'zb-lenkgetriebe-oelleckage'],
                    ['Lenkgetriebe & Spurstangenköpfe', 'zb-lenkgetriebe-spurstangenkoepfe'],
                    ['Servopumpe & Antriebsriemen', 'zb-servopumpe-antriebsriemen'],
                    ['Achsmanschetten & Kugelgelenke', 'zb-achsmanschetten-kugelgelenke']
                ]
            },
            {
                titel: 'Bremsanlage',
                zeilen: [
                    ['Hauptbremszylinder Leckage', 'zb-hauptbremszylinder-leckage'],
                    ['Bremsflüssigkeitsstand & Qualität', 'zb-bremsfluessigkeit'],
                    ['Bremsverstärker & Unterdrucksystem', 'zb-bremsverstaerker-unterdruck']
                ]
            },
            {
                titel: 'Elektrik & Bordsysteme',
                zeilen: [
                    ['Lichtmaschine / Generator', 'zb-lichtmaschine-generator'],
                    ['Anlasser / Startermotor', 'zb-anlasser-startermotor'],
                    ['Scheibenwischermotor', 'zb-scheibenwischermotor'],
                    ['Gebläsemotor / Lüftungsanlage', 'zb-geblaesemotor-lueftung'],
                    ['Kühlventilator / Radiatorlüfter', 'zb-kuehlventilator-radiatorluefter'],
                    ['Elektrische Fensterheber', 'zb-elektrische-fensterheber']
                ]
            },
            {
                titel: 'Kraftstoffsystem',
                zeilen: [
                    ['Kraftstoffleitung / Dichtigkeit', 'zb-kraftstoffleitung-dichtigkeit']
                ]
            }
        ]
    },
    {
        titel: 'Gutachter-Bemerkungen & Prüfvermerk',
        zeilen: [
            ['Gutachter-Bemerkungen', 'zb-gutachter-bemerkungen'],
            ['Prüfer', 'zb-pruefer'],
            ['Prüfdatum', 'zb-pruefdatum']
        ]
    }
];
let currentSellWizardStep = 1;
let maxReachedSellWizardStep = 1;
let sellWizardPinIdCounter = 0;
let suppressHistoryRouting = false;
let rawShowPageFn = null;
const formData = createDefaultSellFormData();

const APP_I18N = {
    de: { favLoadFail: 'Favoriten konnten nicht geladen werden', noFavorites: 'Noch keine Favoriten', signInToSave: 'Bitte melden Sie sich an, um Favoriten zu speichern.', partsNone: 'Keine Teile gefunden', searchFailed: 'Suche fehlgeschlagen.', listingSaved: 'Ihr Inserat wurde veröffentlicht.', settingsSaved: 'Einstellungen gespeichert.', priceAlertOn: 'Preisalarm aktiviert.' },
    en: { favLoadFail: 'Favorites could not be loaded', noFavorites: 'No favorites yet', signInToSave: 'Please sign in to save favorites.', partsNone: 'No parts found', searchFailed: 'Search failed.', listingSaved: 'Listing published successfully.', settingsSaved: 'Settings saved.', priceAlertOn: 'Price alert enabled.' },
    ru: { favLoadFail: 'Не удалось загрузить избранное', noFavorites: 'Пока нет избранного', signInToSave: 'Войдите, чтобы сохранять избранное.', partsNone: 'Запчасти не найдены', searchFailed: 'Ошибка поиска.', listingSaved: 'Объявление успешно опубликовано.', settingsSaved: 'Настройки сохранены.', priceAlertOn: 'Оповещение о цене включено.' },
    tr: { favLoadFail: 'Favoriler yüklenemedi', noFavorites: 'Henüz favori yok', signInToSave: 'Favori kaydetmek için giriş yapın.', partsNone: 'Parça bulunamadı', searchFailed: 'Arama başarısız.', listingSaved: 'İlan yayınlandı.', settingsSaved: 'Ayarlar kaydedildi.', priceAlertOn: 'Fiyat alarmı etkinleştirildi.' },
    pl: { favLoadFail: 'Nie udało się załadować ulubionych', noFavorites: 'Brak ulubionych', signInToSave: 'Zaloguj się, aby zapisywać ulubione.', partsNone: 'Nie znaleziono części', searchFailed: 'Wyszukiwanie nie powiodło się.', listingSaved: 'Ogłoszenie opublikowane.', settingsSaved: 'Ustawienia zapisane.', priceAlertOn: 'Alarm cenowy włączony.' },
    fr: { favLoadFail: 'Impossible de charger les favoris', noFavorites: 'Aucun favori pour le moment', signInToSave: 'Connectez-vous pour enregistrer des favoris.', partsNone: 'Aucune pièce trouvée', searchFailed: 'La recherche a échoué.', listingSaved: 'Annonce publiée.', settingsSaved: 'Paramètres enregistrés.', priceAlertOn: 'Alerte de prix activée.' },
    it: { favLoadFail: 'Impossibile caricare i preferiti', noFavorites: 'Nessun preferito', signInToSave: 'Accedi per salvare i preferiti.', partsNone: 'Nessun ricambio trovato', searchFailed: 'Ricerca non riuscita.', listingSaved: 'Annuncio pubblicato.', settingsSaved: 'Impostazioni salvate.', priceAlertOn: 'Avviso prezzo attivato.' },
    nl: { favLoadFail: 'Favorieten konden niet worden geladen', noFavorites: 'Nog geen favorieten', signInToSave: 'Meld je aan om favorieten op te slaan.', partsNone: 'Geen onderdelen gevonden', searchFailed: 'Zoeken mislukt.', listingSaved: 'Advertentie gepubliceerd.', settingsSaved: 'Instellingen opgeslagen.', priceAlertOn: 'Prijsalarm geactiveerd.' }
};

function ready(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback, { once: true });
        return;
    }
    callback();
}

function cleanupTransientUi() {
    document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.nav-user-wrap.open').forEach(el => el.classList.remove('open'));
    document.querySelectorAll('.nav-dropdown, .lang-dropdown, .nav-user-dropdown').forEach(el => {
        el.style.display = 'none';
        window.setTimeout(() => {
            if (el && el.isConnected) el.style.display = '';
        }, 0);
    });
    document.querySelectorAll('.thumb-overlay.active, .equipment-overlay.active, .filter-popover.active').forEach(el => {
        el.classList.remove('active');
    });
    if (typeof window.closeNavDropdown === 'function') {
        window.closeNavDropdown();
    }
}

const DARK_MODE_STORAGE_KEY = 'hs_dark_mode';

function isDarkModeEnabled() {
    const saved = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    if (saved === null) return false;
    return saved === '1' || saved === 'true';
}

function syncDarkModeState(isEnabled) {
    const enabled = Boolean(isEnabled);
    document.body.classList.toggle('dark-mode', enabled);
    const settingsToggle = document.getElementById('dark-mode-setting');
    const floatingToggle = document.getElementById('floating-dark-toggle');
    if (settingsToggle) settingsToggle.checked = enabled;
    if (floatingToggle) floatingToggle.checked = enabled;
    localStorage.setItem(DARK_MODE_STORAGE_KEY, enabled ? '1' : '0');
}

function syncFloatingDetailNav() {
    const params = new URLSearchParams(window.location.search);
    const isTargetPage = (params.get('view') === 'car-detail' && Boolean(params.get('id'))) || (params.get('view') === 'sell' && params.get('step') === '1');
    const widget = document.getElementById('floating-detail-nav');

    if (!isTargetPage) {
        if (widget) widget.remove();
        return;
    }

    if (widget) {
        const floatingToggle = document.getElementById('floating-dark-toggle');
        if (floatingToggle) floatingToggle.checked = isDarkModeEnabled();
        return;
    }

    const nav = document.createElement('div');
    nav.id = 'floating-detail-nav';
    nav.className = 'floating-detail-nav';
    nav.innerHTML = `
        <button type="button" class="floating-nav-btn floating-nav-up" data-nav-action="up" aria-label="Nach oben">↑</button>
        <label class="floating-nav-toggle-wrap" aria-label="Dark Mode toggle">
            <input id="floating-dark-toggle" type="checkbox" class="floating-nav-toggle" ${isDarkModeEnabled() ? 'checked' : ''}>
            <span class="floating-nav-toggle-circle"><span class="floating-nav-toggle-icon">☾</span></span>
        </label>
        <button type="button" class="floating-nav-btn floating-nav-down" data-nav-action="down" aria-label="Nach unten">↓</button>
    `;

    nav.querySelector('[data-nav-action="up"]').addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    nav.querySelector('[data-nav-action="down"]').addEventListener('click', () => {
        const target = document.body.scrollHeight || document.documentElement.scrollHeight;
        window.scrollTo({ top: target, behavior: 'smooth' });
    });
    nav.querySelector('#floating-dark-toggle').addEventListener('change', event => {
        syncDarkModeState(Boolean(event.target.checked));
    });

    document.body.appendChild(nav);
    const settingsToggle = document.getElementById('dark-mode-setting');
    if (settingsToggle) settingsToggle.checked = isDarkModeEnabled();
}

function initDarkModeControls() {
    const settingsToggle = document.getElementById('dark-mode-setting');
    if (settingsToggle) {
        settingsToggle.checked = isDarkModeEnabled();
        settingsToggle.addEventListener('change', event => {
            syncDarkModeState(Boolean(event.target.checked));
        });
    }
    syncDarkModeState(isDarkModeEnabled());
    syncFloatingDetailNav();
}

function scrollToTopImmediately() {
    try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    } catch (error) {
        window.scrollTo(0, 0);
    }
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
}

function sanitizeHeaderActionLabels() {
    document.querySelectorAll('.header-action-btn, .section-link').forEach(el => {
        const cleaned = String(el.textContent || '').replace(/[→←]/g, '').replace(/\s+/g, ' ').trim();
        if (cleaned && cleaned !== el.textContent) {
            el.textContent = cleaned;
        }
    });
}

async function compressAvatarFile(file) {
    const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Avatar file could not be read.'));
        reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Avatar image could not be loaded.'));
        img.src = dataUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Canvas context unavailable for avatar compression.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 400);
    const scale = Math.min(400 / image.width, 400 / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const dx = (400 - drawWidth) / 2;
    const dy = (400 - drawHeight) / 2;
    ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
    return canvas.toDataURL('image/jpeg', 0.72);
}

function normalizeAvatarUrl(value) {
    const avatarUrl = String(value || '').trim();
    return avatarUrl.replace(
        /^user_logo\/(user_default|man_01|woman_01)\.(?:png|jpe?g)$/i,
        'user_logo/$1.webp'
    );
}

async function loadCurrentUserProfile(user = auth.currentUser) {
    if (!user) {
        currentUserProfileCache = null;
        return null;
    }
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const resolvedAvatarUrl = normalizeAvatarUrl(userData.avatarUrl || userData.photoURL || userData.avatar || user.photoURL);
        currentUserProfileCache = {
            ...userData,
            avatarUrl: resolvedAvatarUrl || 'user_logo/user_default.webp',
            photoURL: resolvedAvatarUrl || '',
            avatar: resolvedAvatarUrl || ''
        };
    } catch (error) {
        console.error('loadCurrentUserProfile failed:', error);
        currentUserProfileCache = {
            ...(currentUserProfileCache || {}),
            avatarUrl: normalizeAvatarUrl(currentUserProfileCache?.avatarUrl || currentUserProfileCache?.photoURL || currentUserProfileCache?.avatar || user.photoURL) || 'user_logo/user_default.webp'
        };
    }
    return currentUserProfileCache;
}

function hasCompleteSellerProfile(profile = currentUserProfileCache) {
    return Boolean(String(profile?.address || '').trim() && String(profile?.description || '').trim());
}

function syncPasswordSettingsState(user = auth.currentUser) {
    const isGoogleOnly = Boolean(user?.providerData?.some(provider => provider.providerId === 'google.com'));
    const controls = ['set-current-pw', 'set-newpw', 'set-confpw'];
    controls.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = isGoogleOnly;
        el.style.opacity = isGoogleOnly ? '0.5' : '';
        el.style.cursor = isGoogleOnly ? 'not-allowed' : '';
    });
    const note = document.getElementById('settings-google-note');
    if (note) note.style.display = isGoogleOnly ? 'block' : 'none';
}

function setAvatarSelectionState(avatarUrl) {
    const normalizedAvatarUrl = normalizeAvatarUrl(avatarUrl) || 'user_logo/user_default.webp';
    const hidden = document.getElementById('set-avatar-url');
    if (hidden) hidden.value = normalizedAvatarUrl;
    document.querySelectorAll('[data-avatar-option]').forEach(option => {
        option.classList.toggle('active', option.getAttribute('data-avatar-option') === normalizedAvatarUrl);
    });
    const preview = document.getElementById('settings-avatar-preview');
    if (preview) preview.src = normalizedAvatarUrl;
}

function getResolvedAvatarUrl(profile = {}, fallbackUser = auth.currentUser) {
    return normalizeAvatarUrl(profile?.avatarUrl || profile?.photoURL || profile?.avatar || fallbackUser?.photoURL) || 'user_logo/user_default.webp';
}

function renderSellerInfoCard(containerId, config = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const ownerId = String(config.ownerId || '').trim();
    const sellerName = String(config.sellerName || tr('route_seller', 'Verkäufer')).trim() || tr('route_seller', 'Verkäufer');
    const sellerEmail = String(config.email || '—').trim() || '—';
    const sellerPhone = String(config.phone || '').trim();
    const sellerAddress = String(config.address || tr('address_not_available', 'Adresse nicht hinterlegt')).trim() || tr('address_not_available', 'Adresse nicht hinterlegt');
    const avatarUrl = getResolvedAvatarUrl(config.profile || {}, null);
    const activeCount = Number(config.activeCount || 0);
    const soldCount = Number(config.soldCount || 0);
    const moreLabel = ownerId ? `${tr('seller_all_listings', 'Alle Inserate des Händlers')}<img src="etc_logos/sell_page_logos/arrow-right.svg" alt="" style="width: 20px; height: 20px; vertical-align: middle; margin-left: -2px;">` : '';
    const moreHref = ownerId ? `?view=seller-profile&ownerId=${encodeURIComponent(ownerId)}` : '';
    container.innerHTML = `
        <div class="seller-info-card-title">${tr('seller_info_title', 'Verkäuferinformationen')}</div>
        <div class="seller-info-card-header">
            <img class="seller-info-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(sellerName)}">
            <div class="seller-info-name">${escapeHtml(sellerName)}</div>
        </div>
        <div class="seller-info-meta">
            <div class="seller-info-line"><strong>${tr('seller_active', 'Aktiv')}:</strong> ${formatNumber(activeCount)} · <strong>${tr('seller_sold', 'Verkauft')}:</strong> ${formatNumber(soldCount)}</div>
            <div class="seller-info-line">${escapeHtml(sellerAddress)}</div>
            <div class="seller-info-line">${escapeHtml(sellerEmail)}${sellerPhone ? ` · ${escapeHtml(sellerPhone)}` : ''}</div>
        </div>
        ${ownerId ? `<a href="${escapeHtml(moreHref)}" class="seller-more-link" data-owner-id="${escapeHtml(ownerId)}">${moreLabel}</a>` : ''}
    `;
}

function bindSellerInfoCardLink(containerId, ownerId) {
    // Native anchor navigation is used for seller profile links; keep this as a no-op so browser default behavior remains intact
    return;
}

function configureDetailPhoneAction(element, rawPhone, { requiresAuth = false } = {}) {
    if (!element) return;
    const phone = String(rawPhone || '').trim();
    const telPhone = phone.replace(/[^\d+]/g, '');
    const label = tr('route_call', 'Anrufen');
    element.replaceChildren();
    const icon = document.createElement('img');
    icon.src = 'etc_logos/sell_page_logos/call-logo.svg';
    icon.alt = '';
    icon.style.cssText = 'width:18px;height:18px;vertical-align:middle;margin-right:6px;display:inline-block;';
    element.append(icon, document.createTextNode(
        phone && (!requiresAuth || auth.currentUser)
            ? `${label}: ${phone}`
            : `${label}${requiresAuth ? ` (${tr('route_sign_in_required', 'Login erforderlich')})` : ''}`
    ));
    if (phone && (!requiresAuth || auth.currentUser)) {
        element.href = `tel:${telPhone}`;
        element.onclick = null;
        return;
    }
    element.href = '#';
    element.onclick = event => {
        event.preventDefault();
        if (requiresAuth) {
            openAuthModal();
            return;
        }
        toast(`${label}: ${tr('route_not_available', 'Nicht verfügbar')}`, 'warning');
    };
}

async function hydrateSellerInfoCard(containerId, listing = {}, options = {}) {
    const ownerId = getListingSellerId(listing);
    const fallbackName = getListingSellerName(listing, { allowEmail: false });
    const fallbackEmail = options.email || getListingSellerEmail(listing) || '—';
    const fallbackPhone = options.phone || listing.contactPhone || listing.phone || '';
    const fallbackAddress = options.address || listing.address || listing.location || listing.zip || 'Adresse nicht hinterlegt';
    const baseConfig = {
        ownerId,
        sellerName: fallbackName,
        email: fallbackEmail,
        phone: fallbackPhone,
        address: fallbackAddress,
        activeCount: Number(listing.activeListingsCount || listing.activeCount || 0),
        soldCount: Number(listing.soldListingsCount || listing.soldCount || 0)
    };
    if (!ownerId) {
        renderSellerInfoCard(containerId, baseConfig);
        return;
    }

    const applyProfile = profile => {
        const profileData = profile || {};
        renderSellerInfoCard(containerId, {
            ...baseConfig,
            sellerName: profileData.displayName || profileData.companyName || profileData.firstName || profileData.name || fallbackName,
            email: profileData.email || profileData.contactEmail || fallbackEmail,
            phone: profileData.phoneNumber || profileData.phone || fallbackPhone,
            address: profileData.address || profileData.location || profileData.streetAddress || fallbackAddress,
            activeCount: Number(profileData.activeListingsCount || profileData.activeCount || baseConfig.activeCount),
            soldCount: Number(profileData.soldListingsCount || profileData.soldCount || baseConfig.soldCount),
            profile: profileData
        });
        bindSellerInfoCardLink(containerId, ownerId);
    };

    try {
        const cachedProfile = publicSellerProfileData.get(ownerId) || readCachedPublicSellerProfile(ownerId);
        if (cachedProfile) {
            publicSellerProfileData.set(ownerId, cachedProfile);
            applyProfile(cachedProfile);
            if (typeof options.onProfile === 'function') options.onProfile(cachedProfile);
        }
        let profilePromise = publicSellerProfileCache.get(ownerId);
        if (!profilePromise) {
            profilePromise = getDoc(doc(db, 'users', ownerId))
                .then(snapshot => {
                    const profile = snapshot.exists() ? snapshot.data() : {};
                    publicSellerProfileData.set(ownerId, profile);
                    writeCachedPublicSellerProfile(ownerId, profile);
                    return profile;
                })
                .catch(error => {
                    publicSellerProfileCache.delete(ownerId);
                    throw error;
                });
            publicSellerProfileCache.set(ownerId, profilePromise);
        }
        const profile = await profilePromise;
        applyProfile(profile);
        if (typeof options.onProfile === 'function') {
            options.onProfile(profile);
        }

        const [carsResult, partsResult] = await Promise.allSettled([
            getDocs(query(collection(db, 'cars'), where('ownerId', '==', ownerId))),
            getDocs(query(collection(db, 'parts'), where('ownerId', '==', ownerId)))
        ]);
        const carDocs = carsResult.status === 'fulfilled' ? carsResult.value.docs : [];
        const partDocs = partsResult.status === 'fulfilled' ? partsResult.value.docs : [];
        const allSellerListings = [
            ...carDocs.map(docSnap => normalizeFirestoreCar(docSnap)),
            ...partDocs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
        ];
        const activeCount = allSellerListings.filter(item => String(item.status || 'active') === 'active').length;
        const soldCount = allSellerListings.filter(item => String(item.status || '').trim() === 'sold').length;
        if (document.getElementById(containerId)) {
            renderSellerInfoCard(containerId, {
                ...baseConfig,
                ...profile,
                ownerId,
                sellerName: profile.displayName || profile.companyName || profile.firstName || profile.name || fallbackName,
                email: profile.email || profile.contactEmail || fallbackEmail,
                phone: profile.phoneNumber || profile.phone || fallbackPhone,
                address: profile.address || profile.location || profile.streetAddress || fallbackAddress,
                activeCount: activeCount || Number(profile.activeListingsCount || profile.activeCount || baseConfig.activeCount),
                soldCount: soldCount || Number(profile.soldListingsCount || profile.soldCount || baseConfig.soldCount),
                profile
            });
            bindSellerInfoCardLink(containerId, ownerId);
        }
    } catch (error) {
        console.error('hydrateSellerInfoCard failed:', error);
        renderSellerInfoCard(containerId, baseConfig);
        bindSellerInfoCardLink(containerId, ownerId);
    }

}

async function openSellerProfile(ownerId, options = {}) {
    const normalizedId = String(ownerId || '').trim();
    if (!normalizedId) return;
    if (options.pushHistory !== false) {
        const url = new URL(window.location.href);
        url.searchParams.delete('id');
        url.searchParams.delete('partId');
        url.searchParams.delete('catalog');
        url.searchParams.set('view', 'seller-profile');
        url.searchParams.set('ownerId', normalizedId);
        pushBrowserUrl(url, { state: { view: 'seller-profile', ownerId: normalizedId } });
    }
    activatePage('seller-profile');
    await renderSellerProfileByOwner(normalizedId);
}

function updateDetailNavigation(origin = currentDetailOrigin) {
    currentDetailOrigin = origin || 'search';
    const carCrumb = document.getElementById('d-back-link');
    const partCrumb = document.getElementById('part-back-link');
    const partButton = document.getElementById('part-page-back-button');
    const isMyListings = currentDetailOrigin === 'my-listings';
    const label = isMyListings ? tr('my_listings_title', 'Meine Inserate') : tr('back_search', 'Suchergebnisse');
    const clickHandler = isMyListings
        ? () => { currentMyListingsTab = 'cars'; currentMyListingsPage = 1; void renderMyListings(); activatePage('my-listings'); pushMyListingsHistory('cars', 1, { replace: false }); }
        : event => { void openCarsSearchView(event); };
    if (carCrumb) {
        carCrumb.textContent = label;
        carCrumb.onclick = event => { event?.preventDefault?.(); clickHandler(event); };
    }

    if (partCrumb) {
        partCrumb.textContent = isMyListings ? tr('my_listings_title', 'Meine Inserate') : tr('back_parts', 'Ersatzteile');
        partCrumb.onclick = event => {
            event?.preventDefault?.();
            if (isMyListings) {
                currentMyListingsTab = 'parts';
                currentMyListingsPage = 1;
                void renderMyListings();
                activatePage('my-listings');
                pushMyListingsHistory('parts', 1, { replace: false });
            } else {
                void openPartsSearchView(event);
            }
        };
    }
            if (partButton) {
                const backText = isMyListings ? tr('back_my_listings', 'Zurück zu Meine Inserate') : tr('back_parts', 'Zurück zu Ersatzteilen');
                    partButton.style.display = 'inline-flex';
                    partButton.style.alignItems = 'center';
                    partButton.style.justifyContent = 'center';
                    partButton.style.gap = '6px';
                    partButton.innerHTML = `<img src="etc_logos/sell_page_logos/click-back.svg" alt="" style="width: 18px; height: 18px;"><span style="line-height: 1;">${backText}</span>`;
                    partButton.onclick = event => {
                        event?.preventDefault?.();
            if (isMyListings) {
                currentMyListingsTab = 'parts';
                currentMyListingsPage = 1;
                void renderMyListings();
                activatePage('my-listings');
                pushMyListingsHistory('parts', 1, { replace: false });
            } else {
                void openPartsSearchView(event);
            }
        };
    }
}

function createDefaultSellFormData() {
    return {
        make: '',
        model: '',
        year: '',
        mileage: '',
        fuel: '',
        transmission: '',
        body: '',
        color: '',
        power: '',
        doors: '',
        seats: '',
        sellerType: '',
        vin: '',
        description: '',
        price: '',
        condition: '',
        isNegotiable: false,
        features: [],
        featuresByCategory: Object.fromEntries(FEATURE_GROUP_ORDER.map(group => [group, []])),
        images: [],
        sellerName: '',
        email: '',
        phone: '',
        location: '',
        acceptedTerms: false,
        newsletterOptIn: false,
        selectedDamageType: SELL_WIZARD_DAMAGE_TYPES[0].label,
        inspectionPins: [],
        zustandsbericht: Object.fromEntries(
            [...ZUSTANDSBERICHT_TEXT_FELDER, ...ZUSTANDSBERICHT_RADIO_GRUPPEN].map(field => [field, ''])
        )
    };
}

function toast(message, type = 'info') {
    if (typeof window.toast === 'function') {
        window.toast(message, type);
        return;
    }
    console[type === 'warning' ? 'warn' : 'log'](message);
}

function setLoading(buttonId, isLoading) {
    if (typeof window.setSubmitLoading === 'function') {
        window.setSubmitLoading(buttonId, isLoading);
    }
}

function openAuthModal() {
    if (typeof window.openModal !== 'function') {
        return;
    }
    if (document.getElementById('modal-auth')) {
        window.openModal('modal-auth');
        return;
    }
    window.openModal('login-modal');
}

function closeAuthModal() {
    if (typeof window.closeModal !== 'function') {
        return;
    }
    if (document.getElementById('modal-auth')) {
        window.closeModal('modal-auth');
    }
    window.closeModal('login-modal');
}

function getInputValue(id) {
    return document.getElementById(id)?.value.trim() || '';
}

function tr(key, fallback) {
    const lang = String(localStorage.getItem('hs_lang') || 'de').toLowerCase();
    const translated = t(key);
    return APP_I18N[lang]?.[key] || (translated !== key ? translated : fallback || key);
}

const LISTING_LOAD_BLOCKED_MESSAGE = 'Unable to load listing. Please check your connection or ad blocker.';
const FIRESTORE_DOC_TIMEOUT_MS = 8000;
const FIRESTORE_QUERY_TIMEOUT_MS = 12000;

function isFirestoreTimeoutError(error) {
    return Boolean(error?.message && /^firestore-timeout-\d+/.test(String(error.message)));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getDocWithTimeout(docRef, timeoutMs = FIRESTORE_DOC_TIMEOUT_MS) {
    let timeoutId = null;
    try {
        return await Promise.race([
            getDoc(docRef),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`firestore-timeout-${timeoutMs}`)), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function getDocsWithTimeout(queryRef, timeoutMs = FIRESTORE_QUERY_TIMEOUT_MS) {
    let timeoutId = null;
    try {
        return await Promise.race([
            getDocs(queryRef),
            new Promise((_, reject) => {
                timeoutId = setTimeout(() => reject(new Error(`firestore-timeout-${timeoutMs}`)), timeoutMs);
            })
        ]);
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
}

async function getDocsWithTimeoutRetry(queryRef, { timeoutMs = FIRESTORE_QUERY_TIMEOUT_MS, retries = 1, retryDelayMs = 700 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
            return await getDocsWithTimeout(queryRef, timeoutMs);
        } catch (error) {
            lastError = error;
            const canRetry = isFirestoreTimeoutError(error) && attempt < retries;
            if (!canRetry) {
                throw error;
            }
            console.warn(`Firestore query timed out (attempt ${attempt + 1}/${retries + 1}); retrying...`, error);
            await sleep(retryDelayMs);
        }
    }
    throw lastError;
}

async function refreshFavoriteCaches() {
    const user = auth.currentUser;
    if (!user?.uid) {
        favoriteCarIdsCache = new Set();
        favoritePartIdsCache = new Set();
        return;
    }

    try {
        const snapshot = await getDoc(doc(db, 'users', user.uid, 'favorites', 'state'));
        const data = snapshot.exists() ? (snapshot.data() || {}) : {};
        favoriteCarIdsCache = new Set((data.carIds || []).map(id => String(id)));
        favoritePartIdsCache = new Set((data.partIds || []).map(id => String(id)));
        writeCachedFavorites(user.uid, data);
    } catch (error) {
        console.error('refreshFavoriteCaches failed:', error);
        favoriteCarIdsCache = new Set();
        favoritePartIdsCache = new Set();
    }
}

function readCachedFavorites(userId) {
    try {
        const raw = sessionStorage.getItem(`hs_favorites_cache_${userId}`) || localStorage.getItem(`hs_favorites_cache_${userId}`);
        const data = raw ? JSON.parse(raw) : null;
        return data && Array.isArray(data.carIds) && Array.isArray(data.partIds) ? data : null;
    } catch (error) {
        console.warn('Unable to read cached favorites:', error);
        return null;
    }
}

function writeCachedFavorites(userId, data) {
    const serialized = JSON.stringify({
        carIds: Array.isArray(data?.carIds) ? data.carIds : [],
        partIds: Array.isArray(data?.partIds) ? data.partIds : [],
        updatedAt: Date.now()
    });
    try {
        sessionStorage.setItem(`hs_favorites_cache_${userId}`, serialized);
        localStorage.setItem(`hs_favorites_cache_${userId}`, serialized);
    } catch (error) {
        console.warn('Unable to cache favorites:', error);
    }
}

function isPartFavorited(partId) {
    return favoritePartIdsCache.has(String(partId || ''));
}

function partFavoriteButtonLabel(partId) {
    return isPartFavorited(partId) ? `♥  ${t('btn_saved')}` : `♡  ${t('btn_save')}`;
}

function partFavoriteButtonHtml(part) {
    const encodedId = encodeURIComponent(String(part.id || ''));
    const active = isPartFavorited(part.id);
    return `<button type="button" class="btn-save part-fav-btn${active ? ' active' : ''}" data-part-fav-id="${encodedId}" data-t="${active ? 'btn_saved' : 'btn_save'}" onclick="window.toggleFavoritePart('${encodedId}', event)" style="margin:0;color:${active ? '#e0132b' : ''}">${partFavoriteButtonLabel(part.id)}</button>`;
}

function syncPartFavoriteButtons(partId) {
    const encodedId = encodeURIComponent(String(partId || ''));
    const active = isPartFavorited(partId);
    document.querySelectorAll(`[data-part-fav-id="${encodedId}"]`).forEach(button => {
        button.classList.toggle('active', active);
        button.setAttribute('data-t', active ? 'btn_saved' : 'btn_save');
        button.style.color = active ? '#e0132b' : '';
        button.textContent = partFavoriteButtonLabel(partId);
    });
}

function showDatabaseConnectionWarning() {
    toast('Database connection failed. Please disable any active AdBlockers or check your connection.', 'warning');
}

function populateBrandSelect(id, placeholder) {
    const select = document.getElementById(id);
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    select.innerHTML = `<option value="">${placeholder}</option>${STANDARD_BRANDS.map(brand => `<option value="${brand}">${brand}</option>`).join('')}`;
    if (currentValue && STANDARD_BRANDS.includes(currentValue)) {
        select.value = currentValue;
    }
}

function populateStandardBrandSelects() {
    populateBrandSelect('h-make', t('filter_all_makes'));
    populateBrandSelect('f-make', t('filter_all_makes'));
    populateBrandSelect('s-make', t('sell_choose'));
}

function getAllVehicleModels() {
    return [...new Set(
        Object.values(MAKES_MODELS)
            .flat()
            .map(model => String(model || '').trim())
            .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, 'de'));
}

function populateModelSelect(id, make, placeholder, showAllWhenNoMake = false) {
    const select = document.getElementById(id);
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const normalizedMake = String(make || '').trim();
    const models = normalizedMake && Array.isArray(MAKES_MODELS[normalizedMake])
        ? [...MAKES_MODELS[normalizedMake]].sort((a, b) => a.localeCompare(b, 'de'))
        : (showAllWhenNoMake ? getAllVehicleModels() : []);
    select.innerHTML = `<option value="">${placeholder}</option>${models.map(model => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join('')}`;
    if (currentValue && models.includes(currentValue)) {
        select.value = currentValue;
    }
}

function updateHomeModels() {
    const make = getInputValue('h-make');
    populateModelSelect('h-model', make, t('filter_all_models'));
    const modelSelect = document.getElementById('h-model');
    if (modelSelect) {
        modelSelect.disabled = !make;
        if (!make) modelSelect.value = '';
    }
}

function updateFilterModels() {
    populateModelSelect('f-model', getInputValue('f-make'), t('filter_all_models'), true);
}

function updateSellModels() {
    populateModelSelect('s-model', getInputValue('s-make'), t('sell_choose'));
}

function populateColorSelect(id, placeholder) {
    const select = document.getElementById(id);
    if (!select) return;
    const currentValue = String(select.value || '').trim();
    const placeholderKey = id === 'farbe-select' ? 'sell_color_choose' : 'sell_color_all';
    select.innerHTML = `<option value="" data-t="${placeholderKey}">${escapeHtml(placeholder)}</option>${VEHICLE_COLOR_OPTIONS.map((color, index) => `<option value="${escapeHtml(color)}" data-t="${VEHICLE_COLOR_TRANSLATION_KEYS[index]}">${escapeHtml(color)}</option>`).join('')}`;
    if (currentValue && VEHICLE_COLOR_OPTIONS.includes(currentValue)) {
        select.value = currentValue;
    }
    applyTranslations();
}

function populateVehicleColorSelects() {
    populateColorSelect('farbe-select', t('sell_color_choose'));
    populateColorSelect('f-color', t('sell_color_all'));
}

function syncSellTermsCheckboxState() {
    const accepted = Boolean(document.getElementById('agb-checkbox')?.checked);
    formData.acceptedTerms = accepted;
    const continueButton = document.getElementById('sell-step4-continue');
    const publishButton = document.getElementById('btn-publish');
    if (continueButton) continueButton.disabled = !accepted;
    if (publishButton) publishButton.disabled = !accepted;
}

function populateSellYearOptions() {
    const yearSelect = document.getElementById('s-year');
    if (!yearSelect) return;
    const currentValue = String(yearSelect.value || '').trim();
    const maxYear = Math.max(2026, new Date().getFullYear());
    const years = ['<option value="">-- Bitte wählen --</option>'];
    for (let yr = maxYear; yr >= 1970; yr -= 1) {
        years.push(`<option value="${yr}">${yr}</option>`);
    }
    yearSelect.innerHTML = years.join('');
    if (currentValue) {
        const normalized = Number(currentValue);
        if (!Number.isNaN(normalized) && normalized >= 1970 && normalized <= maxYear) {
            yearSelect.value = String(normalized);
        }
    }
}

function normalizeCompareValue(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeFuelValue(value) {
    const v = normalizeCompareValue(value);
    if (['petrol', 'benzin'].includes(v)) return 'petrol';
    if (['diesel'].includes(v)) return 'diesel';
    if (['electric', 'elektro'].includes(v)) return 'electric';
    if (['hybrid'].includes(v)) return 'hybrid';
    if (['lpg', 'autogas (lpg)', 'autogas'].includes(v)) return 'lpg';
    return v;
}

function normalizeTransmissionValue(value) {
    const v = normalizeCompareValue(value);
    if (['automatic', 'automatik'].includes(v)) return 'automatic';
    if (['manual', 'schaltgetriebe'].includes(v)) return 'manual';
    return v;
}

function normalizeBodyValue(value) {
    const v = normalizeCompareValue(value);
    const map = {
        limousine: 'limousine',
        saloon: 'limousine',
        'suv/geländewagen': 'suv',
        'suv/crossover': 'suv',
        suv: 'suv',
        kombi: 'kombi',
        estate: 'kombi',
        'schrägheck': 'schrägheck',
        schraegheck: 'schrägheck',
        'coupé': 'coupe',
        coupe: 'coupe',
        cabrio: 'cabrio',
        convertible: 'cabrio',
        kleinwagen: 'kleinwagen',
        hatchback: 'kleinwagen',
        van: 'van',
        pickup: 'pickup'
    };
    return map[v] || v;
}

function normalizeDoorGroup(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (['2/3', '4/5', '6/7'].includes(raw)) return raw;
    const n = Number(raw);
    if (!n) return '';
    if (n <= 3) return '2/3';
    if (n <= 5) return '4/5';
    return '6/7';
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatEuro(value) {
    return formatCurrency(value);
}

function renderPriceBadge(item) {
    const currentPrice = Number(item?.price ?? item?.currentPrice ?? 0);
    const previousPrice = Number(item?.previousPrice ?? item?.oldPrice ?? item?.originalPrice ?? item?.basePrice ?? item?.listPrice ?? 0);
    const fallbackOldPrice = Number(item?.oldPrice ?? item?.previousPrice ?? item?.originalPrice ?? item?.basePrice ?? item?.listPrice ?? 0);
    const droppedPrice = previousPrice > currentPrice ? previousPrice : (fallbackOldPrice > currentPrice ? fallbackOldPrice : 0);
    const isVB = Boolean(item?.isVB ?? item?.isNegotiable ?? item?.priceNegotiable ?? item?.vb ?? false);
    const vbBadge = isVB
        ? `<span data-t="vb" class="catalog-vb-badge">${escapeHtml(tr('vb', 'VB'))}</span>`
        : '';
    const currentMarkup = `<span class="price-current">${formatCurrency(currentPrice)}</span>`;
    const previousMarkup = droppedPrice > 0
        ? `<span class="price-old">${formatCurrency(droppedPrice)}</span>`
        : '';
    return `<div class="card-price-row">${currentMarkup}${previousMarkup}${vbBadge}</div>`;
}

function formatNumber(value) {
    return new Intl.NumberFormat('de-DE').format(Number(value) || 0);
}

function getSafeCloudinaryImageUrl(value) {
    if (typeof value !== 'string') return '';
    const rawUrl = value.trim();
    if (!rawUrl || rawUrl.includes('firebasestorage.googleapis.com')) return '';
    try {
        const parsedUrl = new URL(rawUrl);
        return parsedUrl.protocol === 'https:'
            && parsedUrl.hostname === 'res.cloudinary.com'
            && parsedUrl.pathname.startsWith(`/${CLOUDINARY_CLOUD_NAME}/image/upload/`)
            ? parsedUrl.href
            : '';
    } catch {
        return '';
    }
}

function getCarPreviewImage(data) {
    const imageCandidates = [
        data?.image,
        Array.isArray(data?.imageUrls) ? data.imageUrls[0] : null,
        data?.imageUrl
    ];
    return imageCandidates.map(getSafeCloudinaryImageUrl).find(Boolean) || '';
}

function getCarImageList(data) {
    const values = Array.isArray(data?.imageUrls) ? data.imageUrls : [];
    const preview = getCarPreviewImage(data);
    const all = preview ? [preview, ...values] : values;
    return [...new Set(all.map(getSafeCloudinaryImageUrl).filter(Boolean))];
}

function getPartImageList(part) {
    const images = Array.isArray(part?.images)
        ? part.images
        : typeof part?.images === 'string'
            ? part.images.split(',').map(image => image.trim())
            : [];
    const primary = typeof part?.image === 'string' ? part.image : '';
    const imageUrls = Array.isArray(part?.imageUrls) ? part.imageUrls : [];
    const candidates = [primary, ...images, ...imageUrls];
    return [...new Set(candidates.map(getSafeCloudinaryImageUrl).filter(Boolean))];
}

function normalizeFirestoreCar(snapshot) {
    const data = snapshot.data();
    const brand = data.brand || data.make || '';
    const mileage = Number(data.mileage ?? data.km ?? 0);
    const imageUrls = getCarImageList(data);
    const featureState = normalizeFeatureState(data.featuresByCategory || data.ausstattung || data.features);
    return {
        id: snapshot.id,
        ...data,
        brand,
        make: brand,
        title: [brand, data.model].filter(Boolean).join(' ').trim() || 'Fahrzeug',
        mileage,
        km: mileage,
        transmission: data.transmission || data.trans || data.getriebe || 'Manual',
        doors: data.doors || normalizeDoorGroup(data.doors) || '4/5',
        seats: Number(data.seats || 5),
        sellerType: data.sellerType || data.seller_type || data.dealer?.type || 'Private',
        image: imageUrls[0] || '',
        imageUrls,
        features: featureState.flat,
        ausstattung: featureState.flat,
        featuresByCategory: featureState.byCategory,
        status: data.status || 'active',
        viewsCount: Number(data.viewsCount || 0),
        whatsappClicks: Number(data.whatsappClicks || 0)
    };
}

function getCarAusstattungFlat(car) {
    return normalizeFeatureState(car?.featuresByCategory || car?.ausstattung || car?.features).flat;
}

function readNumericFilterValue(rawValue, fallback = 0) {
    const numericValue = Number(rawValue);
    return Number.isFinite(numericValue) ? numericValue : fallback;
}

function normalizeMinFilterValue(rawValue) {
    const numericValue = readNumericFilterValue(rawValue, 0);
    return numericValue > 0 ? numericValue : 0;
}

function normalizeMaxFilterValue(rawValue) {
    const numericValue = readNumericFilterValue(rawValue, 0);
    return numericValue > 0 ? numericValue : Infinity;
}

function getCatalogNumericQueryValue(key, rawValue) {
    if (!CAR_CATALOG_NUMERIC_FILTER_KEYS.has(key)) return null;
    const numericValue = readNumericFilterValue(rawValue, 0);
    return numericValue > 0 ? numericValue : null;
}

function getCheckedSellerTypes() {
    return Array.from(document.querySelectorAll('#page-search .check-label input[type="checkbox"]'))
        .filter(input => input.checked && ['Dealer', 'Private'].includes(String(input.value || '')))
        .map(input => String(input.value || '').trim());
}

function carHasAllSelectedFeatures(car, selectedFeatures) {
    if (!Array.isArray(selectedFeatures) || !selectedFeatures.length) {
        return true;
    }
    const featureSet = new Set(getCarAusstattungFlat(car).map(normalizeCompareValue));
    return selectedFeatures.every(feature => featureSet.has(normalizeCompareValue(feature)));
}

function readSearchFilters() {
    const fuelChecks = Array.from(document.querySelectorAll('#page-search .filter-section input[type="checkbox"]'))
        .filter(input => input.checked && ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'LPG'].includes(input.value))
        .map(input => input.value);
    const selectedFuel = getInputValue('f-fuel-type') || (fuelChecks[0] || '');
    const selectedFeatures = Array.from(document.querySelectorAll('#page-search input[name="f-feature"]:checked'))
        .map(input => String(input.value || '').trim())
        .filter(Boolean);
    return {
        brand: getInputValue('f-make'),
        model: getInputValue('f-model'),
        minPrice: normalizeMinFilterValue(document.getElementById('f-pmin')?.value),
        maxPrice: normalizeMaxFilterValue(document.getElementById('f-pmax')?.value),
        minMileage: normalizeMinFilterValue(document.getElementById('f-kmmin')?.value),
        maxMileage: normalizeMaxFilterValue(document.getElementById('f-kmmax')?.value),
        fuel: selectedFuel || getInputValue('f-fuel-type'),
        firstRegFrom: normalizeMinFilterValue(document.getElementById('f-ymin')?.value),
        firstRegTo: normalizeMaxFilterValue(document.getElementById('f-ymax')?.value),
        transmission: getInputValue('f-transmission'),
        body: getInputValue('f-body'),
        powerMin: normalizeMinFilterValue(document.getElementById('f-power-min')?.value),
        powerMax: normalizeMaxFilterValue(document.getElementById('f-power-max')?.value),
        color: getInputValue('f-color'),
        doors: getInputValue('f-doors'),
        seatsMin: normalizeMinFilterValue(document.getElementById('f-seats-min')?.value),
        seatsMax: normalizeMaxFilterValue(document.getElementById('f-seats-max')?.value),
        zip: getInputValue('f-zip'),
        status: String(getInputValue('f-status') || '').trim(),
        sellerTypes: getCheckedSellerTypes(),
        selectedFeatures
    };
}

function matchesSearchFilters(car, filters) {
    if (filters.brand && normalizeCompareValue(car.brand || car.make || '') !== normalizeCompareValue(filters.brand)) return false;
    if (filters.model && normalizeCompareValue(car.model || '') !== normalizeCompareValue(filters.model)) return false;
    const matchesColor = !filters.color || [car.color, car.exteriorColor, car.farbe]
        .some(val => val && normalizeCompareValue(val) === normalizeCompareValue(filters.color));
    const matchesFuel = !filters.fuel || [car.fuel, car.fuelType, car.kraftstoff]
        .some(val => val && normalizeFuelValue(val) === normalizeFuelValue(filters.fuel));
    const matchesTransmission = !filters.transmission || [car.transmission, car.trans, car.getriebe]
        .some(val => val && normalizeTransmissionValue(val) === normalizeTransmissionValue(filters.transmission));
    const matchesBody = !filters.body || [car.body, car.bodyType, car.karosserie]
        .some(val => val && normalizeBodyValue(val) === normalizeBodyValue(filters.body));
    if (!matchesColor || !matchesFuel || !matchesTransmission || !matchesBody) return false;
    if (Number(car.price || 0) < filters.minPrice) return false;
    if (Number(car.price || 0) > filters.maxPrice) return false;
    if (Number(car.mileage || car.km || 0) < filters.minMileage) return false;
    if (Number(car.mileage || 0) > filters.maxMileage) return false;
    if (Number(car.year || 0) < filters.firstRegFrom) return false;
    if (Number(car.year || 0) > filters.firstRegTo) return false;
    const powerHp = Number(car.hp || car.powerHp || 0);
    if (powerHp < filters.powerMin) return false;
    if (powerHp > filters.powerMax) return false;
    if (filters.doors && normalizeDoorGroup(car.doors) !== filters.doors) return false;
    const seats = Number(car.seats || 0);
    if (seats < filters.seatsMin) return false;
    if (seats > filters.seatsMax) return false;
    if (filters.zip && !`${car.zip || car.location || ''}`.toLowerCase().includes(String(filters.zip).toLowerCase())) return false;
    if (filters.sellerTypes?.length && !filters.sellerTypes.includes(String(car.dealer?.type || '').trim())) return false;
    const statusFilter = String(filters.status || '').trim().toLowerCase();
    const carStatus = String(car.status || 'active').trim().toLowerCase();
    if (statusFilter && carStatus !== statusFilter) return false;
    if (!carHasAllSelectedFeatures(car, filters.selectedFeatures)) return false;
    return true;
}

function sortCars(cars) {
    const sorted = [...cars];
    if (currentSearchSort === 'price-asc') {
        sorted.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    } else if (currentSearchSort === 'price-desc') {
        sorted.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    } else if (currentSearchSort === 'mileage-asc') {
        sorted.sort((a, b) => Number(a.mileage || 0) - Number(b.mileage || 0));
    } else {
        sorted.sort((a, b) => {
            const left = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
            const right = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
            return right - left;
        });
    }
    return sorted;
}

function pushBrowserUrl(url, options = {}) {
    const mode = options.replace ? 'replaceState' : 'pushState';
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl === currentUrl && !options.replace) {
        return;
    }
    window.history[mode](options.state || {}, '', nextUrl);
}

function setCatalogQuery(catalog, extraFilters, options = {}) {
    const url = new URL(window.location.href);
    url.searchParams.delete('partId');
    url.searchParams.delete('id');
    url.searchParams.delete('view');
    url.searchParams.delete('step');
    if (catalog) {
        url.searchParams.set('catalog', catalog);
    } else {
        url.searchParams.delete('catalog');
    }
    if (catalog !== 'cars') {
        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
    }
    if (catalog === 'cars' && extraFilters && typeof extraFilters === 'object') {
        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
        CAR_CATALOG_FILTER_KEYS.forEach(key => {
            const raw = extraFilters[key];
            if (CAR_CATALOG_NUMERIC_FILTER_KEYS.has(key)) {
                const numericValue = getCatalogNumericQueryValue(key, raw);
                if (numericValue === null) return;
                url.searchParams.set(key, String(numericValue));
                return;
            }
            if (raw === undefined || raw === null) return;
            const value = String(raw).trim();
            if (!value) return;
            url.searchParams.set(key, value);
        });
    }
    if (!suppressHistoryRouting) {
        pushBrowserUrl(url, { replace: options.replace !== false ? Boolean(options.replace) : false });
    }
}

function readCarsCatalogParamsFromUrl(source = window.location.search) {
    const params = source instanceof URLSearchParams
        ? source
        : new URLSearchParams(source);
    return {
        make: params.get('make') || params.get('brand') || params.get('marke') || '',
        model: params.get('model') || '',
        body: params.get('body') || params.get('bodyType') || params.get('karosserie') || '',
        fuel: params.get('fuel') || '',
        transmission: params.get('transmission') || '',
        priceMin: Number(params.get('priceMin') || 0),
        priceMax: Number(params.get('priceMax') || 0),
        kmMin: Number(params.get('kmMin') || 0),
        kmMax: Number(params.get('kmMax') || 0),
        yearMin: Number(params.get('yearMin') || 0),
        yearMax: Number(params.get('yearMax') || 0),
        powerMin: Number(params.get('powerMin') || 0),
        powerMax: Number(params.get('powerMax') || 0),
        color: params.get('color') || '',
        doors: params.get('doors') || '',
        seatsMin: Number(params.get('seatsMin') || 0),
        seatsMax: Number(params.get('seatsMax') || 0),
        sellerType: params.get('sellerType') || '',
        status: params.get('status') || '',
        zip: params.get('zip') || '',
        dealerOwnerId: params.get('dealerOwnerId') || '',
        dealerName: params.get('dealerName') || ''
    };
}

function applyCarsCatalogParamsToUi(params) {
    const map = [
        ['f-make', params.make || ''],
        ['f-model', params.model || ''],
        ['f-body', params.body || ''],
        ['f-fuel-type', params.fuel || ''],
        ['f-transmission', params.transmission || ''],
        ['f-pmin', params.priceMin || ''],
        ['f-pmax', params.priceMax || ''],
        ['f-kmmin', params.kmMin || ''],
        ['f-kmmax', params.kmMax || ''],
        ['f-ymin', params.yearMin || ''],
        ['f-ymax', params.yearMax || ''],
        ['f-power-min', params.powerMin || ''],
        ['f-power-max', params.powerMax || ''],
        ['f-color', params.color || ''],
        ['f-doors', params.doors || ''],
        ['f-seats-min', params.seatsMin || ''],
        ['f-seats-max', params.seatsMax || ''],
        ['f-status', params.status || ''],
        ['f-zip', params.zip || '']
    ];
    map.forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.value = String(value || '');
    });
    document.querySelectorAll('#page-search .check-label input[type="checkbox"]').forEach(input => {
        if (['Dealer', 'Private'].includes(String(input.value || ''))) {
            input.checked = params.sellerType ? input.value === params.sellerType : false;
        }
    });
}

function syncCarsSidebarFiltersFromUrl(params) {
    const urlParams = params instanceof URLSearchParams
        ? readCarsCatalogParamsFromUrl(params)
        : (params || readCarsCatalogParamsFromUrl(window.location.search));
    applyCarsCatalogParamsToUi(urlParams);
    updateFilterModels();
    applyCarsCatalogParamsToUi(urlParams);
    return urlParams;
}

function filterCarsByCatalogParams(cars, params) {
    const priceMin = normalizeMinFilterValue(params.priceMin);
    const priceMax = normalizeMaxFilterValue(params.priceMax);
    const kmMin = normalizeMinFilterValue(params.kmMin);
    const kmMax = normalizeMaxFilterValue(params.kmMax);
    const yearMin = normalizeMinFilterValue(params.yearMin);
    const yearMax = normalizeMaxFilterValue(params.yearMax);
    const powerMin = normalizeMinFilterValue(params.powerMin);
    const powerMax = normalizeMaxFilterValue(params.powerMax);
    const seatsMin = normalizeMinFilterValue(params.seatsMin);
    const seatsMax = normalizeMaxFilterValue(params.seatsMax);
    return cars.filter(car => {
        if (params.make && normalizeCompareValue(car.brand || car.make || car.manufacturer || '') !== normalizeCompareValue(params.make)) return false;
        if (params.model && (car.model || '') !== params.model) return false;
        if (params.dealerOwnerId && String(car.ownerId || car.userId || '').trim() !== String(params.dealerOwnerId).trim()) return false;
        if (!params.dealerOwnerId && params.dealerName && normalizeCompareValue(car.sellerName || car.contactName || car.ownerEmail || car.contactEmail || '') !== normalizeCompareValue(params.dealerName)) return false;
        if (params.body && normalizeBodyValue(car.body || car.bodyType || car.karosserie || '') !== normalizeBodyValue(params.body)) return false;
        if (params.fuel && ![car.fuel, car.fuelType, car.kraftstoff].some(val => val && normalizeFuelValue(val) === normalizeFuelValue(params.fuel))) return false;
        if (params.transmission && ![car.transmission, car.trans, car.getriebe].some(val => val && normalizeTransmissionValue(val) === normalizeTransmissionValue(params.transmission))) return false;
        if (Number(car.price || 0) < priceMin) return false;
        if (Number(car.price || 0) > priceMax) return false;
        if (Number(car.mileage || car.km || 0) < kmMin) return false;
        if (Number(car.mileage || 0) > kmMax) return false;
        if (Number(car.year || 0) < yearMin) return false;
        if (Number(car.year || 0) > yearMax) return false;
        if (Number(car.hp || car.powerHp || 0) < powerMin) return false;
        if (Number(car.hp || car.powerHp || 0) > powerMax) return false;
        if (params.color && ![car.color, car.exteriorColor, car.farbe].some(val => val && normalizeCompareValue(val) === normalizeCompareValue(params.color))) return false;
        if (params.doors && String(normalizeDoorGroup(car.doors) || '').trim() !== String(params.doors || '').trim()) return false;
        if (parseInt(car.seats, 10) < parseInt(seatsMin, 10)) return false;
        if (parseInt(car.seats, 10) > parseInt(seatsMax, 10)) return false;
        if (params.zip && !`${car.zip || car.location || ''}`.toLowerCase().includes(String(params.zip).toLowerCase())) return false;
        if (params.sellerType && String(car.sellerType || car.seller_type || car.dealer?.type || '').trim() !== params.sellerType) return false;
        const statusFilter = String(params.status || '').trim().toLowerCase();
        const carStatus = String(car.status || 'active').trim().toLowerCase();
        if (statusFilter && carStatus !== statusFilter) return false;
        return true;
    });
}

function renderCarFilterTags(filters) {
    const tags = document.getElementById('active-tags');
    if (!tags) return;
    const values = [];
    if (filters.make) values.push(filters.make);
    if (filters.model) values.push(filters.model);
    if (filters.body) values.push(filters.body);
    if (filters.fuels?.length) values.push(...filters.fuels);
    if (filters.transmission) values.push(filters.transmission);
    if (filters.color) values.push(filters.color);
    if (filters.status) values.push(`Status: ${STATUS_LABELS[filters.status] || filters.status}`);
    if (filters.doors) values.push(`${filters.doors} Türen`);
    if (filters.powerMin > 0) values.push(`PS ≥ ${filters.powerMin}`);
    if (Number.isFinite(filters.powerMax) && filters.powerMax > 0) values.push(`PS ≤ ${filters.powerMax}`);
    if (filters.seatsMin > 0) values.push(`Sitze ≥ ${filters.seatsMin}`);
    if (Number.isFinite(filters.seatsMax) && filters.seatsMax > 0) values.push(`Sitze ≤ ${filters.seatsMax}`);
    if (filters.selectedFeatures?.length) values.push(...filters.selectedFeatures);
    if (filters.priceMin > 0) values.push(`ab ${formatEuro(filters.priceMin)}`);
    if (Number.isFinite(filters.priceMax) && filters.priceMax > 0) values.push(`≤ ${formatEuro(filters.priceMax)}`);
    if (filters.kmMin > 0) values.push(`ab ${formatNumber(filters.kmMin)} km`);
    if (Number.isFinite(filters.kmMax) && filters.kmMax > 0) values.push(`≤ ${formatNumber(filters.kmMax)} km`);
    if (filters.yearMin > 0) values.push(`ab ${filters.yearMin}`);
    if (Number.isFinite(filters.yearMax) && filters.yearMax > 0) values.push(`bis ${filters.yearMax}`);
    if (filters.zip) values.push(filters.zip);
    if (filters.sellerTypes?.length) values.push(...filters.sellerTypes.map(type => type === 'Dealer' ? 'Händler' : 'Privat'));
    if (filters.dealerName) values.push(`Händler: ${filters.dealerName}`);
    if (!values.length) {
        tags.innerHTML = '';
        return;
    }
    tags.innerHTML = values.map(item => `<div class="active-tag">${escapeHtml(item)}</div>`).join('');
}

function getDealerIdentity(car) {
    if (!car) return { ownerId: '', sellerName: '' };
    return {
        ownerId: String(car.ownerId || car.userId || '').trim(),
        sellerName: String(car.sellerName || car.contactName || car.ownerEmail || car.contactEmail || 'Händler').trim() || 'Händler'
    };
}

const PART_CATEGORY_DEFINITIONS = {
    motor: { translationKey: 'part_motor', aliases: ['motor', 'engine', 'motorteile', 'engineparts'] },
    getriebe: { translationKey: 'part_drivetrain', aliases: ['getriebe', 'antrieb', 'transmission', 'drivetrain', 'sanziman', 'aktarma'] },
    fahrwerk: { translationKey: 'part_chassis', aliases: ['fahrwerk', 'lenkung', 'chassis', 'suspension', 'steering', 'suspansiyon', 'direksiyon'] },
    karosserie: { translationKey: 'part_body', aliases: ['karosserie', 'exterieur', 'body', 'exterior', 'kaporta', 'disdonanim'] },
    bremsanlage: { translationKey: 'part_brakes', aliases: ['bremsanlage', 'bremsen', 'bremse', 'brakes', 'brakesystem', 'fren'] },
    elektronik: { translationKey: 'part_electronics', aliases: ['elektronik', 'elektrik', 'beleuchtung', 'electronics', 'electrical', 'lighting'] },
    innenraum: { translationKey: 'part_interior', aliases: ['innenraum', 'innenausstattung', 'sicherheit', 'interior', 'safety', 'icmekan', 'guvenlik'] },
    auspuffanlage: { translationKey: 'part_exhaust', aliases: ['auspuffanlage', 'auspuff', 'abgasanlage', 'exhaust'] },
    klima: { translationKey: 'part_climate', aliases: ['klimaanlage', 'heizung', 'klima', 'airconditioning', 'heating'] },
    filter: { translationKey: 'part_filters', aliases: ['filter', 'filteroele', 'filterole', 'oele', 'ole', 'filters', 'oils'] },
    zubehoer: { translationKey: 'part_accessories', aliases: ['zubehoer', 'zubehor', 'werkzeug', 'werkzeuge', 'accessories', 'tools', 'aksesuar', 'ekipman'] },
    sonstiges: { translationKey: 'part_other', aliases: ['sonstiges', 'sonstige', 'other', 'misc', 'miscellaneous'] }
};

function normalizePartCategoryValue(value) {
    const cleaned = slugifyPartCategory(value);
    if (!cleaned) return '';
    const category = Object.entries(PART_CATEGORY_DEFINITIONS).find(([, definition]) =>
        definition.aliases.some(alias => cleaned.includes(alias))
    );
    if (category) return category[0];
    return cleaned;
}

function localizedPartCategory(value) {
    const normalized = normalizePartCategoryValue(value);
    const definition = PART_CATEGORY_DEFINITIONS[normalized];
    return definition ? tr(definition.translationKey, value || '—') : String(value || '—');
}

function syncPartCategoryControls() {
    const categorySelects = document.querySelectorAll('#parts-browser-category, #parts-browser-create-category, #parts-catalog-category, #parts-sidebar-category, #hp-category, #part-category, #edit-part-category');
    categorySelects.forEach(select => {
        const selectedValue = normalizePartCategoryValue(select.value);
        const fragment = document.createDocumentFragment();
        const allOption = document.createElement('option');
        allOption.value = '';
        const isFilter = ['parts-browser-category', 'parts-catalog-category', 'parts-sidebar-category', 'hp-category'].includes(select.id);
        allOption.textContent = t(isFilter ? (select.id === 'parts-catalog-category' ? 'filter_category' : 'part_all_categories') : 'select_option');
        fragment.appendChild(allOption);
        Object.entries(PART_CATEGORY_DEFINITIONS).forEach(([value, definition]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = t(definition.translationKey);
            fragment.appendChild(option);
        });
        select.replaceChildren(fragment);
        if (selectedValue && PART_CATEGORY_DEFINITIONS[selectedValue]) select.value = selectedValue;
    });
}

function localizedPartCondition(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'neu' || normalized === 'new') return tr('parts_condition_new', value || 'Neu');
    if (normalized === 'gebraucht' || normalized === 'used') return tr('parts_condition_used', value || 'Gebraucht');
    return String(value || '—');
}

function slugifyPartCategory(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]/g, '');
}

function partCategoryMatches(selectedCategory, partCategory) {
    const selected = slugifyPartCategory(normalizePartCategoryValue(selectedCategory));
    const actual = slugifyPartCategory(normalizePartCategoryValue(partCategory) || partCategory);
    if (!selected) return true;
    return actual.includes(selected) || selected.includes(actual);
}

function sortParts(partsArray, sortBy) {
    const normalizedSort = String(sortBy || 'newest').trim();
    const parts = Array.isArray(partsArray) ? [...partsArray] : [];
    if (normalizedSort === 'price-asc') {
        return parts.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    }
    if (normalizedSort === 'price-desc') {
        return parts.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
    }
    return parts.sort((a, b) => {
        const left = a.createdAt?.seconds || a.createdAt?.toMillis?.() || 0;
        const right = b.createdAt?.seconds || b.createdAt?.toMillis?.() || 0;
        return right - left;
    });
}

function resetPartSubmitButton() {
    const submitButton = document.querySelector('#parts-modal button[type="submit"]') || document.getElementById('btn-submit-part');
    if (!submitButton) return;
    const originalLabel = submitButton.dataset.originalLabel || 'Veröffentlichen';
    submitButton.disabled = false;
    submitButton.innerHTML = originalLabel;
}

function setPartSubmitButtonLoading() {
    const submitButton = document.querySelector('#parts-modal button[type="submit"]') || document.getElementById('btn-submit-part');
    if (!submitButton) return null;
    if (!submitButton.dataset.originalLabel) {
        submitButton.dataset.originalLabel = submitButton.innerHTML.trim() || 'Veröffentlichen';
    }
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Wird veröffentlicht...';
    return submitButton;
}

function readPartsCatalogParamsFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return {
        category: normalizePartCategoryValue(decodeURIComponent(params.get('category') || params.get('partsCategory') || '')),
        condition: decodeURIComponent(String(params.get('condition') || '')).trim(),
        status: decodeURIComponent(String(params.get('status') || '')).trim(),
        priceMax: readNumericFilterValue(params.get('priceMax') || 0, 0),
        keyword: decodeURIComponent(String(params.get('keyword') || '')).trim(),
        dealerOwnerId: decodeURIComponent(String(params.get('dealerOwnerId') || '')).trim(),
        dealerName: decodeURIComponent(String(params.get('dealerName') || '')).trim()
    };
}

function applyPartsCatalogParamsToUi(params, prefix = 'parts-sidebar') {
    const map = [
        [`${prefix}-category`, normalizePartCategoryValue(params.category || '')],
        [`${prefix}-condition`, params.condition || ''],
        [`${prefix}-status`, params.status || ''],
        [`${prefix}-price`, params.priceMax > 0 ? params.priceMax : ''],
        [`${prefix}-keyword`, params.keyword || '']
    ];
    map.forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = String(value || '');
    });
}

function buildPartsCatalogParams(prefix = 'parts-sidebar') {
    return {
        category: normalizePartCategoryValue(getInputValue(`${prefix}-category`)),
        condition: getInputValue(`${prefix}-condition`),
        status: getInputValue(`${prefix}-status`),
        priceMax: readNumericFilterValue(document.getElementById(`${prefix}-price`)?.value || 0, 0),
        keyword: getInputValue(`${prefix}-keyword`),
        dealerOwnerId: readPartsCatalogParamsFromUrl().dealerOwnerId || '',
        dealerName: readPartsCatalogParamsFromUrl().dealerName || ''
    };
}

function setPartsCatalogQuery(params = {}, options = {}) {
    const url = new URL(window.location.href);
    url.searchParams.delete('id');
    url.searchParams.delete('partId');
    url.searchParams.delete('view');
    url.searchParams.delete('step');
    CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
    url.searchParams.set('catalog', 'parts');
    ['category', 'condition', 'status', 'priceMax', 'keyword', 'dealerOwnerId', 'dealerName'].forEach(key => url.searchParams.delete(key));
    const normalizedParams = {
        category: normalizePartCategoryValue(params.category || ''),
        condition: String(params.condition || '').trim(),
        status: String(params.status || '').trim(),
        priceMax: readNumericFilterValue(params.priceMax || 0, 0),
        keyword: String(params.keyword || '').trim(),
        dealerOwnerId: String(params.dealerOwnerId || '').trim(),
        dealerName: String(params.dealerName || '').trim()
    };
    if (normalizedParams.category) url.searchParams.set('category', normalizedParams.category);
    if (normalizedParams.condition) url.searchParams.set('condition', normalizedParams.condition);
    if (normalizedParams.status) url.searchParams.set('status', normalizedParams.status);
    if (normalizedParams.priceMax > 0) url.searchParams.set('priceMax', String(normalizedParams.priceMax));
    if (normalizedParams.keyword) url.searchParams.set('keyword', normalizedParams.keyword);
    if (normalizedParams.dealerOwnerId) url.searchParams.set('dealerOwnerId', normalizedParams.dealerOwnerId);
    if (normalizedParams.dealerName) url.searchParams.set('dealerName', normalizedParams.dealerName);
    if (!suppressHistoryRouting) {
        pushBrowserUrl(url, { replace: Boolean(options.replace) });
    }
}

function renderDealerFilterBanner(filters) {
    const banner = document.getElementById('dealer-filter-banner');
    if (!banner) return;
    if (!filters?.dealerName && !filters?.dealerOwnerId) {
        banner.innerHTML = '';
        banner.style.display = 'none';
        return;
    }
    const label = filters.dealerName || 'diesem Händler';
    const isPartsMode = currentSearchMode === 'parts' || String(new URLSearchParams(window.location.search).get('catalog') || '').toLowerCase() === 'parts';
    banner.className = 'dealer-filter-banner';
    banner.style.display = '';
    banner.innerHTML = `<div><strong>Inserate von ${escapeHtml(label)}</strong><div style="font-size:13px;color:var(--gray-600);margin-top:4px">Es werden nur passende ${isPartsMode ? 'Ersatzteile' : 'Fahrzeuge'} dieses Händlers angezeigt.</div></div><button type="button" class="btn-back subtle" id="dealer-filter-clear-btn">Filter aufheben</button>`;
    document.getElementById('dealer-filter-clear-btn')?.addEventListener('click', async () => {
        if (isPartsMode) {
            setPartsCatalogQuery({}, { replace: false });
            await openPartsSearchView();
            return;
        }
        await openCarsSearchView(null, {}, { pushHistory: true });
    });
}

function buildCarsCatalogParamsFromSidebarFilters(filters) {
    return {
        make: filters.make || '',
        model: filters.model || '',
        body: filters.body || '',
        fuel: filters.fuels?.[0] || '',
        transmission: filters.transmission || '',
        priceMin: Number(filters.priceMin || 0),
        priceMax: Number.isFinite(filters.priceMax) ? filters.priceMax : 0,
        kmMin: Number(filters.kmMin || 0),
        kmMax: Number.isFinite(filters.kmMax) ? filters.kmMax : 0,
        yearMin: Number(filters.yearMin || 0),
        yearMax: Number.isFinite(filters.yearMax) ? filters.yearMax : 0,
        powerMin: Number(filters.powerMin || 0),
        powerMax: Number.isFinite(filters.powerMax) ? filters.powerMax : 0,
        color: filters.color || '',
        doors: filters.doors || '',
        seatsMin: Number(filters.seatsMin || 0),
        seatsMax: Number.isFinite(filters.seatsMax) ? filters.seatsMax : 0,
        sellerType: filters.sellerTypes?.[0] || '',
        status: filters.status || '',
        zip: filters.zip || '',
        dealerOwnerId: filters.dealerOwnerId || '',
        dealerName: filters.dealerName || ''
    };
}

function readCarsSidebarFilters() {
    const fuelChecks = Array.from(document.querySelectorAll('#page-search .filter-section input[type="checkbox"]'))
        .filter(input => input.checked && ['Petrol', 'Diesel', 'Electric', 'Hybrid', 'LPG'].includes(input.value))
        .map(input => input.value);
    const selectedFuel = getInputValue('f-fuel-type') || (fuelChecks[0] || '');
    const urlParams = readCarsCatalogParamsFromUrl();
    const selectedFeatures = Array.from(document.querySelectorAll('#page-search input[name="f-feature"]:checked'))
        .map(input => String(input.value || '').trim())
        .filter(Boolean);
    return {
        make: getInputValue('f-make') || urlParams.make,
        model: getInputValue('f-model'),
        body: getInputValue('f-body') || urlParams.body,
        transmission: getInputValue('f-transmission'),
        priceMin: normalizeMinFilterValue(document.getElementById('f-pmin')?.value),
        priceMax: normalizeMaxFilterValue(document.getElementById('f-pmax')?.value),
        yearMin: normalizeMinFilterValue(document.getElementById('f-ymin')?.value),
        yearMax: normalizeMaxFilterValue(document.getElementById('f-ymax')?.value),
        kmMin: normalizeMinFilterValue(document.getElementById('f-kmmin')?.value),
        kmMax: normalizeMaxFilterValue(document.getElementById('f-kmmax')?.value),
        fuels: selectedFuel ? [selectedFuel] : [],
        powerMin: normalizeMinFilterValue(document.getElementById('f-power-min')?.value),
        powerMax: normalizeMaxFilterValue(document.getElementById('f-power-max')?.value),
        color: getInputValue('f-color'),
        status: getInputValue('f-status'),
        doors: String(getInputValue('f-doors') || '').trim(),
        seatsMin: parseInt(document.getElementById('f-seats-min')?.value || '0', 10) || 0,
        seatsMax: (() => {
            const value = parseInt(document.getElementById('f-seats-max')?.value || '', 10);
            return Number.isFinite(value) && value > 0 ? value : Infinity;
        })(),
        zip: getInputValue('f-zip'),
        sellerTypes: getCheckedSellerTypes(),
        selectedFeatures,
        dealerOwnerId: urlParams.dealerOwnerId || '',
        dealerName: urlParams.dealerName || ''
    };
}

function applyCarsFilters() {
    const filters = readCarsSidebarFilters();
    const makeFilter = normalizeCompareValue(filters.make);
    const modelFilter = normalizeCompareValue(filters.model);
    const bodyFilter = normalizeBodyValue(filters.body);
    const transmissionFilter = normalizeTransmissionValue(filters.transmission);
    const selectedFuels = filters.fuels.map(normalizeFuelValue);
    currentSearchCars = allCarsCache.filter(car => {
        const carMake = normalizeCompareValue(car.make || car.brand || car.manufacturer);
        const carModel = normalizeCompareValue(car.model);
        const carBody = normalizeBodyValue(car.body || car.bodyType || car.karosserie || car.body_type || car.vehicleBody);
        const carTransmission = normalizeTransmissionValue(car.transmission || car.trans);
        const carFuel = normalizeFuelValue(car.fuel);
        const price = Number(car.price || 0);
        const year = Number(car.year || 0);
        const mileage = Number(car.mileage || car.km || 0);
        const powerHp = Number(car.hp || car.powerHp || 0);
        const color = normalizeCompareValue(car.color || car.exteriorColor);
        const seats = parseInt(car.seats, 10) || 0;
        const doorGroup = String(normalizeDoorGroup(car.doors) || '').trim();
        const dealerName = normalizeCompareValue(car.sellerName || car.contactName || car.ownerEmail || car.contactEmail || '');
        const dealerOwnerId = String(car.ownerId || car.userId || '').trim();
        const sellerType = String(car.sellerType || car.seller_type || car.dealer?.type || '').trim();
        const status = String(car.status || 'active').trim();
        if (makeFilter && carMake !== makeFilter) return false;
        if (modelFilter && carModel !== modelFilter) return false;
        if (filters.dealerOwnerId && dealerOwnerId !== String(filters.dealerOwnerId).trim()) return false;
        if (!filters.dealerOwnerId && filters.dealerName && dealerName !== normalizeCompareValue(filters.dealerName)) return false;
        if (bodyFilter && carBody !== bodyFilter) return false;
        if (transmissionFilter && carTransmission !== transmissionFilter) return false;
        if (price < filters.priceMin) return false;
        if (price > filters.priceMax) return false;
        if (year < filters.yearMin) return false;
        if (year > filters.yearMax) return false;
        if (mileage < filters.kmMin) return false;
        if (mileage > filters.kmMax) return false;
        if (selectedFuels.length && !selectedFuels.includes(carFuel)) return false;
        if (powerHp < filters.powerMin) return false;
        if (powerHp > filters.powerMax) return false;
        if (filters.color && color !== normalizeCompareValue(filters.color)) return false;
        const statusFilter = String(filters.status || '').trim().toLowerCase();
        const carStatus = String(car.status || 'active').trim().toLowerCase();
        if (statusFilter && carStatus !== statusFilter) return false;
        if (filters.doors && doorGroup !== String(filters.doors || '').trim()) return false;
        if (seats < filters.seatsMin) return false;
        if (seats > filters.seatsMax) return false;
        if (filters.zip && !`${car.zip || car.location || ''}`.toLowerCase().includes(String(filters.zip).toLowerCase())) return false;
        if (filters.sellerTypes?.length && !filters.sellerTypes.includes(sellerType)) return false;
        if (!carHasAllSelectedFeatures(car, filters.selectedFeatures)) return false;
        return true;
    });
    renderCarFilterTags(filters);
    renderDealerFilterBanner(filters);
    setCatalogQuery('cars', buildCarsCatalogParamsFromSidebarFilters(filters), { replace: true });
    renderCarsGrid(currentSearchCars);
}

async function clearAllFilters() {
    if (currentSearchMode === 'parts') {
        ['parts-sidebar-category', 'parts-sidebar-condition', 'parts-sidebar-status', 'parts-sidebar-price', 'parts-sidebar-keyword'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        renderPartsSearchResults(allPartsCache, 'parts-sidebar');
        return;
    }
    const activeCatalogParams = readCarsCatalogParamsFromUrl();
    const preservedDealerParams = {
        dealerOwnerId: activeCatalogParams.dealerOwnerId || '',
        dealerName: activeCatalogParams.dealerName || ''
    };
    resetCarsSearchFiltersUi();
    renderCarFilterTags({ fuels: [], priceMax: 0, kmMax: 0, yearMin: 0 });
    setCatalogQuery('cars', preservedDealerParams, { replace: true });
    applyCarsFilters();
}

function bindCarsSidebarFilterEvents() {
    const selectIds = ['f-make', 'f-model', 'f-body', 'f-pmin', 'f-pmax', 'f-ymin', 'f-ymax', 'f-kmmin', 'f-kmmax', 'f-transmission', 'f-fuel-type', 'f-power-min', 'f-power-max', 'f-color', 'f-status', 'f-doors', 'f-seats-min', 'f-seats-max', 'f-zip'];
    selectIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        if (id === 'f-make') {
            el.addEventListener('change', () => {
                updateFilterModels();
                searchCars();
            });
        } else {
            el.addEventListener('change', searchCars);
        }
        el.addEventListener('input', searchCars);
    });
    document.querySelectorAll('#page-search .filter-section input[type="checkbox"]').forEach(input => {
        input.addEventListener('change', searchCars);
    });
}

function hasAnyCarsCatalogParam(params) {
    return Boolean(
        (params.make || '').trim() ||
        (params.model || '').trim() ||
        (params.dealerOwnerId || '').trim() ||
        (params.dealerName || '').trim() ||
        (params.sellerType || '').trim() ||
        (params.zip || '').trim() ||
        (params.body || '').trim() ||
        (params.fuel || '').trim() ||
        (params.transmission || '').trim() ||
        (params.status || '').trim() ||
        Number(params.priceMin || 0) > 0 ||
        Number(params.priceMax || 0) > 0 ||
        Number(params.kmMin || 0) > 0 ||
        Number(params.kmMax || 0) > 0 ||
        Number(params.yearMin || 0) > 0 ||
        Number(params.yearMax || 0) > 0 ||
        Number(params.powerMin || 0) > 0 ||
        Number(params.powerMax || 0) > 0 ||
        (params.color || '').trim() ||
        (params.doors || '').trim() ||
        Number(params.seatsMin || 0) > 0 ||
        Number(params.seatsMax || 0) > 0
    );
}

function resetCarsSearchFiltersUi() {
    const resetMap = [
        ['f-make', ''],
        ['f-model', ''],
        ['f-body', ''],
        ['f-pmin', ''],
        ['f-pmin', ''],
        ['f-pmax', ''],
        ['f-ymin', ''],
        ['f-ymax', ''],
        ['f-kmmin', ''],
        ['f-kmmax', ''],
        ['f-transmission', ''],
        ['f-fuel-type', ''],
        ['f-power-min', ''],
        ['f-power-max', ''],
        ['f-color', ''],
        ['f-status', ''],
        ['f-doors', ''],
        ['f-seats-min', ''],
        ['f-seats-max', ''],
        ['f-zip', ''],
        ['sort-select', 'newest'],
        ['results-sort-select', 'newest']
    ];
    resetMap.forEach(([id, value]) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    });
    document.querySelectorAll('#page-search .check-label input[type="checkbox"]').forEach(input => {
        input.checked = false;
    });
}

async function fetchCarsFromFirestore(forceRefresh = false) {
    try {
        const cars = await listCarsCached({ forceRefresh });
        return cars.map(car => normalizeFirestoreCar({ id: car.id, data: () => car })).filter(car => car.status !== 'sold');
    } catch (error) {
        console.warn('fetchCarsFromFirestore failed, using cache:', error);
        showDatabaseConnectionWarning();
        if (Array.isArray(allCarsCache) && allCarsCache.length) return allCarsCache;
        return Array.isArray(currentSearchCars) ? currentSearchCars : [];
    }
}

async function fetchPartsFromFirestore(forceRefresh = false) {
    try {
        return await listPartsCached({ forceRefresh });
    } catch (error) {
        console.warn('fetchPartsFromFirestore failed, using cache:', error);
        showDatabaseConnectionWarning();
        return Array.isArray(allPartsCache) ? allPartsCache : [];
    }
}

function renderCarsGrid(cars) {
    renderSearchCards(cars);
}

function activatePage(pageId) {
    const pageSwitcher = rawShowPageFn || window.showPage;
    if (typeof pageSwitcher === 'function') {
        pageSwitcher(pageId);
        return;
    }
    cleanupTransientUi();
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    document.getElementById(`page-${pageId}`)?.classList.add('active');
    syncFloatingDetailNav();
    scrollToTopImmediately();
}

function ensureVisiblePageFallback() {
    if (document.querySelector('.page.active')) {
        return;
    }
    activatePage('home');
}

function statusBadge(status) {
    const label = localizedStatusLabel(status);
    const color = status === 'sold' ? '#b91c1c' : status === 'reserved' ? '#b45309' : '#0f766e';
    const bg = status === 'sold' ? '#fee2e2' : status === 'reserved' ? '#ffedd5' : '#ccfbf1';
    return `<span style="display:inline-block;padding:4px 8px;border-radius:999px;font-size:11px;font-weight:700;color:${color};background:${bg};">${label}</span>`;
}

function getListingSellerId(listing) {
    return String(
        listing?.sellerId ||
        listing?.ownerId ||
        listing?.userId ||
        listing?.sellerUid ||
        listing?.seller?.id ||
        listing?.seller?.uid ||
        ''
    ).trim();
}

function getListingSellerName(listing, { allowEmail = true } = {}) {
    return String(
        listing?.sellerName ||
        (typeof listing?.seller === 'string' ? listing.seller : '') ||
        listing?.seller?.name ||
        listing?.contactName ||
        listing?.dealer?.name ||
        listing?.ownerName ||
        (allowEmail ? listing?.ownerEmail : '') ||
        (allowEmail ? listing?.contactEmail : '') ||
        tr('route_seller', 'Verkäufer')
    ).trim() || tr('route_seller', 'Verkäufer');
}

function getListingSellerHref(listing) {
    const sellerId = getListingSellerId(listing);
    return sellerId
        ? `index.html?view=seller-profile&ownerId=${encodeURIComponent(sellerId)}`
        : '';
}

function getListingSellerEmail(listing) {
    return String(
        listing?.sellerEmail ||
        listing?.ownerEmail ||
        listing?.contactEmail ||
        listing?.seller?.email ||
        ''
    ).trim();
}

function renderListingSellerLink(listing, options = {}) {
    const sellerName = escapeHtml(getListingSellerName(listing, { ...options, allowEmail: false }));
    const sellerId = getListingSellerId(listing);
    const href = getListingSellerHref(listing);
    const avatar = escapeHtml(getResolvedAvatarUrl(listing?.profile || listing?.sellerProfile || {}, null));
    const sellerEmail = escapeHtml(getListingSellerEmail(listing));
    const emailMarkup = options.showEmail && sellerEmail
        ? `<span class="catalog-list-seller-email">${sellerEmail}</span>`
        : '';
    if (!sellerId || !href) {
        return `<span class="catalog-list-seller seller-profile-link"><img src="${avatar}" alt="${sellerName}" class="catalog-list-seller-avatar"><span class="catalog-list-seller-copy"><span class="catalog-list-seller-name">${sellerName}</span>${emailMarkup}</span></span>`;
    }
    return `<span class="catalog-list-seller seller-profile-link" role="link" tabindex="0" data-seller-owner="${escapeHtml(sellerId)}" data-seller-href="${escapeHtml(href)}" onclick="event.preventDefault();event.stopPropagation();window.location.href=this.dataset.sellerHref;" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();window.location.href=this.dataset.sellerHref;}"><img src="${avatar}" alt="${sellerName}" class="catalog-list-seller-avatar"><span class="catalog-list-seller-copy"><span class="catalog-list-seller-name">${sellerName}</span>${emailMarkup}</span></span>`;
}

async function hydrateCatalogSellerProfiles(container) {
    if (!container) return;
    const sellerNodes = Array.from(container.querySelectorAll('.seller-profile-link[data-seller-owner]'));
    const ownerIds = [...new Set(sellerNodes.map(node => node.dataset.sellerOwner).filter(Boolean))];
    await Promise.all(ownerIds.map(async ownerId => {
        try {
            const snapshot = await getDoc(doc(db, 'users', ownerId));
            if (!snapshot.exists()) return;
            const profile = snapshot.data() || {};
            const name = String(profile.displayName || profile.companyName || profile.firstName || '').trim();
            const email = String(profile.email || profile.contactEmail || '').trim();
            const avatar = getResolvedAvatarUrl(profile, null);
            sellerNodes.filter(node => node.dataset.sellerOwner === ownerId).forEach(node => {
                const nameNode = node.querySelector('.catalog-list-seller-name');
                const emailNode = node.querySelector('.catalog-list-seller-email');
                const avatarNode = node.querySelector('.catalog-list-seller-avatar');
                if (nameNode && name) nameNode.textContent = name;
                if (emailNode && email) emailNode.textContent = email;
                if (avatarNode) avatarNode.src = avatar;
            });
        } catch (error) {
            console.warn('hydrateCatalogSellerProfiles failed:', error);
        }
    }));
}

function renderSearchCards(cars) {
    const grid = document.getElementById('results-grid');
    const totalEl = document.getElementById('results-total');
    const pagination = document.getElementById('pagination');
    if (!grid) return;
    if (pagination) pagination.innerHTML = '';
    const sorted = sortCars(cars);
    if (totalEl) totalEl.textContent = sorted.length.toLocaleString('de-DE');
    if (!sorted.length) {
        grid.innerHTML = `<div class="no-results" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/merkliste_logos/favs_not_available.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div style="font-size:20px;font-weight:700;margin-bottom:6px">${tr('route_no_active_listings', 'Keine aktiven Inserate')}</div><div style="font-size:16px;">${tr('route_filter_adjust', 'Bitte passen Sie Ihre Filterkriterien an.')}</div></div>`;
        return;
    }
    grid.innerHTML = sorted.map(car => {
        const title = escapeHtml(car.title || 'Fahrzeug');
        const image = getCarPreviewImage(car);
        const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="${title}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="font-size:58px;line-height:1">🚗</div>';
        const carId = escapeHtml(String(car.id || ''));
        const favoriteActive = favoriteCarIdsCache.has(String(car.id || ''));
        return `<a href="index.html?view=car-detail&id=${encodeURIComponent(String(car.id || ''))}" class="car-card-link car-card catalog-list-item" data-id="${carId}" style="display:block;text-decoration:none;color:inherit">
            <div class="car-img-wrap">${imageMarkup}</div>
            <div class="car-body">
                <div class="catalog-list-middle">
                    <div class="catalog-grid-header catalog-car-grid-header">
                        <div class="catalog-grid-price">${renderPriceBadge(car)}</div>
                        <div class="catalog-grid-status">${statusBadge(car.status)}</div>
                    </div>
                    <div class="car-name">${title}</div>
                    <div class="car-spec-row">
                        <div class="car-spec">${escapeHtml(car.year || '—')}</div>
                        <div class="car-spec">${formatNumber(car.mileage)} km</div>
                        <div class="car-spec">${escapeHtml(car.make || car.brand || '—')}</div>
                    </div>
                    ${renderListingSellerLink(car)}
                </div>
                <div class="catalog-list-side">
                    <div class="catalog-list-price">${renderPriceBadge(car)}</div>
                    <div class="catalog-list-status">${statusBadge(car.status)}</div>
                    <div class="catalog-list-actions">
                        <button type="button" class="catalog-list-action${favoriteActive ? ' active' : ''}" data-list-favorite="${carId}" onclick="window.toggleFavoriteCar('${carId}', event)">${favoriteActive ? '♥' : '♡'} ${t(favoriteActive ? 'btn_saved' : 'btn_save')}</button>
                    </div>
                </div>
            </div>
        </a>`;
    }).join('');
    void hydrateCatalogSellerProfiles(grid);
}

function renderHomeListingCards(cars) {
    const grid = document.getElementById('home-cars-grid');
    if (!grid) return;
    const sorted = sortCars(cars);
    const displayCars = sorted.slice(0, 8);
    if (!sorted.length) {
        grid.innerHTML = '<div class="no-results" style="grid-column:1/-1"><div class="no-results-icon">🚘</div><div style="font-size:16px;font-weight:600;margin-bottom:6px">Noch keine Listings verfügbar</div></div>';
        return;
    }
    grid.innerHTML = displayCars.map(car => {
        const title = escapeHtml(car.title || 'Fahrzeug');
        const image = getCarPreviewImage(car);
        const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="${title}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="font-size:58px;line-height:1">🚗</div>';
        return `<a href="index.html?view=car-detail&id=${encodeURIComponent(String(car.id || ''))}" class="car-card-link car-card homepage-listing-card" data-id="${escapeHtml(String(car.id || ''))}" style="display:block;text-decoration:none;color:inherit">
            <div class="car-img-wrap">${imageMarkup}</div>
            <div class="car-body">
                <div class="car-price">${renderPriceBadge(car)}</div>
                <div class="car-name">${title}</div>
                <div class="car-spec-row"><div class="car-spec">${escapeHtml(car.year || '—')}</div><div class="car-spec">${formatNumber(car.mileage)} km</div></div>
            </div>
        </a>`;
    }).join('');
}

function normalizeFeatureState(rawFeatures) {
    const emptyGroups = Object.fromEntries(FEATURE_GROUP_ORDER.map(group => [group, []]));
    const grouped = Object.fromEntries(FEATURE_GROUP_ORDER.map(group => [group, []]));
    const flatValues = [];
    const appendValue = (value, preferredGroup) => {
        const normalized = String(value || '').trim();
        if (!normalized) return;
        if (!flatValues.includes(normalized)) flatValues.push(normalized);
        const mappedGroup = preferredGroup && AUSSTATTUNG_CATEGORIES[preferredGroup] ? preferredGroup : FEATURE_TO_GROUP[normalized];
        if (!mappedGroup) return;
        if (!grouped[mappedGroup].includes(normalized)) {
            grouped[mappedGroup].push(normalized);
        }
    };
    if (Array.isArray(rawFeatures)) {
        rawFeatures.forEach(value => appendValue(value, ''));
    } else if (rawFeatures && typeof rawFeatures === 'object') {
        Object.entries(rawFeatures).forEach(([group, values]) => {
            if (!Array.isArray(values)) return;
            values.forEach(value => appendValue(value, group));
        });
    }
    const byCategory = Object.fromEntries(
        FEATURE_GROUP_ORDER.map(group => [group, grouped[group].length ? grouped[group] : emptyGroups[group]])
    );
    return { byCategory, flat: flatValues };
}

function getSelectedFeatureState(containerSelector, inputName) {
    const selectedInputs = Array.from(document.querySelectorAll(`${containerSelector} input[name="${inputName}"]:checked`));
    const flat = selectedInputs
        .map(input => String(input.value || '').trim())
        .filter(Boolean);
    const byCategory = Object.fromEntries(FEATURE_GROUP_ORDER.map(group => [group, []]));
    selectedInputs.forEach(input => {
        const feature = String(input.value || '').trim();
        const group = String(input.getAttribute('data-feature-group') || FEATURE_TO_GROUP[feature] || '');
        if (!feature || !AUSSTATTUNG_CATEGORIES[group]) return;
        if (!byCategory[group].includes(feature)) {
            byCategory[group].push(feature);
        }
    });
    return { byCategory, flat };
}

function renderDetailFeatures(car) {
    const target = document.getElementById('d-features');
    if (!target) return;
    const groupKeys = {
        'Komfort & Innenausstattung': 'comfort_interior',
        'Sicherheit & Assistenz': 'safety_assistance',
        'Unterhaltung & Media': 'entertainment_media',
        'Exterieur & Licht': 'filter_exterior'
    };
    const featureKeys = {
        Klimaanlage: 'filter_air_conditioning', Klimaautomatik: 'filter_climate_control', Sitzheizung: 'filter_heated_seats',
        Navigationssystem: 'filter_navigation', Tempomat: 'filter_cruise_control', Multifunktionslenkrad: 'filter_multifunction_steering',
        'Elektr. Fensterheber': 'filter_power_windows', 'Panorama-Dach': 'filter_panoramic_roof', Standheizung: 'filter_auxiliary_heater',
        ABS: 'filter_abs', ESP: 'filter_esp', Isofix: 'filter_isofix', 'Totwinkel-Assistent': 'filter_blind_spot',
        Spurhalteassistent: 'filter_lane_assist', Notbremsassistent: 'filter_emergency_braking', Verkehrszeichenerkennung: 'filter_traffic_signs',
        Bluetooth: 'feature_bluetooth', Freisprecheinrichtung: 'feature_hands_free', 'Apple CarPlay': 'feature_carplay', 'Android Auto': 'feature_android_auto',
        Soundsystem: 'feature_sound_system', 'Radio/DAB': 'feature_radio', Leichtmetallfelgen: 'feature_alloy_wheels', 'LED-Scheinwerfer': 'feature_led',
        Xenonscheinwerfer: 'feature_xenon', Kurvenlicht: 'feature_cornering', Anhängerkupplung: 'feature_towbar', Schiebedach: 'feature_sunroof'
    };
    const localizeFeature = feature => featureKeys[feature] ? t(featureKeys[feature]) : feature;
    const featureState = normalizeFeatureState(car.featuresByCategory || car.ausstattung || car.features);
    const groupedMarkup = FEATURE_GROUP_ORDER
        .filter(group => featureState.byCategory[group].length)
        .map(group => `<div class="features-group">
            <div class="features-group-title" data-t="${groupKeys[group] || ''}">${escapeHtml(t(groupKeys[group]) || group)}</div>
            <div class="features-group-items">${featureState.byCategory[group].map(feature => `<div class="feat-chip"><span class="feat-chip-icon">✓</span> <span${featureKeys[feature] ? ` data-t="${featureKeys[feature]}"` : ''}>${escapeHtml(localizeFeature(feature))}</span></div>`).join('')}</div>
        </div>`)
        .join('');
    const knownFeatures = new Set(FEATURE_GROUP_ORDER.flatMap(group => featureState.byCategory[group]));
    const uncategorized = featureState.flat.filter(feature => !knownFeatures.has(feature));
    const uncategorizedMarkup = uncategorized.length
        ? `<div class="features-group"><div class="features-group-items">${uncategorized.map(feature => `<div class="feat-chip"><span class="feat-chip-icon">✓</span> <span${featureKeys[feature] ? ` data-t="${featureKeys[feature]}"` : ''}>${escapeHtml(localizeFeature(feature))}</span></div>`).join('')}</div></div>`
        : '';
    target.innerHTML = (groupedMarkup || uncategorizedMarkup)
        ? `${groupedMarkup}${uncategorizedMarkup}`
        : `<div style="color:var(--gray-500);font-size:13px">${tr('no_features', 'Keine Ausstattung angegeben.')}</div>`;
}

function renderDetailSpecTable(car) {
    const target = document.getElementById('d-spec-table');
    const container = target?.closest('.fahrzeugdaten-section');
    if (!target) return;
    const textValue = value => escapeHtml(String(value ?? '').trim() || '-');
    const valueKeys = {
        Silber: 'sell_color_silver', Silver: 'sell_color_silver',
        Van: 'body_van', Manual: 'trans_manual', Manuell: 'trans_manual',
        'Erdgas (CNG)': 'fuel_cng', CNG: 'fuel_cng'
    };
    const localizeValue = value => {
        const normalized = String(value ?? '').trim();
        return valueKeys[normalized] ? t(valueKeys[normalized]) : normalized;
    };
    const mileage = Number(car.mileage ?? car.km ?? 0);
    const horsepower = Number(car.hp || car.powerHp || 0);
    const specs = [
        ['spec_make', car.brand || car.make],
        ['spec_body', localizeValue(car.body || car.bodyType || car.karosserie)],
        ['spec_model', car.model],
        ['spec_color', localizeValue(car.color || car.exteriorColor || car.farbe)],
        ['spec_first_registration', car.year || car.erstzulassung],
        ['spec_power', horsepower > 0 ? `${horsepower} PS` : ''],
        ['spec_mileage', mileage > 0 ? `${formatNumber(mileage)} km` : ''],
        ['spec_doors', car.doors || car.tueren],
        ['spec_fuel', localizeValue(car.fuel || car.fuelType || car.kraftstoff)],
        ['spec_seats', parseInt(car.seats, 10) > 0 ? String(parseInt(car.seats, 10)) : ''],
        ['spec_transmission', localizeValue(car.transmission || car.trans || car.getriebe)],
        ['spec_vin', car.vin || car.fin]
    ];
    target.innerHTML = `
        <div class="specs-card-container">
            <h3 class="specs-card-title">${tr('detail_vehicle_data', 'Fahrzeugdaten')}</h3>
            <div class="specs-two-column-grid">
                ${specs.map(([key, value]) => `
                    <div class="spec-grid-row">
                        <span class="spec-item-label" data-t="${key}">${escapeHtml(t(key))}</span>
                        <span class="spec-item-value">${textValue(value)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    if (container) container.style.display = '';
}

// ═════════════════════════════════════════════════════════════
// DETAIL GALLERY WITH SCOPED EVENT LISTENERS (IIFE)
// Strict 2-column grid: 1 large left, 4 stacked thumbnails right
// ═════════════════════════════════════════════════════════════

(function initDetailGalleryIIFE() {
    const galleryState = {
        currentIndex: 0,
        totalImages: 0,
        images: []
    };

    function getCarImageList(car) {
        try {
            if (!car) return ['/placeholder.jpg'];
            
            // Normalize images: extract ALL uploaded images from Firebase
            // Do NOT read only the first image or cover photo
            const images = Array.isArray(car.images) && car.images.length > 0
                ? car.images.filter(img => img && String(img).trim())  // Filter out empty/null
                : (car.image ? [car.image] : []);  // Fallback to single image if available
            
            // Return either all images or placeholder
            return images.length > 0 ? images : ['/placeholder.jpg'];
        } catch (err) {
            console.error('Error getting car images:', err);
            return ['/placeholder.jpg'];
        }
    }

    function updateCounter() {
        try {
            const counter = document.getElementById('d-photo-count');
            if (counter) {
                counter.textContent = `< ${galleryState.currentIndex + 1} / ${galleryState.totalImages} >`;
            }
        } catch (err) {
            console.error('Error updating counter:', err);
        }
    }

    function renderMainImage() {
        try {
            const mainImg = document.getElementById('d-main-img');
            if (!mainImg) return;

            // Clear any loading spinner/hourglass injected by showCarDetailLoading()
            // then always create a fresh img element
            mainImg.innerHTML = '';
            const img = document.createElement('img');
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;cursor:pointer;';
            mainImg.appendChild(img);

            // Re-add the counter and actions elements that were also wiped
            if (!document.getElementById('d-photo-count')) {
                const counter = document.createElement('div');
                counter.className = 'gallery-counter';
                counter.id = 'd-photo-count';
                mainImg.appendChild(counter);
            }
            if (!document.getElementById('gallery-actions')) {
                const actions = document.createElement('div');
                actions.className = 'gallery-actions';
                actions.id = 'gallery-actions';
                mainImg.appendChild(actions);
            }

            const activeImage = galleryState.images[galleryState.currentIndex] || '/placeholder.jpg';
            const car = window.__detailCar || {};
            img.src = activeImage;
            img.alt = `${car.year || ''} ${car.make || ''} ${car.model || ''} - Fahrzeug Bild`.trim() || 'Fahrzeug Bild';
            img.style.display = 'block';

            updateCounter();
        } catch (err) {
            console.error('Error rendering main image:', err);
        }
    }

    function renderOverlayButtons() {
        try {
            const actionsContainer = document.getElementById('gallery-actions');
            if (!actionsContainer) {
                console.warn('gallery-actions container not found');
                return;
            }

            actionsContainer.innerHTML = `
                <button class="gallery-action-btn" title="${tr('gallery_print', 'Drucken')}" data-action="print">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                       <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v6H6z"/>
                   </svg>
                </button>
                <button class="gallery-action-btn" title="${tr('gallery_share', 'Teilen')}" data-action="share">
                   <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <path d="M22 2l-11 20-4-9-9-4 20-11z"/>
                   </svg>
                </button>
            `;

            // Scoped event listeners
            actionsContainer.querySelectorAll('.gallery-action-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                   e.stopPropagation();
                   try {
                       const action = btn.dataset.action;
                       if (action === 'print') {
                           window.print();
                       } else if (action === 'share') {
                           navigator.clipboard.writeText(window.location.href).then(() => {
                               if (typeof toast === 'function') {
                                   toast('Link in die Zwischenablage kopiert!', 'success');
                               }
                           }).catch(() => {
                               if (typeof toast === 'function') {
                                   toast('Fehler beim Kopieren des Links.', 'error');
                               }
                           });
                       }
                   } catch (err) {
                       console.error('Error handling overlay button click:', err);
                   }
                });
            });
        } catch (err) {
            console.error('Error rendering overlay buttons:', err);
        }
    }

    function renderThumbnailStack() {
        try {
            const thumbsStack = document.getElementById('d-thumbs');
            if (!thumbsStack) return;

            // showCarDetailLoading() wipes d-thumbs innerHTML, destroying slots.
            // Recreate the 4 slots if they are missing before populating them.
            let slots = thumbsStack.querySelectorAll('.thumb-slot');
            if (slots.length === 0) {
                thumbsStack.innerHTML =
                    '<button class="thumb-slot" type="button"></button>' +
                    '<button class="thumb-slot" type="button"></button>' +
                    '<button class="thumb-slot" type="button"></button>' +
                    '<button class="thumb-slot" type="button"></button>';
                slots = thumbsStack.querySelectorAll('.thumb-slot');
            }
            
            slots.forEach((slot, slotIdx) => {
                try {
                    const imageIdx = slotIdx + 1;  // Slots show images[1], images[2], images[3], images[4]
                    const image = galleryState.images[imageIdx];
                    
                    // Clear previous content
                    while (slot.firstChild) {
                        slot.removeChild(slot.firstChild);
                    }

                    if (image) {
                        const img = document.createElement('img');
                        img.src = image;  // raw URL – do NOT escapeHtml (Firebase URLs contain & chars)
                        img.alt = `Thumbnail ${imageIdx + 1}`;
                        img.style.cssText = 'width:100%;height:100%;object-fit:cover;';
                        slot.appendChild(img);
                        slot.dataset.imageIndex = imageIdx;
                    }

                    // 4th slot: Add overlay if more images exist
                    if (slotIdx === 3) {  // 4th slot (index 3)
                        if (galleryState.totalImages > 4) {
                            let overlay = slot.querySelector('.thumb-overlay');
                            if (!overlay) {
                                overlay = document.createElement('div');
                                overlay.className = 'thumb-overlay';
                                overlay.id = 'thumb-overlay-4';
                                slot.appendChild(overlay);
                            }
                            const remaining = galleryState.totalImages - 4;
                            overlay.innerHTML = `<div class="thumb-overlay-content">+${remaining}<br>${tr('gallery_all_photos', 'Alle Fotos anzeigen')}</div>`;
                            overlay.style.display = 'flex';
                        }
                        slot.dataset.imageIndex = 4;
                    }
                } catch (err) {
                    console.error('Error rendering thumbnail slot', slotIdx, ':', err);
                }
            });
        } catch (err) {
            console.error('Error rendering thumbnail stack:', err);
        }
    }

    function attachThumbnailListeners() {
        try {
            const thumbsStack = document.getElementById('d-thumbs');
            if (!thumbsStack) return;

            thumbsStack.querySelectorAll('.thumb-slot').forEach(slot => {
                slot.addEventListener('click', (e) => {
                    e.stopPropagation();
                    try {
                        const imageIdx = parseInt(slot.dataset.imageIndex || 0, 10);
                        openLightbox(imageIdx);
                    } catch (err) {
                        console.error('Error handling thumbnail click:', err);
                    }
                });
            });
        } catch (err) {
            console.error('Error attaching thumbnail listeners:', err);
        }
    }

    function attachMainImageListener() {
        try {
            const mainImg = document.getElementById('d-main-img');
            if (!mainImg) return;

            const img = mainImg.querySelector('img');
            if (img) {
                img.addEventListener('click', (e) => {
                    e.stopPropagation();
                    try {
                        openLightbox(galleryState.currentIndex);
                    } catch (err) {
                        console.error('Error handling main image click:', err);
                    }
                });
            }
        } catch (err) {
            console.error('Error attaching main image listener:', err);
        }
    }

    function ensureLightboxModal() {
        try {
            let lightbox = document.getElementById('detail-lightbox');
            if (lightbox) return lightbox;

            lightbox = document.createElement('div');
            lightbox.id = 'detail-lightbox';
            lightbox.className = 'detail-lightbox';
            lightbox.innerHTML = `
                <div class="lightbox-topbar">
                    <span class="lightbox-counter">1 / 1</span>
                    <button class="lightbox-close" title="${tr('close_with_icon', 'Schließen')}">✕ ${tr('close_with_icon', 'Schließen')}</button>
                </div>
                <div class="lightbox-body">
                    <img class="lightbox-image" src="" alt="" />
                    <button class="lightbox-nav lightbox-nav-prev" title="${tr('previous_image', 'Vorheriges Bild')}">❮</button>
                    <button class="lightbox-nav lightbox-nav-next" title="${tr('next_image', 'Nächstes Bild')}">❯</button>
                </div>
                <div class="lightbox-thumbs"></div>
            `;
            document.body.appendChild(lightbox);

            // Scoped event listeners
            const closeBtn = lightbox.querySelector('.lightbox-close');
            const prevBtn = lightbox.querySelector('.lightbox-nav-prev');
            const nextBtn = lightbox.querySelector('.lightbox-nav-next');

            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeLightbox();
                });
            }

            if (prevBtn) {
                prevBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    stepLightbox(-1);
                });
            }

            if (nextBtn) {
                nextBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    stepLightbox(1);
                });
            }

            // Close on overlay click
            lightbox.addEventListener('click', (e) => {
                if (e.target === lightbox) closeLightbox();
            });

            return lightbox;
        } catch (err) {
            console.error('Error creating lightbox modal:', err);
            return null;
        }
    }

    function openLightbox(startIndex = 0) {
        try {
            const lightbox = ensureLightboxModal();
            if (!lightbox) return;
            
            galleryState.currentIndex = Math.max(0, Math.min(startIndex, galleryState.totalImages - 1));
            updateLightboxDisplay();
            renderLightboxThumbnails();
            lightbox.classList.add('open');
            document.body.style.overflow = 'hidden';
        } catch (err) {
            console.error('Error opening lightbox:', err);
        }
    }

    function updateLightboxDisplay() {
        try {
            const lightbox = document.getElementById('detail-lightbox');
            if (!lightbox) return;

            const img = lightbox.querySelector('.lightbox-image');
            const counter = lightbox.querySelector('.lightbox-counter');

            if (img) {
                img.src = galleryState.images[galleryState.currentIndex] || '';  // raw URL – no escapeHtml
                const car = window.__detailCar || {};
                img.alt = `${car.year || ''} ${car.make || ''} ${car.model || ''} - Fahrzeug Bild ${galleryState.currentIndex + 1}`.trim() || 'Fahrzeug Bild';
            }
            if (counter) counter.textContent = `${galleryState.currentIndex + 1} / ${galleryState.totalImages}`;
        } catch (err) {
            console.error('Error updating lightbox display:', err);
        }
    }

    function renderLightboxThumbnails() {
        try {
            const lightbox = document.getElementById('detail-lightbox');
            if (!lightbox) return;

            const thumbRow = lightbox.querySelector('.lightbox-thumbs');
            if (!thumbRow) return;

            thumbRow.innerHTML = galleryState.images.map((imgUrl, idx) => `
                <button class="lightbox-thumb ${idx === galleryState.currentIndex ? 'active' : ''}" data-idx="${idx}" type="button">
                    <img src="${escapeHtml(imgUrl)}" alt="Thumbnail ${idx + 1}" style="width:100%;height:100%;object-fit:cover;" />
                </button>
            `).join('');

            // Scoped click listeners for thumbnails
            thumbRow.querySelectorAll('.lightbox-thumb').forEach(thumb => {
                thumb.addEventListener('click', (e) => {
                    e.stopPropagation();
                    try {
                        galleryState.currentIndex = parseInt(thumb.dataset.idx, 10);
                        updateLightboxDisplay();
                        renderLightboxThumbnails();
                    } catch (err) {
                        console.error('Error handling lightbox thumbnail click:', err);
                    }
                });
            });
        } catch (err) {
            console.error('Error rendering lightbox thumbnails:', err);
        }
    }

    function stepLightbox(direction) {
        try {
            galleryState.currentIndex = Math.max(0, Math.min(galleryState.totalImages - 1, galleryState.currentIndex + direction));
            updateLightboxDisplay();
            renderLightboxThumbnails();
        } catch (err) {
            console.error('Error stepping lightbox:', err);
        }
    }

    function closeLightbox() {
        try {
            const lightbox = document.getElementById('detail-lightbox');
            if (lightbox) {
                lightbox.classList.remove('open');
                document.body.style.overflow = '';
            }
        } catch (err) {
            console.error('Error closing lightbox:', err);
        }
    }

    function renderDetailGallery(car, selectedIndex = 0) {
        const container = document.getElementById('detail-gallery-container');
        if (!container) return;

        container.innerHTML = '';

        let images = [];
        if (Array.isArray(car?.images) && car.images.length > 0) {
            images = car.images;
        } else if (Array.isArray(car?.imageUrls) && car.imageUrls.length > 0) {
            images = car.imageUrls;
        } else if (typeof car?.images === 'string') {
            images = car.images.split(',').map(s => s.trim());
        } else if (car?.image) {
            images = [car.image];
        } else {
            images = ['/placeholder.jpg'];
        }

        images = images.map(getSafeCloudinaryImageUrl).filter(Boolean);
        if (!images.length) {
            images = ['/placeholder.jpg'];
        }
        const totalCount = images.length;
        const thumbImages = images.slice(1, 5);
        let activeIndex = Math.max(0, Math.min(selectedIndex, totalCount - 1));

        // Sync galleryState so the IIFE lightbox functions still work
        galleryState.images = images;
        galleryState.totalImages = totalCount;
        galleryState.currentIndex = activeIndex;
        window.__detailCar = car;
        window.__detailCarImages = images;
        window.galleryImagesList = images;
        window.__detailMainGalleryIndex = activeIndex;

        window.changeMainGalleryImage = function(direction) {
            const galleryImages = window.galleryImagesList || [];
            if (!galleryImages.length) return;

            const current = Number(window.__detailMainGalleryIndex || 0);
            const nextIndex = (current + direction + galleryImages.length) % galleryImages.length;
            const mainImage = document.getElementById('main-gallery-img');
            const currentIndexLabel = document.getElementById('current-img-index');

            window.__detailMainGalleryIndex = nextIndex;
            galleryState.currentIndex = nextIndex;

            if (mainImage) {
                mainImage.src = galleryImages[nextIndex];
            }
            if (currentIndexLabel) {
                currentIndexLabel.textContent = String(nextIndex + 1);
            }
        };

        container.innerHTML = `
            <style>
                #detail-gallery-container {
                    display: grid !important;
                    grid-template-columns: 1fr 250px !important;
                    gap: 10px !important;
                    height: 430px !important;
                    max-height: 430px !important;
                    width: 100% !important;
                    position: relative;
                    box-sizing: border-box;
                    overflow: hidden;
                }
                .main-gallery-card {
                    position: relative;
                    width: 100%;
                    height: 430px !important;
                    border-radius: 12px;
                    overflow: hidden;
                    cursor: pointer;
                    background: #111;
                }
                .main-gallery-card img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover !important;
                    display: block;
                }
                .gallery-action-group {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    display: flex;
                    gap: 8px;
                    z-index: 10;
                }
                .action-circle-btn {
                    width: 38px;
                    height: 38px;
                    border-radius: 50%;
                    background: rgba(255, 255, 255, 0.9);
                    border: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                    font-size: 15px;
                    line-height: 1;
                    padding: 0;
                }
                .action-circle-btn svg, .action-circle-btn span {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .gallery-counter-tag {
                    position: absolute;
                    bottom: 16px;
                    right: 16px;
                    background: rgba(0, 0, 0, 0.75);
                    color: #ffffff;
                    padding: 6px 16px;
                    border-radius: 24px;
                    font-size: 16px;
                    font-weight: 600;
                    z-index: 10;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    user-select: none;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
                }
                .gallery-nav-arrow {
                    cursor: pointer;
                    font-size: 20px;
                    font-weight: 700;
                    padding: 0 4px;
                    transition: transform 0.1s ease, color 0.1s ease;
                }
                .gallery-nav-arrow:hover {
                    color: #ffcc00;
                    transform: scale(1.25);
                }
                .side-thumb-stack {
                    display: grid;
                    grid-template-rows: repeat(4, 100px);
                    gap: 10px;
                    height: 430px !important;
                }
                .thumb-item-box {
                    position: relative;
                    width: 100%;
                    height: 100px !important;
                    border-radius: 8px;
                    overflow: hidden;
                    cursor: pointer;
                    background: #e9ecef;
                }
                .thumb-item-box img {
                    width: 100%;
                    height: 100%;
                    object-fit: cover !important;
                    display: block;
                }
                .all-photos-mask {
                    position: absolute;
                    inset: 0;
                    background: rgba(0, 0, 0, 0.65);
                    color: #ffffff;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    font-weight: 600;
                    font-size: 12px;
                    gap: 2px;
                    text-align: center;
                }
                @media (max-width: 991px) {
                    #detail-gallery-container {
                        grid-template-columns: 1fr !important;
                        height: 320px !important;
                    }
                    .side-thumb-stack { display: none !important; }
                    .main-gallery-card { height: 320px !important; }
                }
            </style>

            <div class="main-gallery-card media-container" onclick="openFullscreenLightbox(window.__detailMainGalleryIndex || 0)">
                ${statusBadgeOverlay(car?.status || 'active')}
                <img id="main-gallery-img" src="${escapeHtml(images[activeIndex])}" alt="Car detail photo" />
                <div class="gallery-action-group">
                    <button class="action-circle-btn" title="${tr('gallery_print', 'Drucken')}" onclick="event.stopPropagation(); window.print();">
                    <img src="etc_logos/sell_page_logos/printer.svg" alt="${tr('gallery_print', 'Drucken')}" style="width: 20px; height: 20px; object-fit: contain;">
                    </button>
                    <button class="action-circle-btn" title="${tr('gallery_share', 'Teilen')}" onclick="event.stopPropagation(); navigator.clipboard.writeText(window.location.href).then(() => alert('${tr('link_copied', 'Link kopiert!')}'));">
                    <img src="etc_logos/sell_page_logos/link.svg" alt="${tr('gallery_share', 'Teilen')}" style="width: 20px; height: 20px; object-fit: contain;">
                    </button>
                </div>
                <div class="gallery-counter-tag">
                    <span
                        id="prev-img-btn"
                        class="gallery-nav-arrow"
                        onclick="event.stopPropagation(); window.changeMainGalleryImage(-1)"
                    >‹</span>
                    <span id="current-img-index">${activeIndex + 1}</span>
                    <span>/</span>
                    <span>${totalCount}</span>
                    <span
                        id="next-img-btn"
                        class="gallery-nav-arrow"
                        onclick="event.stopPropagation(); window.changeMainGalleryImage(1)"
                    >›</span>
                </div>
            </div>

            <div class="side-thumb-stack">
                ${[0, 1, 2, 3].map(i => {
                    const imgUrl = thumbImages[i];
                    const isFourth = i === 3;
                    const remaining = totalCount - 4;

                    if (!imgUrl) return `<div class="thumb-item-box"></div>`;

                    return `
                        <div class="thumb-item-box" onclick="openFullscreenLightbox(${i + 1})">
                            <img src="${escapeHtml(imgUrl)}" alt="Thumbnail ${i + 1}" />
                            ${isFourth && remaining > 0 ? `
                                <div class="all-photos-mask">
                                    <span style="font-size:16px">+</span>
                                    <span>+${remaining} ${tr('gallery_all_photos', 'Alle Fotos anzeigen')}</span>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function selectDetailImage(index) {
        try {
            if (!window.__detailCar) {
                console.warn('selectDetailImage: window.__detailCar is not set');
                return;
            }
            renderDetailGallery(window.__detailCar, index);
        } catch (err) {
            console.error('Error in selectDetailImage:', err);
        }
    }

    // Export to global scope
    window.selectDetailImage = selectDetailImage;
    window.__detailGalleryController = {
        renderDetailGallery,
        selectDetailImage,
        openLightbox,
        closeLightbox
    };

})();

// Stub for backward compatibility
function openLightboxImage(url) {
    // Parts use their own lightbox; this is a no-op for car gallery
}

window.openFullscreenLightbox = function(startIndex = 0) {
    let currentIndex = startIndex;
    const images = window.galleryImagesList || [];
    if (!images.length) return;

    let modal = document.getElementById('custom-lightbox-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'custom-lightbox-modal';
        document.body.appendChild(modal);
    }

    const updateLightbox = () => {
        modal.innerHTML = `
            <div style="position:fixed; inset:0; background:#000; z-index:99999; display:flex; flex-direction:column; justify-content:space-between; padding:20px;">
                <div style="display:flex; justify-content:space-between; color:#fff; font-size:16px;">
                    <div>${currentIndex + 1} / ${images.length}</div>
                    <div style="cursor:pointer;" onclick="document.getElementById('custom-lightbox-modal').style.display='none'">✕ Schließen</div>
                </div>
                
                <div style="position:relative; display:flex; align-items:center; justify-content:center; flex:1;">
                    <button style="position:absolute; left:10px; background:rgba(255,255,255,0.2); color:#fff; border:none; padding:15px; cursor:pointer; font-size:20px;" onclick="changeLightboxImg(-1)">❮</button>
                    <img src="${escapeHtml(images[currentIndex])}" style="max-height:75vh; max-width:80vw; object-fit:contain;" />
                    <button style="position:absolute; right:10px; background:rgba(255,255,255,0.2); color:#fff; border:none; padding:15px; cursor:pointer; font-size:20px;" onclick="changeLightboxImg(1)">❯</button>
                </div>

                <div style="display:flex; gap:10px; overflow-x:auto; padding-top:10px; justify-content:center;">
                    ${images.map((img, i) => `
                        <img src="${escapeHtml(img)}" style="width:60px; height:45px; object-fit:cover; cursor:pointer; border:${i === currentIndex ? '2px solid #ffcc00' : '2px solid transparent'};" onclick="setLightboxImg(${i})" />
                    `).join('')}
                </div>
            </div>
        `;
    };

    window.changeLightboxImg = function(dir) {
        currentIndex = (currentIndex + dir + images.length) % images.length;
        updateLightbox();
    };

    window.setLightboxImg = function(index) {
        currentIndex = index;
        updateLightbox();
    };

    modal.style.display = 'block';
    updateLightbox();
};

// Export renderDetailGallery and selectDetailImage to window scope
// This allows inline functions like openDetail() to call it
window.renderDetailGallery = function(car, activeIndex = 0) {
    try {
        if (window.__detailGalleryController) {
            window.__detailGalleryController.renderDetailGallery(car, activeIndex);
        } else {
            console.warn('Gallery controller not initialized yet');
        }
    } catch (err) {
        console.error('Error calling window.renderDetailGallery:', err);
    }
};
window.updateHomeModels = updateHomeModels;
window.updateFilterModels = updateFilterModels;
window.updateSellModels = updateSellModels;
window.filterMakeAndGo = filterMakeAndGo;
window.syncSellTermsCheckboxState = syncSellTermsCheckboxState;

window.selectDetailImage = function(index) {
    try {
        if (window.__detailGalleryController) {
            window.__detailGalleryController.selectDetailImage(index);
        }
    } catch (err) {
        console.error('Error calling window.selectDetailImage:', err);
    }
};

function shouldOpenLinkInNewTab(event) {
    if (!event) return false;
    if (event.defaultPrevented) return false;
    if (event.target && event.target.closest('.lang-btn')) return false;
    if (event.target && event.target.closest('.btn-sell-nav')) return false;
    if (event.target && event.target.closest('#btn-add-part')) return false;
    if (event.target && event.target.closest('[data-action="settings"]')) return false;
    return event.ctrlKey || event.metaKey || event.button === 1;
}

function handleUniversalCardClick(e, targetUrl, callback) {
    if (!e) return false;
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        if (targetUrl) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
        return true;
    }
    if (typeof callback === 'function') {
        callback(e);
    }
    return false;
}

function openTargetUrlSafely(targetUrl, event) {
    if (!targetUrl) return false;
    if (event && shouldOpenLinkInNewTab(event)) {
        event.preventDefault();
        event.stopPropagation();
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
        return true;
    }
    return false;
}

function handleCarCardClick(event, carOrId) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof carOrId === 'object' && carOrId) {
        const targetUrl = `index.html?view=car-detail&id=${encodeURIComponent(String(carOrId.id || ''))}`;
        if (openTargetUrlSafely(targetUrl, event)) return;
        openCarDetail(carOrId);
        return;
    }
    const targetUrl = `index.html?view=car-detail&id=${encodeURIComponent(String(carOrId || ''))}`;
    if (openTargetUrlSafely(targetUrl, event)) return;
    if (typeof openCarDetailById === 'function') {
        openCarDetailById(carOrId);
    }
}

function showCarDetailLoading() {
    const titleEl = document.getElementById('d-title');
    const breadcrumbEl = document.getElementById('d-breadcrumb-title');
    const descriptionEl = document.getElementById('d-description');
    const priceEl = document.getElementById('d-price-main');
    const mainImgEl = document.getElementById('d-main-img');
    const thumbsEl = document.getElementById('d-thumbs');
    if (titleEl) titleEl.textContent = 'Fahrzeug wird geladen...';
    if (breadcrumbEl) breadcrumbEl.textContent = 'Fahrzeug wird geladen...';
    if (descriptionEl) descriptionEl.textContent = 'Bitte warten Sie einen Moment.';
    if (priceEl) priceEl.textContent = '...';
    if (mainImgEl) mainImgEl.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><img src="etc_logos/merkliste_logos/hourglass.svg" alt="" style="width:72px;height:72px;object-fit:contain;"></div>';
    if (thumbsEl) thumbsEl.innerHTML = '';
    const reportEl = document.getElementById('d-condition-report');
    if (reportEl) {
        reportEl.hidden = true;
        reportEl.innerHTML = '';
    }
    activatePage('detail');
}

function formatDetailReportValue(value, fallback = '—') {
    const normalized = String(value ?? '').trim();
    return normalized ? escapeHtml(normalized) : fallback;
}

const REPORT_TEXT_KEYS = {
    'Grundlegende Fahrzeuginformationen': 'sec_basic_info',
    'Allgemeiner Fahrzeugzustand': 'sec_general_condition',
    'Unfall- & Karosseriehistorie': 'sec_accident_body',
    'Detaillierter Zustandsbericht der Baugruppen': 'sec_detailed_inspection',
    'Gutachter-Bemerkungen & Prüfvermerk': 'report_expert_section',
    'Motor': 'cat_motor',
    'Kraftübertragung & Getriebe': 'cat_transmission',
    'Kraftübertragungssystem': 'cat_drivetrain',
    'Lenkung & Fahrwerk': 'cat_steering_suspension',
    'Bremsanlage': 'cat_brake_system',
    'Elektrik & Bordsysteme': 'cat_electrical_systems',
    'Kraftstoffsystem': 'cat_fuel_system',
    'Amtliches Kennzeichen': 'lbl_license_plate',
    'HU / TÜV Gültigkeit von': 'lbl_tuv_from',
    'HU / TÜV gültig von': 'lbl_tuv_from',
    'HU / TÜV Gültigkeit bis': 'lbl_tuv_until',
    'HU / TÜV gültig bis': 'lbl_tuv_until',
    'Garantie-Typ': 'lbl_warranty_type',
    'Eigener Schadensaufwand': 'lbl_own_damage_cost',
    'Besondere Hinweise / Nutzungshistorie': 'lbl_special_notes',
    'Tatsächlicher Kilometerstand': 'lbl_actual_mileage',
    'Fahrgestellnummer-Zustand': 'lbl_vin_condition',
    'Unfallhistorie': 'lbl_accident_history',
    'Karosseriereparatur / Austausch': 'lbl_body_repair',
    'Strukturelle Rahmenreparatur': 'lbl_structural_repair',
    'Gutachter-Bemerkungen': 'lbl_expert_remarks',
    'Prüfer': 'lbl_inspector',
    'Prüfdatum': 'lbl_inspection_date',
    'Kilometerstand-Messung': 'mileage_measurement',
    'Abgasemissionen CO (%)': 'co_emissions',
    'Abgasemissionen HC (ppm)': 'hc_emissions',
    'Tuning / Umbauten': 'tuning_mods',
    'Sondernutzung / Historie': 'special_use',
    'Farbe & Lackierung': 'color_paint',
    'Wichtigste Ausstattung': 'main_equipment',
    'Rückrufaktion (Recall)': 'recall',
    'Laufverhalten & Leerlauf': 'idle_behavior',
    'Ölleckage Zylinderkopfdeckel': 'lbl_oil_leak_valve_cover',
    'Ölleckage - Zylinderkopfdeckel': 'lbl_oil_leak_valve_cover',
    'Ölleckage Zylinderkopfdichtung': 'lbl_oil_leak_head_gasket',
    'Ölleckage - Zylinderkopfdichtung': 'lbl_oil_leak_head_gasket',
    'Ölleckage Ölwanne': 'lbl_oil_leak_oil_pan',
    'Ölleckage - Ölwanne': 'lbl_oil_leak_oil_pan',
    'Motorölstand & Öldruck': 'lbl_oil_level_pressure',
    'Kühlmittelleckage Zylinderkopf': 'lbl_coolant_leak_head',
    'Kühlmittelleckage Kühler': 'lbl_coolant_leak_radiator',
    'Kühlmittelleckage - Zylinderkopf': 'lbl_coolant_leak_head',
    'Kühlmittelleckage - Radiator': 'lbl_coolant_leak_radiator',
    'Kühlmittelleckage Wasserpumpe': 'lbl_coolant_leak_water_pump',
    'Kühlmittelleckage - Wasserpumpe': 'lbl_coolant_leak_water_pump',
    'Kühlmittelstand': 'lbl_coolant_level',
    'Automatikgetriebe Ölleckage': 'lbl_auto_trans_leak',
    'Automatikgetriebe - Ölleckage': 'lbl_auto_trans_leak',
    'Ölstand & Zustandsprüfung': 'lbl_oil_level_condition',
    'Automatikgetriebe - Ölstand & Zustandsprüfung': 'lbl_oil_level_condition',
    'Schaltfunktion & Kupplungsdruck': 'lbl_shift_func_clutch',
    'Schaltgetriebe Ölleckage': 'lbl_manual_trans_leak',
    'Schaltgetriebe - Ölleckage': 'lbl_manual_trans_leak',
    'Kupplungsscheibe & Druckplatte': 'lbl_clutch_disc_plate',
    'Antriebswelle & CV-Gelenke': 'lbl_drive_shaft_cv',
    'Radlager & Achsschenkel': 'lbl_wheel_bearing_knuckle',
    'Differenzialgetriebe': 'lbl_differential',
    'Lenkgetriebe Ölleckage': 'lbl_steering_gear_leak',
    'Lenkgetriebe - Ölleckage': 'lbl_steering_gear_leak',
    'Lenkgetriebe & Spurstangenköpfe': 'lbl_steering_tie_rods',
    'Servopumpe & Antriebsriemen': 'lbl_servo_pump_belts',
    'Achsmanschetten & Kugelgelenke': 'lbl_axle_boots_joints',
    'Hauptbremszylinder Leckage': 'lbl_master_cylinder_leak',
    'Hauptbremszylinder - Leckage': 'lbl_master_cylinder_leak',
    'Bremsflüssigkeitsstand & Qualität': 'lbl_brake_fluid_quality',
    'Bremsverstärker & Unterdrucksystem': 'lbl_brake_booster_vacuum',
    'Lichtmaschine / Generator': 'lbl_alternator_generator',
    'Anlasser / Startermotor': 'lbl_starter_motor',
    'Scheibenwischermotor': 'lbl_wiper_motor',
    'Gebläsemotor / Lüftungsanlage': 'lbl_blower_hvac',
    'Kühlventilator / Radiatorlüfter': 'lbl_radiator_fan',
    'Elektrische Fensterheber': 'lbl_power_windows',
    'Kraftstoffleitung / Dichtigkeit': 'lbl_fuel_line_tightness'
};

Object.assign(REPORT_TEXT_KEYS, {
    'Dane pojazdu': 'review_vehicle_data',
    'Opis': 'desc_title',
    'Wyposażenie i dodatki': 'features_title',
    'Fahrzeugbewertung': 'step2_title',
    'Cena': 'sf_price',
    'Cena do negocjacji': 'price_negotiable',
    'Stan': 'part_condition',
    'Raport stanu pojazdu': 'review_condition_report',
    'Brak oznaczeń.': 'report_no_marks',
    'Raport kontroli pojazdu': 'report_inspection',
    'Numer rejestracyjny': 'lbl_license_plate',
    'Przegląd ważny od': 'lbl_tuv_from',
    'Przegląd ważny do': 'lbl_tuv_until',
    'Koszt uszkodzeń własnych': 'lbl_own_damage_cost',
    'Uwagi specjalne / Historia użytkowania': 'lbl_special_notes',
    'Rodzaj paliwa': 'spec_fuel',
    'Skrzynia biegów': 'spec_transmission',
    'Rodzaj gwarancji': 'lbl_warranty_type',
    'Pomiar przebiegu': 'mileage_measurement',
    'Rzeczywisty przebieg': 'lbl_actual_mileage',
    'Stan numeru VIN': 'lbl_vin_condition',
    'Emisja spalin CO (%)': 'co_emissions',
    'Tuning / Modyfikacje': 'tuning_mods',
    'Użycie specjalne / Historia': 'special_use',
    'Kolor i lakier': 'color_paint',
    'Główne wyposażenie': 'main_equipment',
    'Akcja serwisowa (Recall)': 'recall',
    'Historia wypadków': 'lbl_accident_history',
    'Naprawa / Wymiana nadwozia': 'lbl_body_repair',
    'Naprawa konstrukcyjna ramy': 'lbl_structural_repair',
    'Praca silnika i bieg jałowy': 'idle_behavior',
    'Wyciek oleju - pokrywa zaworów': 'lbl_oil_leak_valve_cover',
    'Wyciek oleju - uszczelka głowicy': 'lbl_oil_leak_head_gasket',
    'Wyciek oleju - miska olejowa': 'lbl_oil_leak_oil_pan',
    'Poziom i ciśnienie oleju silnikowego': 'lbl_oil_level_pressure',
    'Wyciek płynu - chłodnica': 'lbl_coolant_leak_radiator',
    'Wyciek płynu - pompa wody': 'lbl_coolant_leak_water_pump',
    'Poziom płynu chłodniczego': 'lbl_coolant_level',
    'Automatyczna skrzynia - wyciek oleju': 'lbl_auto_trans_leak',
    'Automatyczna skrzynia - poziom i stan oleju': 'lbl_oil_level_condition',
    'Zmiana biegów i nacisk sprzęgła': 'lbl_shift_func_clutch',
    'Manualna skrzynia - wyciek oleju': 'lbl_manual_trans_leak',
    'Tarcza i docisk sprzęgła': 'lbl_clutch_disc_plate',
    'Wał napędowy i przeguby CV': 'lbl_drive_shaft_cv',
    'Łożyska kół i zwrotnice': 'lbl_wheel_bearing_knuckle',
    'Mechanizm różnicowy': 'lbl_differential',
    'Przekładnia kierownicza - wyciek oleju': 'lbl_steering_gear_leak',
    'Przekładnia kierownicza i końcówki drążków': 'lbl_steering_tie_rods',
    'Pompa wspomagania i paski': 'lbl_servo_pump_belts',
    'Osłony półosi i przeguby kulowe': 'lbl_axle_boots_joints',
    'Pompa hamulcowa - wyciek': 'lbl_master_cylinder_leak',
    'Poziom i jakość płynu hamulcowego': 'lbl_brake_fluid_quality',
    'Serwo hamulca i układ podciśnienia': 'lbl_brake_booster_vacuum',
    'Alternator / generator': 'lbl_alternator_generator',
    'Rozrusznik': 'lbl_starter_motor',
    'Silnik wycieraczek': 'lbl_wiper_motor',
    'Dmuchawa / wentylacja': 'lbl_blower_hvac',
    'Wentylator chłodnicy': 'lbl_radiator_fan',
    'Elektryczne szyby': 'lbl_power_windows',
    'Przewód paliwowy / szczelność': 'lbl_fuel_line_tightness',
    'Uwagi rzeczoznawcy': 'lbl_expert_remarks',
    'Rzeczoznawca': 'lbl_inspector',
    'Data inspekcji': 'lbl_inspection_date',
    'Zdjęcia': 'sell_step_photos',
    'Nie wybrano jeszcze zdjęć.': 'sell_no_photos',
    'Dane kontaktowe': 'sell_step_contact',
    'Ihr Name': 'your_name',
    'Telefon': 'phone',
    'Lokalizacja / kod pocztowy': 'sell_location'
});

function localizeReportText(value) {
    const key = REPORT_TEXT_KEYS[value];
    return key ? tr(key, value) : value;
}

function buildDetailReportRows(zustandsbericht, rows) {
    return rows.map(([label, key]) => `<div class="detail-report-row"><span class="detail-report-row-label">${escapeHtml(localizeReportText(label))}</span><span class="detail-report-row-value">${formatDetailReportValue(zustandsbericht[key])}</span></div>`).join('');
}

function buildDetailReportSection(zustandsbericht, section, isOpen = false) {
    if (Array.isArray(section.gruppen) && section.gruppen.length) {
        const groupsMarkup = section.gruppen.map(group => `<div class="detail-report-subgroup"><h5>${escapeHtml(localizeReportText(group.titel))}</h5><div class="detail-report-rows">${buildDetailReportRows(zustandsbericht, group.zeilen)}</div></div>`).join('');
        return `<details class="detail-report-accordion"${isOpen ? ' open' : ''}><summary>${escapeHtml(localizeReportText(section.titel))}</summary><div class="detail-report-accordion-body">${groupsMarkup}</div></details>`;
    }
    return `<details class="detail-report-accordion"${isOpen ? ' open' : ''}><summary>${escapeHtml(localizeReportText(section.titel))}</summary><div class="detail-report-accordion-body"><div class="detail-report-rows">${buildDetailReportRows(zustandsbericht, section.zeilen)}</div></div></details>`;
}

function renderDetailInspectionDiagram(diagramId, pins) {
    const label = tr(diagramId === 'inspection2' ? 'diagram_interior' : 'diagram_exterior', SELL_WIZARD_DIAGRAM_LABELS[diagramId] || diagramId);
    const markerHtml = pins.map(pin => `<span class="detail-report-pin" style="left:${Number(pin.x || 0)}%;top:${Number(pin.y || 0)}%;background:${escapeHtml(pin.colorCode || '#374151')}" title="${escapeHtml(pin.damageType || 'Schaden')}"></span>`).join('');
    const pinListHtml = pins.length
        ? pins.map(pin => `<span class="detail-report-pin-item"><span class="detail-report-pin-dot" style="background:${escapeHtml(pin.colorCode || '#374151')}"></span>${escapeHtml(localizedDamageType(pin.damageType || 'Beschädigung'))}</span>`).join('')
        : `<span class="detail-history-value">${tr('report_no_marks', 'Keine Markierungen vorhanden.')}</span>`;
    return `<div class="detail-report-diagram"><div class="detail-report-diagram-title">${escapeHtml(label)}</div><div class="detail-report-diagram-stage"><img src="./Inspection_Total/${diagramId === 'inspection2' ? 'inspection2.webp' : 'inspection1.webp'}" alt="${escapeHtml(label)}">${markerHtml}</div><div class="detail-report-pin-list">${pinListHtml}</div></div>`;
}

function buildDetailConditionReportMarkup(car) {
    const zustandsbericht = car?.zustandsbericht || {};
    const inspectionPins = Array.isArray(car?.inspectionPins) ? car.inspectionPins : (Array.isArray(car?.damagePins) ? car.damagePins : []);
    const groupedPins = {
        inspection1: inspectionPins.filter(pin => String(pin.diagramId || '') === 'inspection1'),
        inspection2: inspectionPins.filter(pin => String(pin.diagramId || '') === 'inspection2')
    };
    const sectionHtml = ZUSTANDSBERICHT_DETAIL_SEKTIONEN.map((section, index) => buildDetailReportSection(zustandsbericht, section, index === 0)).join('');
    return `<div class="detail-report-panel">
        <h3>${tr('report_title', 'Gebrauchtwagen-Zustandsbericht & Fahrzeughistorie')}</h3>
        <div class="detail-report-intro">${tr('report_intro', 'Die folgenden Angaben stammen direkt aus dem vom Verkäufer erfassten Zustandsbericht.')}</div>
        <div class="detail-history-grid">
            <div class="detail-history-card"><span class="detail-history-label">${tr('report_damage', 'Eigener Schadensaufwand')}</span><div class="detail-history-value">${formatDetailReportValue(zustandsbericht['zb-eigner-schaden'])}</div></div>
            <div class="detail-history-card"><span class="detail-history-label">${tr('report_history', 'Besondere Hinweise / Nutzungshistorie')}</span><div class="detail-history-value">${formatDetailReportValue(zustandsbericht['zb-historie-hinweise'])}</div></div>
        </div>
        <div class="diagrams-row">
            ${renderDetailInspectionDiagram('inspection1', groupedPins.inspection1)}
            ${renderDetailInspectionDiagram('inspection2', groupedPins.inspection2)}
        </div>
        <h4>${tr('report_inspection', 'Gebrauchtwagen-Prüfbericht')}</h4>
        ${sectionHtml}
    </div>`;
}

function renderDetailConditionReport(car) {
    const reportEl = document.getElementById('d-condition-report');
    if (!reportEl) return;
    const zustandsbericht = car?.zustandsbericht || {};
    const hasReport = Object.values(zustandsbericht).some(value => String(value ?? '').trim()) || (Array.isArray(car?.inspectionPins) && car.inspectionPins.length) || (Array.isArray(car?.damagePins) && car.damagePins.length);
    if (!hasReport) {
        reportEl.hidden = true;
        reportEl.innerHTML = '';
        return;
    }
    reportEl.hidden = false;
    reportEl.innerHTML = buildDetailConditionReportMarkup(car);
}

async function openDealerListings(car, options = {}) {
    const dealer = getDealerIdentity(car);
    if (!dealer.ownerId && !dealer.sellerName) {
        toast('Für dieses Inserat ist kein Händlerprofil verfügbar.', 'warning');
        return;
    }
    await openCarsSearchView(null, {
        dealerOwnerId: dealer.ownerId,
        dealerName: dealer.sellerName
    }, options);
    document.getElementById('results-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function readCachedCar(carId) {
    const memoryCar = allCarsCache.find(car => String(car.id || '') === String(carId));
    if (memoryCar) return memoryCar;
    try {
        const cacheValues = [
            sessionStorage.getItem('hs_all_cars_cache'),
            localStorage.getItem('hs_all_cars_cache')
        ];
        let cachedCar = null;
        for (const value of cacheValues) {
            const cachedCars = value ? JSON.parse(value) : [];
            if (Array.isArray(cachedCars)) {
                cachedCar = cachedCars.find(car => String(car.id || '') === String(carId)) || null;
            }
            if (cachedCar) break;
        }
        return cachedCar ? normalizeFirestoreCar({ id: cachedCar.id, data: () => cachedCar }) : null;
    } catch (error) {
        console.warn('Unable to read cached car:', error);
        return null;
    }
}

function writeCachedCar(car) {
    try {
        const cachedCars = JSON.parse(sessionStorage.getItem('hs_all_cars_cache') || '[]');
        const cars = Array.isArray(cachedCars) ? cachedCars : [];
        sessionStorage.setItem('hs_all_cars_cache', JSON.stringify([
            car,
            ...cars.filter(entry => String(entry.id || '') !== String(car.id || ''))
        ]));
    } catch (error) {
        console.warn('Unable to cache car detail:', error);
    }
}

async function refreshCarDetailInBackground(carId) {
    try {
        const snapshot = await getDocWithTimeout(doc(db, 'cars', carId), 5000);
        if (!snapshot.exists()) return;
        const latestCar = normalizeFirestoreCar(snapshot);
        writeCachedCar(latestCar);
        allCarsCache = [
            latestCar,
            ...allCarsCache.filter(car => String(car.id || '') !== String(carId))
        ];
        if (isPageActive('detail') && String(window.__detailCar?.id || '') === String(carId)) {
            window.__detailCar = latestCar;
            window.currentDetailId = latestCar.id;
            renderDetailPage(latestCar);
        }
    } catch (error) {
        console.warn('Background car refresh failed:', error);
    }
    void incrementCounter(carId, 'viewsCount');
}

async function openCarDetailById(carId, options = {}) {
    const normalizedId = decodeURIComponent(String(carId || '').trim());
    if (!normalizedId) return false;
    currentDetailOrigin = options.origin || (isPageActive('my-listings') ? 'my-listings' : 'search');
    if (options.pushHistory !== false) {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'car-detail');
        url.searchParams.delete('catalog');
        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
        url.searchParams.set('id', normalizedId);
        pushBrowserUrl(url, { state: { view: 'detail', id: normalizedId } });
    }
    const cachedCar = readCachedCar(normalizedId);
    if (cachedCar) {
        window.__detailCar = cachedCar;
        window.currentDetailId = cachedCar.id;
        renderDetailPage(cachedCar);
        activatePage('detail');
        void refreshCarDetailInBackground(normalizedId);
        return true;
    }
    showCarDetailLoading();
    try {
        const snapshot = await getDocWithTimeout(doc(db, 'cars', normalizedId), 5000);
        if (snapshot.exists()) {
            const car = normalizeFirestoreCar(snapshot);
            window.__detailCar = car;
            window.currentDetailId = car.id;
            writeCachedCar(car);
            allCarsCache = [
                car,
                ...allCarsCache.filter(entry => String(entry.id || '') !== String(car.id || ''))
            ];
            renderDetailPage(car);
            void incrementCounter(car.id, 'viewsCount');
            return true;
        } else {
            showCarDetailUnavailable('Das Fahrzeug wurde nicht gefunden oder ist nicht mehr verfügbar.');
            toast('Fahrzeug nicht gefunden.', 'warning');
            return false;
        }
    } catch (err) {
        console.error('Error loading car:', err);
        showCarDetailUnavailable(LISTING_LOAD_BLOCKED_MESSAGE);
        toast(LISTING_LOAD_BLOCKED_MESSAGE, 'warning');
        return false;
    } finally {
        activatePage('detail');
    }
}

async function openCarDetail(carOrId) {
    const rawId = typeof carOrId === 'string' ? carOrId : String(carOrId?.id || '');
    const carId = decodeURIComponent(rawId);
    if (!carId) return;
    try {
        let carData = null;
        if (typeof carOrId === 'object' && carOrId) {
            carData = carOrId;
        } else {
            await openCarDetailById(carId);
            return;
        }
        window.__detailCar = carData;
        window.currentDetailId = carData.id;
        renderDetailPage(carData);
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'car-detail');
        url.searchParams.delete('catalog');
        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
        url.searchParams.set('id', carData.id);
        pushBrowserUrl(url, { state: { view: 'detail', id: carData.id } });
        void incrementCounter(carData.id, 'viewsCount');
    } catch (error) {
        console.error('openCarDetail failed:', error);
        toast('Die Fahrzeugdetails konnten nicht geladen werden.', 'warning');
    }
}

async function incrementCounter(carId, fieldName) {
    const user = auth.currentUser;
    if (!user) {
        return;
    }
    if (!['viewsCount', 'whatsappClicks'].includes(fieldName)) {
        return;
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
            await updateDoc(doc(db, 'cars', carId), { [fieldName]: increment(1) });
            break;
        } catch (error) {
            if (attempt === 1) {
                return;
            }
        }
    }
}

function setupDescriptionToggle(descriptionEl) {
    if (!descriptionEl) return;
    let toggle = descriptionEl.nextElementSibling;
    if (!toggle || !toggle.classList.contains('desc-toggle-btn')) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'desc-toggle-btn btn btn-link p-0 mt-2 text-warning fw-bold';
        toggle.style.display = 'none';
        toggle.style.textDecoration = 'none';
        descriptionEl.insertAdjacentElement('afterend', toggle);
    }

    descriptionEl.classList.add('description-collapsed');
    toggle.textContent = tr('show_more', 'Mehr anzeigen');
    toggle.onclick = () => {
        const isCollapsed = descriptionEl.classList.toggle('description-collapsed');
        toggle.textContent = isCollapsed ? tr('show_more', 'Mehr anzeigen') : tr('show_less', 'Weniger anzeigen');
    };

    const updateVisibility = () => {
        descriptionEl.classList.add('description-collapsed');
        toggle.textContent = tr('show_more', 'Mehr anzeigen');
        toggle.style.display = descriptionEl.scrollHeight > descriptionEl.clientHeight ? 'block' : 'none';
    };
    requestAnimationFrame(updateVisibility);
}

function renderDetailPage(car) {
    const title = `${car.year || ''} ${car.brand || car.make || ''} ${car.model || ''}`.trim() || tr('vtype_cars', 'Fahrzeug');
    const sellerLabel = car.sellerName || car.contactName || car.ownerEmail || car.contactEmail || tr('route_seller', 'Verkäufer');
    const valuation = calculateVehicleValuation(car);
    const marketAverage = Number(valuation.marketAverage || car.price || 0);
    const listingPrice = Number(car.price || 0);
    const offsetRatio = marketAverage > 0 ? (listingPrice - marketAverage) / marketAverage : 0;
    const percentOffset = Math.round(offsetRatio * 100);
    const fillPercent = Math.min(100, Math.max(0, 50 + (offsetRatio * 100)));
    const bar = document.getElementById('d-price-bar');
    const vsMarket = document.getElementById('d-vs-market');

    const titleEl = document.getElementById('d-title');
    const breadcrumbTitleEl = document.getElementById('d-breadcrumb-title');
    const descriptionEl = document.getElementById('d-description');
    const priceMainEl = document.getElementById('d-price-main');
    if (titleEl) titleEl.textContent = title;
    if (breadcrumbTitleEl) breadcrumbTitleEl.textContent = title;
    if (descriptionEl) {
        descriptionEl.textContent = car.description || '';
        setupDescriptionToggle(descriptionEl);
    }
    if (priceMainEl) priceMainEl.innerHTML = renderPriceBadge(car);
    if (vsMarket) {
        vsMarket.textContent = `${percentOffset > 0 ? '+' : ''}${percentOffset}% ${tr('route_market_price', 'Marktpreis')}`;
    }
    if (bar) {
        bar.style.width = `${fillPercent}%`;
        bar.style.background = percentOffset > 0 ? 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)';
    }
    const mileage = Number(car.mileage ?? car.km ?? 0);
    const metaYearEl = document.getElementById('d-year-meta');
    const metaLocationEl = document.getElementById('d-location-meta');
    const metaViewsEl = document.getElementById('d-car-views-meta');
    if (metaYearEl) metaYearEl.textContent = car.year ? `${tr('first_registration_meta', 'Erstzulassung')}: ${car.year}` : '';
    if (metaLocationEl) metaLocationEl.textContent = mileage > 0 ? `${formatNumber(mileage)} km` : '—';
    if (metaViewsEl) metaViewsEl.innerHTML = `${formatNumber(car.viewsCount)} <span data-t="views_label">${escapeHtml(t('views_label'))}</span>`;
    const detailIdMeta = document.getElementById('d-id-meta');
    if (detailIdMeta) {
        detailIdMeta.textContent = `ID-${String(car.id).slice(0, 8)}`;
    }
    renderDetailSpecTable(car);
    renderDetailFeatures(car);
    renderDetailGallery(car, 0);
    renderDetailConditionReport(car);
    const priceHistorySection = document.querySelector('#page-detail .price-hist');
    if (priceHistorySection) priceHistorySection.style.display = 'none';
    const wa = document.getElementById('d-whatsapp-link');
    const call = document.getElementById('d-call-link');
    const rawPhone = String(car.contactPhone || car.phone || car.phoneNumber || '').trim();
    const waPhone = rawPhone.replace(/[^\d]/g, '');
    if (wa) {
        wa.href = waPhone ? `https://wa.me/${waPhone}` : '#';
        wa.onclick = async event => {
            if (!waPhone) {
                event.preventDefault();
                toast(`${tr('route_whatsapp', 'WhatsApp')}: ${tr('route_not_available', 'Nicht verfügbar')}`, 'warning');
                return;
            }
            await incrementCounter(car.id, 'whatsappClicks');
        };
    }
    configureDetailPhoneAction(call, rawPhone);
    void hydrateSellerInfoCard('d-seller-box', car, {
        email: car.ownerEmail || car.contactEmail || '—',
        phone: car.contactPhone || '',
        address: car.zip || 'Deutschland',
        onProfile: profile => configureDetailPhoneAction(call, profile.phoneNumber || profile.phone || rawPhone)
    });
    updateDetailNavigation(currentDetailOrigin);
    activatePage('detail');
}

function showCarDetailUnavailable(message) {
    const fallbackMessage = message || 'Die Fahrzeugdetails konnten nicht geladen werden.';
    const titleEl = document.getElementById('d-title');
    const breadcrumbEl = document.getElementById('d-breadcrumb-title');
    const descriptionEl = document.getElementById('d-description');
    const priceEl = document.getElementById('d-price-main');
    const sellerBoxEl = document.getElementById('d-seller-box');
    const metaYearEl = document.getElementById('d-year-meta');
    const metaLocationEl = document.getElementById('d-location-meta');
    const metaViewsEl = document.getElementById('d-car-views-meta');
    const metaIdEl = document.getElementById('d-id-meta');
    const thumbsEl = document.getElementById('d-thumbs');
    const mainImgEl = document.getElementById('d-main-img');
    if (titleEl) titleEl.textContent = 'Fahrzeug nicht verfügbar';
    if (breadcrumbEl) breadcrumbEl.textContent = 'Fahrzeug nicht verfügbar';
    if (descriptionEl) descriptionEl.textContent = fallbackMessage;
    if (priceEl) priceEl.textContent = '—';
    if (sellerBoxEl) renderSellerInfoCard('d-seller-box', { sellerName: 'Verkäufer', email: '—', address: '—' });
    if (metaYearEl) metaYearEl.textContent = '';
    if (metaLocationEl) metaLocationEl.textContent = '';
    if (metaViewsEl) metaViewsEl.textContent = '';
    if (metaIdEl) metaIdEl.textContent = '';
    if (thumbsEl) thumbsEl.innerHTML = '';
    if (mainImgEl) mainImgEl.innerHTML = '<div style="font-size:72px;line-height:1">🚫</div>';
    const specTableEl = document.getElementById('d-spec-table');
    if (specTableEl) specTableEl.innerHTML = '';
    const reportEl = document.getElementById('d-condition-report');
    if (reportEl) {
        reportEl.hidden = true;
        reportEl.innerHTML = '';
    }
    activatePage('detail');
}

async function loadCarDetailFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const partId = params.get('partId');
    if (partId) {
        await openPartDetailPage(partId, { pushHistory: false });
        return true;
    }
    if (params.get('catalog') === 'cars' && !params.get('id')) {
        await openCarsSearchView();
        return false;
    }
    const carId = params.get('id');
    if (!carId) return false;
    return openCarDetailById(carId, { pushHistory: false });
}

function ensureListingImageInput() {
    let input = document.getElementById('listing-image-input');
    if (!input) {
        input = document.createElement('input');
        input.type = 'file';
        input.id = 'listing-image-input';
        input.accept = 'image/*';
        input.multiple = true;
        input.style.display = 'none';
        document.body.appendChild(input);
    }
    return input;
}

function compressImageFile(file) {
    return new Promise((resolve, reject) => {
        if (!file || !file.type || !file.type.startsWith('image/')) {
            reject(new Error('Ungültige Bilddatei.'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const maxDimension = 1200;
            const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
            const width = Math.max(1, Math.round(image.width * scale));
            const height = Math.max(1, Math.round(image.height * scale));
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('Canvas-Kontext nicht verfügbar.'));
                return;
            }
            canvas.width = width;
            canvas.height = height;
            context.drawImage(image, 0, 0, width, height);
            canvas.toBlob(blob => {
                if (!blob) {
                    reject(new Error('Bildkomprimierung fehlgeschlagen.'));
                    return;
                }
                resolve(blob);
            }, 'image/jpeg', 0.8);
        };
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Bild konnte nicht geladen werden.'));
        };
        image.src = objectUrl;
    });
}

async function uploadCompressedImages(files, ownerId, folder = 'car-images') {
    const uploads = [];
    const selectedFiles = Array.from(files || []).filter(file => file && file.type && file.type.startsWith('image/'));
    for (const [index, file] of selectedFiles.entries()) {
        const compressedBlob = await compressImageFile(file);
        const formData = new FormData();
        formData.append('file', compressedBlob, `${ownerId}-${Date.now()}-${index + 1}.jpg`);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('folder', `${folder}/${ownerId}`);

        const response = await fetch(CLOUDINARY_IMAGE_UPLOAD_URL, {
            method: 'POST',
            body: formData
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.secure_url) {
            const cloudinaryMessage = result?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Cloudinary-Upload fehlgeschlagen: ${cloudinaryMessage}`);
        }
        uploads.push(result.secure_url);
    }
    return uploads;
}

function getListingFieldValue(id) {
    return document.getElementById(id)?.value?.trim() || '';
}

function getRadioGroupValue(name) {
    return document.querySelector(`input[name="${name}"]:checked`)?.value || '';
}

function setRadioGroupValue(name, value) {
    document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
        input.checked = input.value === value;
    });
}

function mutateSellFormData(nextState) {
    Object.keys(formData).forEach(key => {
        delete formData[key];
    });
    Object.assign(formData, nextState);
}

function formatFileSize(bytes) {
    const size = Number(bytes || 0);
    if (size <= 0) return '0 KB';
    if (size < 1024 * 1024) {
        return `${Math.max(1, Math.round(size / 1024))} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeAttribute(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function getSellWizardFeatureState() {
    return getSelectedFeatureState('#sell-feature-boxes', 'sell-feature');
}

function syncSellWizardStateFromDom() {
    formData.make = getListingFieldValue('s-make');
    formData.model = getListingFieldValue('s-model');
    formData.year = getListingFieldValue('s-year');
    formData.mileage = getListingFieldValue('s-km');
    formData.fuel = getListingFieldValue('s-fuel');
    formData.transmission = getListingFieldValue('s-transmission');
    formData.body = getListingFieldValue('s-body');
    formData.color = getListingFieldValue('farbe-select');
    formData.power = getListingFieldValue('s-hp');
    formData.doors = getListingFieldValue('s-doors');
    formData.seats = getListingFieldValue('s-seats');
    formData.sellerType = getListingFieldValue('s-seller-type');
    formData.vin = getListingFieldValue('s-vin');
    formData.description = getListingFieldValue('s-desc');
    formData.price = getListingFieldValue('s-price');
    formData.condition = getListingFieldValue('s-condition');
    formData.isNegotiable = Boolean(document.getElementById('s-price-negotiable')?.checked);
    formData.sellerName = getListingFieldValue('s-seller-name');
    formData.email = getListingFieldValue('s-email').toLowerCase();
    formData.phone = getListingFieldValue('s-phone');
    formData.location = getListingFieldValue('s-location');
    formData.acceptedTerms = Boolean(document.getElementById('agb-checkbox')?.checked);
    formData.newsletterOptIn = Boolean(document.getElementById('sell-newsletter-optin')?.checked);
    const featureState = getSellWizardFeatureState();
    formData.features = featureState.flat;
    formData.featuresByCategory = featureState.byCategory;
    formData.zustandsbericht = Object.fromEntries([
        ...ZUSTANDSBERICHT_TEXT_FELDER.map(field => [field, getListingFieldValue(field)]),
        ...ZUSTANDSBERICHT_RADIO_GRUPPEN.map(field => [field, getRadioGroupValue(field)])
    ]);
}

function applySellWizardStateToDom() {
    const fieldMap = {
        's-make': formData.make,
        's-model': formData.model,
        's-year': formData.year,
        's-km': formData.mileage,
        's-fuel': formData.fuel,
        's-transmission': formData.transmission,
        's-body': formData.body,
        'farbe-select': formData.color,
        's-hp': formData.power,
        's-doors': formData.doors,
        's-seats': formData.seats,
        's-seller-type': formData.sellerType,
        's-vin': formData.vin,
        's-desc': formData.description,
        's-price': formData.price,
        's-condition': formData.condition,
        's-seller-name': formData.sellerName,
        's-email': formData.email,
        's-phone': formData.phone,
        's-location': formData.location
    };
    Object.entries(fieldMap).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (!element) return;
        element.value = value || '';
    });
    ZUSTANDSBERICHT_TEXT_FELDER.forEach(field => {
        const element = document.getElementById(field);
        if (element) element.value = formData.zustandsbericht[field] || '';
    });
    ZUSTANDSBERICHT_RADIO_GRUPPEN.forEach(field => {
        setRadioGroupValue(field, formData.zustandsbericht[field] || '');
    });
    const negotiableCheckbox = document.getElementById('s-price-negotiable');
    if (negotiableCheckbox) negotiableCheckbox.checked = Boolean(formData.isNegotiable);
    const termsCheckbox = document.getElementById('agb-checkbox');
    if (termsCheckbox) termsCheckbox.checked = Boolean(formData.acceptedTerms);
    const newsletterCheckbox = document.getElementById('sell-newsletter-optin');
    if (newsletterCheckbox) newsletterCheckbox.checked = Boolean(formData.newsletterOptIn);
    document.querySelectorAll('#sell-feature-boxes input[name="sell-feature"]').forEach(input => {
        input.checked = formData.features.includes(String(input.value || ''));
    });
    setActiveInspectionDamageType(formData.selectedDamageType);
    syncSellTermsCheckboxState();
}

function prefillSellWizardContactFromUser(user) {
    if (!user) return;
    if (!formData.email && user.email) {
        formData.email = String(user.email).toLowerCase();
    }
    if (!formData.sellerName && user.displayName) {
        formData.sellerName = user.displayName;
    }
    applySellWizardStateToDom();
}

function clearSellWizardValidationErrors() {
    document.querySelectorAll('.wizard-validation-error').forEach(element => {
        element.classList.remove('wizard-validation-error');
    });
}

function markSellWizardFieldInvalid(id) {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.add('wizard-validation-error');
    if (typeof element.focus === 'function') {
        element.focus();
    }
}

function validateSellWizardStep(step) {
    syncSellWizardStateFromDom();
    clearSellWizardValidationErrors();

    if (step === 1) {
        if (!formData.make) {
            toast(tr('sell_invalid_make', 'Bitte wählen Sie eine Marke aus.'), 'warning');
            markSellWizardFieldInvalid('s-make');
            return false;
        }
        if (!formData.model) {
            toast(tr('sell_invalid_model', 'Bitte wählen Sie ein Modell aus.'), 'warning');
            markSellWizardFieldInvalid('s-model');
            return false;
        }
        if (!formData.year) {
            toast(tr('sell_invalid_year', 'Bitte wählen Sie die Erstzulassung aus.'), 'warning');
            markSellWizardFieldInvalid('s-year');
            return false;
        }
        if (!Number.isFinite(Number(formData.mileage)) || Number(formData.mileage) < 0) {
            toast(tr('sell_invalid_mileage', 'Bitte geben Sie einen gültigen Kilometerstand ein.'), 'warning');
            markSellWizardFieldInvalid('s-km');
            return false;
        }
        if (!formData.fuel) {
            toast(tr('sell_invalid_fuel', 'Bitte wählen Sie den Kraftstoff aus.'), 'warning');
            markSellWizardFieldInvalid('s-fuel');
            return false;
        }
        if (!formData.transmission) {
            toast(tr('sell_invalid_transmission', 'Bitte wählen Sie das Getriebe aus.'), 'warning');
            markSellWizardFieldInvalid('s-transmission');
            return false;
        }
        if (!formData.body) {
            toast(tr('sell_invalid_body', 'Bitte wählen Sie die Karosserieform aus.'), 'warning');
            markSellWizardFieldInvalid('s-body');
            return false;
        }
        if (!formData.color) {
            toast(tr('sell_invalid_color', 'Bitte wählen Sie die Farbe aus.'), 'warning');
            markSellWizardFieldInvalid('farbe-select');
            return false;
        }
        if (!Number.isFinite(Number(formData.power)) || Number(formData.power) <= 0) {
            toast(tr('sell_invalid_power', 'Bitte geben Sie eine gültige Leistung in PS ein.'), 'warning');
            markSellWizardFieldInvalid('s-hp');
            return false;
        }
        return true;
    }

    if (step === 2) {
        if (!Number.isFinite(Number(formData.price)) || Number(formData.price) <= 0) {
            toast(tr('sell_invalid_price', 'Bitte geben Sie einen gültigen Verkaufspreis ein.'), 'warning');
            markSellWizardFieldInvalid('s-price');
            return false;
        }
        if (!formData.condition) {
            toast(tr('sell_invalid_condition', 'Bitte wählen Sie den Fahrzeugzustand aus.'), 'warning');
            markSellWizardFieldInvalid('s-condition');
            return false;
        }
        return true;
    }

    if (step === 3) {
        if (!formData.images.length) {
            toast(tr('sell_invalid_photos', 'Bitte laden Sie mindestens ein Fahrzeugfoto hoch.'), 'warning');
            return false;
        }
        return true;
    }

    if (step === 4) {
        if (!formData.sellerName) {
            toast(tr('sell_invalid_name', 'Bitte geben Sie den Namen des Verkäufers an.'), 'warning');
            markSellWizardFieldInvalid('s-seller-name');
            return false;
        }
        if (!SELL_WIZARD_EMAIL_REGEX.test(formData.email)) {
            toast(tr('sell_invalid_email', 'Bitte geben Sie eine gültige E-Mail-Adresse ein.'), 'warning');
            markSellWizardFieldInvalid('s-email');
            return false;
        }
        if (!SELL_WIZARD_PHONE_REGEX.test(formData.phone)) {
            toast(tr('sell_invalid_phone', 'Bitte geben Sie eine gültige Telefonnummer ein.'), 'warning');
            markSellWizardFieldInvalid('s-phone');
            return false;
        }
        if (!formData.location) {
            toast(tr('sell_invalid_location', 'Bitte geben Sie Standort oder Postleitzahl an.'), 'warning');
            markSellWizardFieldInvalid('s-location');
            return false;
        }
        if (!formData.acceptedTerms) {
            toast(tr('sell_invalid_terms', 'Bitte akzeptieren Sie die AGB, bevor Sie fortfahren.'), 'warning');
            markSellWizardFieldInvalid('agb-checkbox');
            return false;
        }
        return true;
    }

    return true;
}

function updateSellWizardProgress(step) {
    const progress = document.getElementById('stepper-progress');
    if (progress) {
        progress.style.width = `${((Math.max(1, Math.min(step, SELL_WIZARD_TOTAL_STEPS)) - 1) / (SELL_WIZARD_TOTAL_STEPS - 1)) * 80}%`;
    }
}

function updateSellWizardStepper(step) {
    for (let index = 1; index <= SELL_WIZARD_TOTAL_STEPS; index += 1) {
        const item = document.getElementById(`si-${index}`);
        if (!item) continue;
        item.classList.remove('active', 'done');
        if (index < step) item.classList.add('done');
        if (index === step) item.classList.add('active');
        item.disabled = index > maxReachedSellWizardStep && index > step;
    }
    updateSellWizardProgress(step);
}

function calculateVehicleValuation(carData = {}) {
    const year = Number(carData.year || carData.modelYear || new Date().getFullYear());
    const mileage = Number(carData.mileage || carData.km || carData.odometer || 0);
    const power = Number(carData.power || carData.hp || carData.ps || 0);
    const brand = String(carData.make || carData.brand || 'Volkswagen').trim() || 'Volkswagen';
    const model = String(carData.model || '').trim();
    const baseYear = new Date().getFullYear();
    const ageYears = Math.max(0, baseYear - year);
    const tierMap = {
        premium: 1.28,
        standard: 1.0,
        budget: 0.82
    };
    const premiumBrands = ['Porsche', 'Mercedes-Benz', 'BMW', 'Audi', 'Jaguar', 'Volvo', 'Tesla'];
    const budgetBrands = ['Fiat', 'Opel', 'Renault', 'Peugeot', 'Citroen', 'Suzuki', 'Dacia'];
    const tier = premiumBrands.includes(brand) ? 'premium' : budgetBrands.includes(brand) ? 'budget' : 'standard';
    const powerFactor = power > 0 ? power * 110 : 1;
    const mileageFactor = mileage > 0 ? Math.max(0, 1 - mileage / 250000) : 0.92;
    const ageFactor = Math.max(0.18, 1 - ageYears * 0.03);
    const modelBias = model ? (model.toLowerCase().includes('e-tron') || model.toLowerCase().includes('i') || model.toLowerCase().includes('rs') ? 1.12 : 1) : 1;
    const marketBase = (powerFactor + (Math.max(0, 2020 - year + 1) * 400) + (brand === 'Porsche' ? 8000 : 0)) * tierMap[tier] * mileageFactor * ageFactor * modelBias;
    const featureBonusMap = {
        Klima: 1200,
        Klimaanlage: 1200,
        LED: 700,
        'LED-Scheinwerfer': 700,
        Navi: 1500,
        Navigationssystem: 1500,
        'Apple CarPlay': 600,
        'Android Auto': 600,
        Sitzheizung: 500,
        Tempomat: 450,
        Standheizung: 550,
        'Panorama-Dach': 1000,
        'Schiebedach': 900,
        'Leichtmetallfelgen': 700,
        'Parkassistent': 600,
        '360°-Kamera': 1000,
        'Berganfahrhilfe': 350,
        'Kamera': 600
    };
    const featureList = Array.isArray(carData.features) ? carData.features : Array.isArray(carData.ausstattung) ? carData.ausstattung : [];
    const featureBonus = featureList.reduce((sum, feature) => sum + (featureBonusMap[String(feature).trim()] || 0), 0);
    const damagePenaltyMap = {
        Korrosion: 2200,
        Kratzer: 1200,
        Dellen: 1500,
        Blechschaden: 2600,
        'Blechschaden / Rost': 2600,
        Rost: 2200,
        Unfall: 5000,
        'Unfallhistorie': 5000
    };
    const pins = Array.isArray(carData.inspectionPins) ? carData.inspectionPins : [];
    const damagePenalty = pins.reduce((sum, pin) => sum + (damagePenaltyMap[String(pin?.damageType || pin?.type || '').trim()] || 0), 0);
    const reportFlags = carData.zustandsbericht || {};
    const conditionPenalty = [
        reportFlags.unfallhistorie,
        reportFlags['zustand'] === 'Mangelhaft',
        reportFlags['hu-status'] === 'Abgelaufen',
        reportFlags['tuev-status'] === 'Abgelaufen',
        reportFlags['oelverlust'],
        reportFlags['kuehlmittelverlust'],
        reportFlags['oilLeak'],
        reportFlags['coolantLeak'],
        reportFlags['hu'] === 'abgelaufen',
        reportFlags['tuev'] === 'abgelaufen'
    ].reduce((sum, flag) => sum + (flag ? 1500 : 0), 0);
    const estimated = Math.max(3500, Math.round((marketBase + featureBonus - damagePenalty - conditionPenalty) / 100) * 100);
    const average = Math.max(3500, estimated);
    const minPrice = Math.round(average * 0.88);
    const maxPrice = Math.round(average * 1.12);
    return {
        marketAverage: average,
        estimatedPrice: estimated,
        minPrice,
        maxPrice,
        brandTier: tier,
        ageYears,
        mileage,
        featureBonus,
        damagePenalty,
        conditionPenalty
    };
}

function syncValuationBar(elementId, offsetRatio) {
    const bar = document.getElementById(elementId);
    if (!bar) return;
    const clamped = Math.min(95, Math.max(5, 50 + offsetRatio * 50));
    bar.style.width = `${clamped}%`;
}

function updateSellWizardValuation() {
    syncSellWizardStateFromDom();
    const enteredPrice = Number(formData.price || document.getElementById('s-price')?.value || 0);
    const valuation = calculateVehicleValuation({
        make: formData.make || formData.brand,
        model: formData.model,
        year: formData.year,
        mileage: formData.mileage,
        power: formData.power,
        features: formData.features || [],
        inspectionPins: formData.inspectionPins || [],
        zustandsbericht: formData.zustandsbericht || {}
    });
    const marketAverage = Number(valuation.marketAverage || 0);
    const basePrice = Number.isFinite(enteredPrice) && enteredPrice > 0 ? enteredPrice : marketAverage;
    const numberElement = document.getElementById('sell-val-num');
    const rangeElement = document.getElementById('sell-val-range');
    if (numberElement) numberElement.textContent = formatCurrency(Math.round(basePrice));
    if (rangeElement) rangeElement.innerHTML = `<span>${escapeHtml(tr('sell_market_range', 'Marktspanne:'))}</span> ${formatCurrency(Math.round(valuation.minPrice))} – ${formatCurrency(Math.round(valuation.maxPrice))}`;
    const offsetRatio = marketAverage > 0 ? (basePrice - marketAverage) / marketAverage : 0;
    syncValuationBar('d-price-bar', offsetRatio);
    const fillBar = document.querySelector('.val-bar-fill');
    if (fillBar) {
        const fillPercent = Math.min(95, Math.max(5, 50 + offsetRatio * 50));
        fillBar.style.width = `${fillPercent}%`;
    }
}

window.updateValuationUI = function updateValuationUI() {
    updateSellWizardValuation();
};

function renderSellWizardSummary() {
    syncSellWizardStateFromDom();
    const preview = document.getElementById('sell-preview');
    if (!preview) return;
    const reviewLabelKeys = {
        Marke: 'spec_make', Modell: 'spec_model', Erstzulassung: 'first_registration_meta', Kilometerstand: 'spec_mileage',
        Kraftstoff: 'spec_fuel', Getriebe: 'spec_transmission', Karosserieform: 'spec_body', Farbe: 'spec_color',
        Leistung: 'spec_power', Türen: 'spec_doors', Sitzplätze: 'spec_seats', Anbieter: 'sf_seller', 'FIN / VIN': 'spec_vin',
        Preis: 'sf_price', Verhandelbar: 'price_negotiable', Zustand: 'part_condition', Beschreibung: 'desc_title',
        Ausstattung: 'features_title', Bewertung: 'step2_title', Fotos: 'sell_step_photos', Kontaktdaten: 'sell_step_contact',
        Name: 'your_name', 'E-Mail': 'email', Telefon: 'phone', 'Standort / PLZ': 'sell_location',
        'Fahrzeugbezeichnung & Modell': 'spec_model', 'Erstzulassungsdatum': 'first_registration_meta',
        'Baujahr / Modelljahr': 'sf_year', 'Fahrgestellnummer / VIN': 'spec_vin', Kraftstoffart: 'spec_fuel',
        Getriebeart: 'spec_transmission', 'Abgasemissionen CO / HC': 'co_emissions', Rückrufaktion: 'recall',
        'Keine Ausstattung ausgewählt': 'no_features'
    };
    const reviewLabelKey = label => reviewLabelKeys[label] || REPORT_TEXT_KEYS[label] || '';
    const reviewLabel = label => tr(reviewLabelKey(label), label);
    const vehicleSpecs = [
        ['Marke', formData.make || '—'], ['Modell', formData.model || '—'], ['Erstzulassung', formData.year || '—'],
        ['Kilometerstand', formData.mileage ? `${formatNumber(Number(formData.mileage))} km` : '—'], ['Kraftstoff', formData.fuel || '—'],
        ['Getriebe', formData.transmission || '—'], ['Karosserieform', formData.body || '—'], ['Farbe', formData.color || '—'],
        ['Leistung', formData.power ? `${formData.power} PS` : '—'], ['Türen', formData.doors || '—'], ['Sitzplätze', formData.seats || '—'],
        ['Anbieter', formData.sellerType === 'Dealer' ? tr('seller_dealer', 'Händler') : formData.sellerType === 'Private' ? tr('seller_private', 'Privat') : '—'],
        ['FIN / VIN', formData.vin || '—']
    ];
    const pricingSpecs = [
        ['Preis', formData.price ? formatCurrency(Number(formData.price)) : '—'],
        ['Verhandelbar', formData.isNegotiable ? tr('yes', 'Ja') : tr('no', 'Nein')],
        ['Zustand', formData.condition || '—']
    ];
    const pinMarkup = formData.inspectionPins.length
        ? formData.inspectionPins.map(pin => `<div class="wizard-review-chip" style="background:${pin.colorCode};color:#fff;">${escapeHtml(localizedDamageType(pin.damageType))} · ${escapeHtml(tr(pin.diagramId === 'inspection2' ? 'diagram_interior' : 'diagram_exterior', SELL_WIZARD_DIAGRAM_LABELS[pin.diagramId] || pin.diagramId))} · ${pin.x.toFixed(1)}% / ${pin.y.toFixed(1)}%</div>`).join('')
        : `<div class="wizard-review-chip">${tr('report_no_marks', 'Keine Schäden dokumentiert')}</div>`;
    const imagesMarkup = formData.images.length
        ? formData.images.slice(0, 8).map(image => `<img class="wizard-review-thumb" src="${escapeAttribute(image.previewUrl)}" alt="${escapeAttribute(image.name)}">`).join('')
        : `<div class="wizard-review-chip">${tr('sell_no_photos', 'Keine Bilder')}</div>`;
    const featureMarkup = formData.features.length
        ? formData.features.map(feature => `<div class="wizard-review-chip">${escapeHtml(feature)}</div>`).join('')
        : `<div class="wizard-review-chip">${tr('no_features', 'Keine Ausstattung ausgewählt')}</div>`;
    const zustandsberichtRows = [
        ['Fahrzeugbezeichnung & Modell', formData.zustandsbericht['zb-fahrzeugbezeichnung'] || '—'],
        ['Erstzulassungsdatum', formData.zustandsbericht['zb-erstzulassungsdatum'] || '—'],
        ['Baujahr / Modelljahr', formData.zustandsbericht['zb-modelljahr'] || '—'],
        ['Amtliches Kennzeichen', formData.zustandsbericht['zb-kennzeichen'] || '—'],
        ['HU / TÜV gültig von', formData.zustandsbericht['zb-hu-von'] || '—'],
        ['HU / TÜV gültig bis', formData.zustandsbericht['zb-hu-bis'] || '—'],
        ['Fahrgestellnummer / VIN', formData.zustandsbericht['zb-fahrgestellnummer'] || '—'],
        ['Eigener Schadensaufwand', formData.zustandsbericht['zb-eigner-schaden'] || '—'],
        ['Besondere Hinweise / Nutzungshistorie', formData.zustandsbericht['zb-historie-hinweise'] || '—'],
        ['Kraftstoffart', formData.zustandsbericht['zb-kraftstoffart'] || '—'],
        ['Getriebeart', formData.zustandsbericht['zb-getriebeart'] || '—'],
        ['Garantie-Typ', formData.zustandsbericht['zb-garantietyp'] || '—'],
        ['Kilometerstand-Messung', formData.zustandsbericht['zb-kilometerstand-messung'] || '—'],
        ['Tatsächlicher Kilometerstand', formData.zustandsbericht['zb-tatsaechlicher-kilometerstand'] ? `${formData.zustandsbericht['zb-tatsaechlicher-kilometerstand']} km` : '—'],
        ['Fahrgestellnummer-Zustand', formData.zustandsbericht['zb-fahrgestellnummer-zustand'] || '—'],
        ['Abgasemissionen CO / HC', (formData.zustandsbericht['zb-abgas-co'] || formData.zustandsbericht['zb-abgas-hc']) ? `${formData.zustandsbericht['zb-abgas-co'] || '—'} % / ${formData.zustandsbericht['zb-abgas-hc'] || '—'} ppm` : '—'],
        ['Tuning / Umbauten', formData.zustandsbericht['zb-tuning-umbauten'] || '—'],
        ['Sondernutzung / Historie', formData.zustandsbericht['zb-sondernutzung-historie'] || '—'],
        ['Farbe & Lackierung', formData.zustandsbericht['zb-farbe-lackierung'] || '—'],
        ['Wichtigste Ausstattung', formData.zustandsbericht['zb-wichtigste-ausstattung'] || '—'],
        ['Rückrufaktion', formData.zustandsbericht['zb-rueckrufaktion'] || '—'],
        ['Unfallhistorie', formData.zustandsbericht['zb-unfallhistorie'] || '—'],
        ['Karosseriereparatur / Austausch', formData.zustandsbericht['zb-karosseriereparatur'] || '—'],
        ['Strukturelle Rahmenreparatur', formData.zustandsbericht['zb-rahmenreparatur'] || '—'],
        ['Laufverhalten & Leerlauf', formData.zustandsbericht['zb-motor-laufverhalten'] || '—'],
        ['Ölleckage - Zylinderkopfdeckel', formData.zustandsbericht['zb-oelleckage-zylinderkopfdeckel'] || '—'],
        ['Ölleckage - Zylinderkopfdichtung', formData.zustandsbericht['zb-oelleckage-zylinderkopfdichtung'] || '—'],
        ['Ölleckage - Ölwanne', formData.zustandsbericht['zb-oelleckage-oelwanne'] || '—'],
        ['Motorölstand & Öldruck', formData.zustandsbericht['zb-motoroelstand-oeldruck'] || '—'],
        ['Kühlmittelleckage - Zylinderkopf', formData.zustandsbericht['zb-kuehlmittelleckage-zylinderkopf'] || '—'],
        ['Kühlmittelleckage - Radiator', formData.zustandsbericht['zb-kuehlmittelleckage-radiator'] || '—'],
        ['Kühlmittelleckage - Wasserpumpe', formData.zustandsbericht['zb-kuehlmittelleckage-wasserpumpe'] || '—'],
        ['Kühlmittelstand', formData.zustandsbericht['zb-kuehlmittelstand'] || '—'],
        ['Automatikgetriebe - Ölleckage', formData.zustandsbericht['zb-automatik-oelleckage'] || '—'],
        ['Automatikgetriebe - Ölstand & Zustandsprüfung', formData.zustandsbericht['zb-automatik-oelstand-zustand'] || '—'],
        ['Schaltfunktion & Kupplungsdruck', formData.zustandsbericht['zb-schaltfunktion-kupplungsdruck'] || '—'],
        ['Schaltgetriebe - Ölleckage', formData.zustandsbericht['zb-schaltgetriebe-oelleckage'] || '—'],
        ['Kupplungsscheibe & Druckplatte', formData.zustandsbericht['zb-kupplungsscheibe-druckplatte'] || '—'],
        ['Antriebswelle & CV-Gelenke', formData.zustandsbericht['zb-antriebswelle-cv-gelenke'] || '—'],
        ['Radlager & Achsschenkel', formData.zustandsbericht['zb-radlager-achsschenkel'] || '—'],
        ['Differenzialgetriebe', formData.zustandsbericht['zb-differenzialgetriebe'] || '—'],
        ['Lenkgetriebe - Ölleckage', formData.zustandsbericht['zb-lenkgetriebe-oelleckage'] || '—'],
        ['Lenkgetriebe & Spurstangenköpfe', formData.zustandsbericht['zb-lenkgetriebe-spurstangenkoepfe'] || '—'],
        ['Servopumpe & Antriebsriemen', formData.zustandsbericht['zb-servopumpe-antriebsriemen'] || '—'],
        ['Achsmanschetten & Kugelgelenke', formData.zustandsbericht['zb-achsmanschetten-kugelgelenke'] || '—'],
        ['Hauptbremszylinder - Leckage', formData.zustandsbericht['zb-hauptbremszylinder-leckage'] || '—'],
        ['Bremsflüssigkeitsstand & Qualität', formData.zustandsbericht['zb-bremsfluessigkeit'] || '—'],
        ['Bremsverstärker & Unterdrucksystem', formData.zustandsbericht['zb-bremsverstaerker-unterdruck'] || '—'],
        ['Lichtmaschine / Generator', formData.zustandsbericht['zb-lichtmaschine-generator'] || '—'],
        ['Anlasser / Startermotor', formData.zustandsbericht['zb-anlasser-startermotor'] || '—'],
        ['Scheibenwischermotor', formData.zustandsbericht['zb-scheibenwischermotor'] || '—'],
        ['Gebläsemotor / Lüftungsanlage', formData.zustandsbericht['zb-geblaesemotor-lueftung'] || '—'],
        ['Kühlventilator / Radiatorlüfter', formData.zustandsbericht['zb-kuehlventilator-radiatorluefter'] || '—'],
        ['Elektrische Fensterheber', formData.zustandsbericht['zb-elektrische-fensterheber'] || '—'],
        ['Kraftstoffleitung / Dichtigkeit', formData.zustandsbericht['zb-kraftstoffleitung-dichtigkeit'] || '—'],
        ['Gutachter-Bemerkungen', formData.zustandsbericht['zb-gutachter-bemerkungen'] || '—'],
        ['Prüfer', formData.zustandsbericht['zb-pruefer'] || '—'],
        ['Prüfdatum', formData.zustandsbericht['zb-pruefdatum'] || '—']
    ];

    preview.innerHTML = `
        <section class="wizard-review-section">
            <h3>${tr('review_vehicle_data', 'Fahrzeugdaten')}</h3>
            <div class="wizard-review-grid">
                ${vehicleSpecs.map(([label, value]) => `<div class="wizard-review-row"><span${reviewLabelKey(label) ? ` data-t="${reviewLabelKey(label)}"` : ''}>${escapeHtml(reviewLabel(label))}</span><span>${escapeHtml(value)}</span></div>`).join('')}
            </div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(reviewLabel('Beschreibung'))}</h3>
            <div class="wizard-review-text">${escapeHtml(formData.description || '—')}</div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(reviewLabel('Ausstattung'))}</h3>
            <div class="wizard-review-tags">${featureMarkup}</div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(reviewLabel('Bewertung'))}</h3>
            <div class="wizard-review-grid">
                ${pricingSpecs.map(([label, value]) => `<div class="wizard-review-row"><span${reviewLabelKey(label) ? ` data-t="${reviewLabelKey(label)}"` : ''}>${escapeHtml(reviewLabel(label))}</span><span>${escapeHtml(value)}</span></div>`).join('')}
            </div>
        </section>
        <section class="wizard-review-section">
            <h3>${tr('review_condition_report', 'Gebrauchtwagen-Zustandsbericht')}</h3>
            <div class="wizard-review-damages">${pinMarkup}</div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(tr('report_inspection', 'Leistungs- und Zustandsbericht'))}</h3>
            <div class="wizard-review-grid">
                ${zustandsberichtRows.map(([label, value]) => `<div class="wizard-review-row"><span${reviewLabelKey(label) ? ` data-t="${reviewLabelKey(label)}"` : ''}>${escapeHtml(reviewLabel(label))}</span><span>${escapeHtml(value)}</span></div>`).join('')}
            </div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(reviewLabel('Fotos'))}</h3>
            <div class="wizard-review-images">${imagesMarkup}</div>
        </section>
        <section class="wizard-review-section">
            <h3>${escapeHtml(reviewLabel('Kontaktdaten'))}</h3>
            <div class="wizard-review-grid">
                <div class="wizard-review-row"><span>${escapeHtml(reviewLabel('Name'))}</span><span>${escapeHtml(formData.sellerName || '—')}</span></div>
                <div class="wizard-review-row"><span>${escapeHtml(reviewLabel('E-Mail'))}</span><span>${escapeHtml(formData.email || '—')}</span></div>
                <div class="wizard-review-row"><span>${escapeHtml(reviewLabel('Telefon'))}</span><span>${escapeHtml(formData.phone || '—')}</span></div>
                <div class="wizard-review-row"><span>${escapeHtml(reviewLabel('Standort / PLZ'))}</span><span>${escapeHtml(formData.location || '—')}</span></div>
            </div>
        </section>
    `;
}

function showSellWizardStep(step) {
    for (let index = 1; index <= SELL_WIZARD_TOTAL_STEPS; index += 1) {
        const container = document.getElementById(`sell-s${index}`);
        if (!container) continue;
        container.style.display = index === step ? 'block' : 'none';
    }
    const successScreen = document.getElementById('sell-success');
    if (successScreen) successScreen.style.display = 'none';
    currentSellWizardStep = step;
    updateSellWizardStepper(step);
    if (step === 2) {
        updateSellWizardValuation();
    }
    if (step === 6) {
        renderSellWizardSummary();
    }
}

function goSellStep(step) {
    const targetStep = Math.max(1, Math.min(Number(step || 1), SELL_WIZARD_TOTAL_STEPS));
    syncSellWizardStateFromDom();
    if (targetStep > currentSellWizardStep && !validateSellWizardStep(currentSellWizardStep)) {
        return false;
    }
    if (targetStep > maxReachedSellWizardStep + 1) {
        return false;
    }
    maxReachedSellWizardStep = Math.max(maxReachedSellWizardStep, targetStep);
    showSellWizardStep(targetStep);
    if (!suppressHistoryRouting) {
        const url = new URL(window.location.href);
        url.searchParams.delete('id');
        url.searchParams.delete('partId');
        url.searchParams.delete('catalog');
        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
        url.searchParams.set('view', 'sell');
        url.searchParams.set('step', String(targetStep));
        pushBrowserUrl(url);
    }
    return true;
}

function nextStep() {
    return goSellStep(currentSellWizardStep + 1);
}

function prevStep() {
    return goSellStep(currentSellWizardStep - 1);
}

function goToStep(step) {
    return goSellStep(step);
}

function findInspectionDamageType(label) {
    return SELL_WIZARD_DAMAGE_TYPES.find(type => type.label === label) || SELL_WIZARD_DAMAGE_TYPES[0];
}

function setActiveInspectionDamageType(label) {
    const selected = findInspectionDamageType(label);
    formData.selectedDamageType = selected.label;
    document.querySelectorAll('#inspection-damage-palette .inspection-type-btn').forEach(button => {
        const isActive = button.getAttribute('data-damage-type') === selected.label;
        button.classList.toggle('active', isActive);
    });
}

function renderInspectionPins() {
    Object.keys(SELL_WIZARD_DIAGRAM_LABELS).forEach(diagramId => {
        const layer = document.getElementById(`inspection-pin-layer-${diagramId}`);
        if (!layer) return;
        const pins = formData.inspectionPins.filter(pin => pin.diagramId === diagramId);
        layer.innerHTML = pins.map(pin => `<span class="inspection-pin" style="left:${pin.x}%;top:${pin.y}%;--pin-color:${pin.colorCode};" title="${escapeAttribute(`${localizedDamageType(pin.damageType)} · ${tr(diagramId === 'inspection2' ? 'diagram_interior' : 'diagram_exterior', SELL_WIZARD_DIAGRAM_LABELS[diagramId])}`)}"></span>`).join('');
    });
    const list = document.getElementById('inspection-pin-list');
    const counter = document.getElementById('inspection-pin-count');
    if (counter) counter.textContent = `${formData.inspectionPins.length} Pin${formData.inspectionPins.length === 1 ? '' : 's'}`;
    if (!list) return;
    if (!formData.inspectionPins.length) {
        list.innerHTML = '<div class="inspection-pin-empty">Noch keine Schäden oder Nutzungsspuren markiert.</div>';
        return;
    }
    list.innerHTML = formData.inspectionPins.map((pin, index) => `
        <div class="inspection-pin-item">
            <div class="inspection-pin-meta">
                <div class="inspection-pin-badge" style="--pin-color:${pin.colorCode};">Pin ${index + 1} · ${escapeHtml(localizedDamageType(pin.damageType))}</div>
                <div style="font-size:12px;color:var(--gray-600)">${escapeHtml(SELL_WIZARD_DIAGRAM_LABELS[pin.diagramId] || pin.diagramId)} · Position ${pin.x.toFixed(1)}% / ${pin.y.toFixed(1)}%</div>
            </div>
            <button type="button" class="inspection-remove-btn" data-remove-pin-id="${pin.id}">Entfernen</button>
        </div>
    `).join('');
}

function addInspectionPin(diagramId, x, y) {
    const selectedType = findInspectionDamageType(formData.selectedDamageType);
    formData.inspectionPins.push({
        id: `pin-${Date.now()}-${sellWizardPinIdCounter += 1}`,
        diagramId,
        x,
        y,
        damageType: selectedType.label,
        colorCode: selectedType.colorCode
    });
    renderInspectionPins();
}

function clearInspectionPins(diagramId) {
    formData.inspectionPins = formData.inspectionPins.filter(pin => pin.diagramId !== diagramId);
    renderInspectionPins();
}

async function compressImageToFile(file, index) {
    const blob = await compressImageFile(file);
    const safeName = String(file.name || `bild-${index + 1}`)
        .replace(/\.[^.]+$/, '')
        .replace(/[^\w-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || `bild-${index + 1}`;
    return new File([blob], `${safeName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

function revokeWizardImagePreviews() {
    formData.images.forEach(image => {
        if (image?.previewUrl) {
            URL.revokeObjectURL(image.previewUrl);
        }
    });
}

function renderSellWizardImagePreviews() {
    const preview = document.getElementById('listing-photo-preview');
    const status = document.getElementById('listing-photo-status');
    const hint = document.getElementById('listing-photo-hint');
    if (status) {
        status.textContent = formData.images.length
            ? (formData.images.length === 1 ? t('sell_image_ready') : t('sell_images_ready').replace('{count}', String(formData.images.length)))
            : t('sell_no_photos');
    }
    if (hint) {
        hint.textContent = formData.images.length
            ? 'Alle Vorschaubilder wurden bereits clientseitig auf JPEG komprimiert.'
            : 'JPG, PNG, max. 10 MB pro Bild · automatische Komprimierung auf 1200px / Qualität 0.8';
    }
    if (!preview) return;
    preview.innerHTML = formData.images.map(image => `
        <div class="wizard-preview-card">
            <button type="button" class="wizard-preview-remove" data-remove-listing-image="${image.id}" aria-label="Bild entfernen">×</button>
            <img src="${escapeAttribute(image.previewUrl)}" alt="${escapeAttribute(image.name)}">
            <div class="wizard-preview-body">
                <div class="wizard-preview-title">${escapeHtml(image.name)}</div>
                <div class="wizard-preview-meta">${escapeHtml(formatFileSize(image.size))}</div>
            </div>
        </div>
    `).join('');
}

async function addSellWizardImages(files) {
    const incoming = Array.from(files || []).filter(file => file?.type?.startsWith('image/'));
    if (!incoming.length) return;
    const remaining = Math.max(0, SELL_WIZARD_MAX_IMAGES - formData.images.length);
    if (remaining === 0) {
        toast(`Maximal ${SELL_WIZARD_MAX_IMAGES} Bilder erlaubt.`, 'warning');
        return;
    }
    const selected = incoming.slice(0, remaining);
    const status = document.getElementById('listing-photo-status');
    if (status) status.textContent = t('sell_images_compressing');
    try {
        const existingSignatures = new Set(formData.images.map(image => image.signature));
        for (const [index, file] of selected.entries()) {
            const signature = `${file.name}:${file.size}:${file.lastModified}`;
            if (existingSignatures.has(signature)) continue;
            const compressedFile = await compressImageToFile(file, index);
            formData.images.push({
                id: `listing-image-${Date.now()}-${index}`,
                file: compressedFile,
                name: compressedFile.name,
                size: compressedFile.size,
                signature,
                previewUrl: URL.createObjectURL(compressedFile)
            });
            existingSignatures.add(signature);
        }
        renderSellWizardImagePreviews();
    } catch (error) {
        console.error('addSellWizardImages failed:', error);
        toast('Mindestens ein Bild konnte nicht verarbeitet werden.', 'warning');
        renderSellWizardImagePreviews();
    } finally {
        const input = ensureListingImageInput();
        input.value = '';
    }
}

function removeSellWizardImage(imageId) {
    const match = formData.images.find(image => image.id === imageId);
    if (match?.previewUrl) {
        URL.revokeObjectURL(match.previewUrl);
    }
    formData.images = formData.images.filter(image => image.id !== imageId);
    renderSellWizardImagePreviews();
}

function clearSellWizardImages() {
    revokeWizardImagePreviews();
    formData.images = [];
    renderSellWizardImagePreviews();
    const input = ensureListingImageInput();
    input.value = '';
}

async function uploadPreparedImages(images, ownerId, folder = 'car-images') {
    const uploads = [];
    for (const [index, image] of Array.from(images || []).entries()) {
        const file = image?.file;
        if (!file) continue;
        const formData = new FormData();
        formData.append('file', file, file.name || `car-image-${index + 1}.jpg`);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
        formData.append('folder', `${folder}/${ownerId}`);

        const response = await fetch(CLOUDINARY_IMAGE_UPLOAD_URL, {
            method: 'POST',
            body: formData
        });
        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.secure_url) {
            const cloudinaryMessage = result?.error?.message || `HTTP ${response.status}`;
            throw new Error(`Cloudinary-Upload fehlgeschlagen: ${cloudinaryMessage}`);
        }
        uploads.push(result.secure_url);
    }
    return uploads;
}

function bindSellWizardInputEvents() {
    const liveSyncIds = ['s-make', 's-model', 's-year', 's-km', 's-fuel', 's-transmission', 's-body', 'farbe-select', 's-hp', 's-doors', 's-seats', 's-seller-type', 's-vin', 's-desc', 's-price', 's-condition', 's-seller-name', 's-email', 's-phone', 's-location', ...ZUSTANDSBERICHT_TEXT_FELDER];
    liveSyncIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element || element.dataset.sellWizardBound === '1') return;
        const eventName = element.tagName === 'TEXTAREA' ? 'input' : 'change';
        element.addEventListener(eventName, () => {
            syncSellWizardStateFromDom();
            if (['s-year', 's-km', 's-hp'].includes(id)) {
                updateSellWizardValuation();
            }
            if (currentSellWizardStep === 6) {
                renderSellWizardSummary();
            }
        });
        if (eventName !== 'input') {
            element.addEventListener('input', () => {
                syncSellWizardStateFromDom();
                if (['s-km', 's-hp', 's-price'].includes(id)) {
                    updateSellWizardValuation();
                }
                if (currentSellWizardStep === 6) {
                    renderSellWizardSummary();
                }
            });
        }
        element.dataset.sellWizardBound = '1';
    });
    ['s-price-negotiable', 'agb-checkbox', 'sell-newsletter-optin'].forEach(id => {
        const checkbox = document.getElementById(id);
        if (!checkbox || checkbox.dataset.sellWizardBound === '1') return;
        checkbox.addEventListener('change', () => {
            syncSellWizardStateFromDom();
            syncSellTermsCheckboxState();
            if (currentSellWizardStep === 6) {
                renderSellWizardSummary();
            }
        });
        checkbox.dataset.sellWizardBound = '1';
    });
    ZUSTANDSBERICHT_RADIO_GRUPPEN.forEach(groupName => {
        document.querySelectorAll(`input[name="${groupName}"]`).forEach(input => {
            if (input.dataset.sellWizardBound === '1') return;
            input.addEventListener('change', () => {
                syncSellWizardStateFromDom();
                if (currentSellWizardStep === 6) {
                    renderSellWizardSummary();
                }
            });
            input.dataset.sellWizardBound = '1';
        });
    });
    document.querySelectorAll('#sell-feature-boxes input[name="sell-feature"]').forEach(input => {
        if (input.dataset.sellWizardBound === '1') return;
        input.addEventListener('change', () => {
            syncSellWizardStateFromDom();
            if (currentSellWizardStep === 6) {
                renderSellWizardSummary();
            }
        });
        input.dataset.sellWizardBound = '1';
    });
}

function bindSellWizardEvents() {
    document.querySelectorAll('#sell-steps [data-step]').forEach(button => {
        if (button.dataset.sellWizardBound === '1') return;
        button.addEventListener('click', () => {
            const step = Number(button.getAttribute('data-step') || 1);
            if (step <= maxReachedSellWizardStep) {
                goToStep(step);
            }
        });
        button.dataset.sellWizardBound = '1';
    });

    document.querySelectorAll('.inspection-stage').forEach(stage => {
        if (stage.dataset.sellWizardBound === '1') return;
        stage.addEventListener('click', event => {
            const rect = stage.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const x = Number((((event.clientX - rect.left) / rect.width) * 100).toFixed(2));
            const y = Number((((event.clientY - rect.top) / rect.height) * 100).toFixed(2));
            addInspectionPin(stage.getAttribute('data-diagram-id') || '', x, y);
        });
        stage.dataset.sellWizardBound = '1';
    });

    document.querySelectorAll('[data-clear-diagram]').forEach(button => {
        if (button.dataset.sellWizardBound === '1') return;
        button.addEventListener('click', () => {
            clearInspectionPins(button.getAttribute('data-clear-diagram') || '');
            if (currentSellWizardStep === 6) {
                renderSellWizardSummary();
            }
        });
        button.dataset.sellWizardBound = '1';
    });
    document.querySelectorAll('#inspection-damage-palette .inspection-type-btn').forEach(button => {
        if (button.dataset.sellWizardBound === '1') return;
        button.addEventListener('click', () => {
            setActiveInspectionDamageType(button.getAttribute('data-damage-type') || '');
            if (currentSellWizardStep === 6) {
                renderSellWizardSummary();
            }
        });
        button.dataset.sellWizardBound = '1';
    });

    document.getElementById('inspection-pin-list')?.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-pin-id]');
        if (!button) return;
        const pinId = button.getAttribute('data-remove-pin-id');
        formData.inspectionPins = formData.inspectionPins.filter(pin => pin.id !== pinId);
        renderInspectionPins();
        if (currentSellWizardStep === 6) {
            renderSellWizardSummary();
        }
    });

    const imageInput = ensureListingImageInput();
    if (imageInput.dataset.sellWizardBound !== '1') {
        imageInput.addEventListener('change', async () => {
            await addSellWizardImages(imageInput.files);
        });
        imageInput.dataset.sellWizardBound = '1';
    }

    const photoZone = document.getElementById('listing-photo-zone');
    if (photoZone && photoZone.dataset.sellWizardBound !== '1') {
        photoZone.addEventListener('click', () => imageInput.click());
        ['dragenter', 'dragover'].forEach(eventName => {
            photoZone.addEventListener(eventName, event => {
                event.preventDefault();
                photoZone.classList.add('dragover');
            });
        });
        ['dragleave', 'dragend', 'drop'].forEach(eventName => {
            photoZone.addEventListener(eventName, event => {
                event.preventDefault();
                photoZone.classList.remove('dragover');
            });
        });
        photoZone.addEventListener('drop', async event => {
            await addSellWizardImages(event.dataTransfer?.files);
        });
        photoZone.dataset.sellWizardBound = '1';
    }

    document.getElementById('listing-photo-preview')?.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-listing-image]');
        if (!button) return;
        removeSellWizardImage(button.getAttribute('data-remove-listing-image') || '');
        if (currentSellWizardStep === 6) {
            renderSellWizardSummary();
        }
    });

    const clearImagesButton = document.getElementById('clear-photo-selection');
    if (clearImagesButton && clearImagesButton.dataset.sellWizardBound !== '1') {
        clearImagesButton.addEventListener('click', clearSellWizardImages);
        clearImagesButton.dataset.sellWizardBound = '1';
    }

    bindSellWizardInputEvents();
}

function initSellWizard() {
    bindSellWizardEvents();
    syncSellWizardStateFromDom();
    prefillSellWizardContactFromUser(auth.currentUser);
    renderInspectionPins();
    renderSellWizardImagePreviews();
    showSellWizardStep(1);
}

function showSellWizardSuccess() {
    for (let index = 1; index <= SELL_WIZARD_TOTAL_STEPS; index += 1) {
        const container = document.getElementById(`sell-s${index}`);
        if (container) container.style.display = 'none';
    }
    const successScreen = document.getElementById('sell-success');
    if (successScreen) {
        successScreen.style.display = 'block';
    }
}

function syncPartImageInputWithState() {
    const input = document.getElementById('partImages') || document.getElementById('part-image');
    if (!input) return;
    const transfer = new DataTransfer();
    partSelectedFiles.forEach(file => transfer.items.add(file));
    input.files = transfer.files;
}

function clearPartImageDraft() {
    partSelectedFiles = [];
    const input = document.getElementById('partImages') || document.getElementById('part-image');
    if (input) input.value = '';
    const preview = document.getElementById('part-images-preview');
    if (preview) preview.innerHTML = '';
}

function renderPartImagePreviews() {
    const preview = document.getElementById('part-images-preview');
    if (!preview) return;
    preview.innerHTML = '';
    partSelectedFiles.forEach((file, index) => {
        const url = URL.createObjectURL(file);
        preview.insertAdjacentHTML('beforeend', `<div data-preview-item="${index}" style="position:relative;width:76px;height:76px;border-radius:8px;overflow:hidden;border:1px solid #ddd">
            <img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover">
            <button type="button" data-remove-part-image="${index}" style="position:absolute;top:2px;right:2px;width:20px;height:20px;border:0;border-radius:999px;background:rgba(0,0,0,.65);color:#fff;cursor:pointer;line-height:1">×</button>
        </div>`);
    });
}
    
function addPartImagesFromInput() {
    const input = document.getElementById('partImages') || document.getElementById('part-image');
    if (!input) return;
    const incoming = Array.from(input.files || []);
    if (!incoming.length) return;
    const dedupedIncoming = incoming.filter(file => !partSelectedFiles.some(existing =>
        existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified
    ));
    const remaining = Math.max(0, 15 - partSelectedFiles.length);
    if (remaining === 0) {
        toast('Sie können maximal 15 Bilder hochladen.', 'warning');
        syncPartImageInputWithState();
        return;
    }
    partSelectedFiles.push(...dedupedIncoming.slice(0, remaining));
    if (dedupedIncoming.length > remaining) {
        toast('Maximal 15 Bilder erlaubt. Überzählige Bilder wurden ignoriert.', 'warning');
    }
    syncPartImageInputWithState();
    renderPartImagePreviews();
}

function resetSellFormAfterPublish() {
    revokeWizardImagePreviews();
    const fieldIds = ['s-make', 's-model', 's-year', 's-km', 's-fuel', 's-transmission', 's-body', 'farbe-select', 's-hp', 's-doors', 's-seats', 's-seller-type', 's-vin', 's-desc', 's-price', 's-condition', 's-seller-name', 's-email', 's-phone', 's-location', ...ZUSTANDSBERICHT_TEXT_FELDER];
    fieldIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        if (element.tagName === 'SELECT') {
            element.selectedIndex = 0;
        } else {
            element.value = '';
        }
    });
    document.querySelectorAll('#sell-feature-boxes input[name="sell-feature"]').forEach(input => {
        input.checked = false;
    });
    const negotiableCheckbox = document.getElementById('s-price-negotiable');
    if (negotiableCheckbox) negotiableCheckbox.checked = false;
    const agbCheckbox = document.getElementById('agb-checkbox');
    if (agbCheckbox) agbCheckbox.checked = false;
    const newsletterCheckbox = document.getElementById('sell-newsletter-optin');
    if (newsletterCheckbox) newsletterCheckbox.checked = false;
    ZUSTANDSBERICHT_RADIO_GRUPPEN.forEach(groupName => {
        setRadioGroupValue(groupName, '');
    });
    const imageInput = ensureListingImageInput();
    imageInput.value = '';
    mutateSellFormData(createDefaultSellFormData());
    maxReachedSellWizardStep = 1;
    renderInspectionPins();
    renderSellWizardImagePreviews();
    applySellWizardStateToDom();
    showSellWizardStep(1);
    updateSellModels();
    syncSellTermsCheckboxState();
    renderSellWizardSummary();
    prefillSellWizardContactFromUser(auth.currentUser);
}

async function publishListing(event) {
    event?.preventDefault();
    syncSellWizardStateFromDom();
    if (!validateSellWizardStep(4)) {
        if (!formData.acceptedTerms) {
            syncSellTermsCheckboxState();
            alert('Bitte akzeptieren Sie die AGB und Datenschutzerklärung, um Ihre Anzeige zu veröffentlichen.');
        }
        showSellWizardStep(4);
        return;
    }
    if (!validateSellWizardStep(3)) {
        showSellWizardStep(3);
        return;
    }
    if (!validateSellWizardStep(2)) {
        showSellWizardStep(2);
        return;
    }
    if (!validateSellWizardStep(1)) {
        showSellWizardStep(1);
        return;
    }
    const user = auth.currentUser;
    if (!user) {
        toast('Bitte melden Sie sich an, bevor Sie ein Inserat veröffentlichen.', 'warning');
        openAuthModal();
        return;
    }
    if (!await ensureSellerProfileComplete()) {
        return;
    }
    if (!Array.isArray(formData.images) || formData.images.length < 5) {
        toast('Bitte lade mindestens 5 Fotos hoch.', 'warning');
        showSellWizardStep(3);
        return;
    }
    const brand = formData.make;
    const model = formData.model;
    const year = Number(formData.year || 0);
    const mileage = Number(formData.mileage || 0);
    const fuel = formData.fuel;
    const transmission = formData.transmission;
    const body = formData.body;
    const color = formData.color;
    const hp = Number(formData.power || 0);
    const doors = formData.doors;
    const seats = Number(formData.seats || 0);
    const sellerType = formData.sellerType;
    const price = Number(formData.price || 0);
    const isNegotiable = Boolean(formData.isNegotiable);
    const description = formData.description;
    const sellerName = formData.sellerName;
    const email = formData.email || String(user.email || '').toLowerCase();
    const phone = formData.phone;
    const location = formData.location;
    const featureState = {
        flat: [...formData.features],
        byCategory: formData.featuresByCategory
    };
    setLoading('btn-publish', true);
    try {
        const imageUrls = formData.images.length ? await uploadPreparedImages(formData.images, user.uid) : [];
        const listingData = {
            brand,
            make: brand,
            model,
            year,
            mileage,
            km: mileage,
            fuel,
            transmission,
            trans: transmission,
            getriebe: transmission,
            body,
            color,
            hp,
            doors,
            seats,
            price,
            condition: formData.condition,
            isNegotiable,
            description,
            features: featureState.flat,
            ausstattung: featureState.flat,
            featuresByCategory: featureState.byCategory,
            sellerName,
            sellerType,
            seller_type: sellerType,
            dealer: {
                type: sellerType || 'Private',
                name: sellerName || 'Verkäufer'
            },
            contactName: sellerName,
            contactFirstName: sellerName.split(' ')[0] || sellerName,
            contactLastName: sellerName.split(' ').slice(1).join(' '),
            contactEmail: email || user.email || '',
            contactPhone: phone,
            location,
            zip: location,
            vin: formData.vin,
            inspectionPins: formData.inspectionPins.map(pin => ({
                x: pin.x,
                y: pin.y,
                diagramId: pin.diagramId,
                damageType: pin.damageType,
                colorCode: pin.colorCode
            })),
            damagePins: formData.inspectionPins.map(pin => ({
                x: pin.x,
                y: pin.y,
                diagramId: pin.diagramId,
                damageType: pin.damageType,
                colorCode: pin.colorCode
            })),
            zustandsbericht: { ...formData.zustandsbericht },
            image: imageUrls[0] || '',
            imageUrls,
            createdAt: serverTimestamp(),
            ownerId: user.uid,
            ownerEmail: user.email || '',
            status: 'active',
            viewsCount: 0,
            whatsappClicks: 0
        };
        const docRef = await addDoc(collection(db, 'cars'), listingData);
        const optimisticCar = normalizeFirestoreCar({
            id: docRef.id,
            data: () => ({
                ...listingData,
                createdAt: { seconds: Math.floor(Date.now() / 1000) }
            })
        });
        allCarsCache = [
            optimisticCar,
            ...allCarsCache.filter(car => String(car.id || '') !== String(optimisticCar.id || ''))
        ];
        renderHomeListingCards(allCarsCache);
        toast(`${tr('listingSaved', 'Ihr Inserat wurde veröffentlicht.')} (${docRef.id})`, 'success');
        resetSellFormAfterPublish();
        await renderMyListings();
        await loadAllPublicListings(true);
        if (typeof window.showPage === 'function') {
            window.showPage('sell');
        }
        showSellWizardSuccess();
        document.getElementById('my-listings-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        console.error('publishListing failed:', error);
        toast('Das Inserat konnte nicht gespeichert werden.', 'warning');
    } finally {
        setLoading('btn-publish', false);
    }
}

async function updateListingStatus(listingId, status) {
    try {
        await updateDoc(doc(db, 'cars', listingId), { status });
        await renderMyListings();
    } catch (error) {
        console.error('updateListingStatus failed:', error);
        toast('Status konnte nicht geändert werden.', 'warning');
    }
}

async function deleteListing(listingId) {
    if (!window.confirm(tr('delete_listing_confirm', 'Dieses Inserat wirklich löschen?'))) return;
    try {
        await deleteDoc(doc(db, 'cars', listingId));
        toast('Inserat gelöscht.', 'success');
        await renderMyListings();
        await loadAllPublicListings();
    } catch (error) {
        console.error('deleteListing failed:', error);
        toast('Das Inserat konnte nicht gelöscht werden.', 'warning');
    }
}

async function changeCarPrice(listingId, existingCar) {
    const input = window.prompt(tr('prompt_new_price', 'Neuen Preis eingeben (€):'), String(existingCar?.price || ''));
    if (input == null) return;
    const newPrice = Number(input);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
        toast('Bitte einen gültigen Preis eingeben.', 'warning');
        return;
    }
    const cached = readCachedFavorites(user.uid);
    if (cached) {
        favoriteCarIdsCache = new Set(cached.carIds.map(id => String(id)));
        favoritePartIdsCache = new Set(cached.partIds.map(id => String(id)));
    }
    try {
        const carRef = doc(db, 'cars', listingId);
        const snap = await getDoc(carRef);
        if (!snap.exists()) {
            toast('Fahrzeug wurde nicht gefunden.', 'warning');
            return;
        }
        const data = snap.data() || {};
        const currentPrice = Number(data.price || 0);
        const payload = { price: newPrice, updatedAt: serverTimestamp() };
        if (currentPrice > 0 && newPrice < currentPrice) {
            payload.previousPrice = currentPrice;
            payload.oldPrice = currentPrice;
            payload.originalPrice = Number(data.originalPrice || currentPrice);
        } else {
            payload.previousPrice = deleteField();
            payload.oldPrice = deleteField();
        }
        await updateDoc(carRef, payload);
        toast('Preis aktualisiert.', 'success');
        await renderMyListings();
        await loadAllPublicListings();
    } catch (error) {
        console.error('changeCarPrice failed:', error);
        toast('Preis konnte nicht aktualisiert werden.', 'warning');
    }
}

function setEditModalData(car) {
    document.getElementById('edit-listing-id').value = car.id;
    document.getElementById('edit-price').value = Number(car.price || 0);
    document.getElementById('edit-mileage').value = Number(car.mileage || 0);
    document.getElementById('edit-description').value = car.description || '';
    document.getElementById('edit-status').value = car.status || 'active';
    const featureState = normalizeFeatureState(car.featuresByCategory || car.ausstattung || car.features);
    document.querySelectorAll('#edit-feature-boxes input[name="edit-feature"]').forEach(input => {
        input.checked = featureState.flat.includes(input.value);
    });
}

function openEditListingModal(car) {
    setEditModalData(car);
    window.openModal?.('edit-listing-modal');
    syncPartCategoryControls();
    applyTranslations();
}

function setPartEditModalData(part) {
    document.getElementById('edit-part-id').value = part?.id || '';
    document.getElementById('edit-part-title').value = part?.title || '';
    document.getElementById('edit-part-price').value = Number(part?.price || 0) || '';
    document.getElementById('edit-part-category').value = normalizePartCategoryValue(part?.category || '');
    document.getElementById('edit-part-condition').value = part?.condition || '';
    document.getElementById('edit-part-description').value = part?.description || '';
    document.getElementById('edit-part-status').value = part?.status || 'active';
}

function openEditPartModal(part) {
    setPartEditModalData(part);
    window.openModal?.('edit-part-listing-modal');
    syncPartCategoryControls();
    applyTranslations();
}

async function saveListingEdit(event) {
    event?.preventDefault();
    const listingId = document.getElementById('edit-listing-id').value;
    if (!listingId) return;
    const featureState = getSelectedFeatureState('#edit-feature-boxes', 'edit-feature');
    const newPrice = Number(document.getElementById('edit-price').value || 0);
    const payload = {
        price: newPrice,
        updatedAt: serverTimestamp(),
        mileage: Number(document.getElementById('edit-mileage').value || 0),
        km: Number(document.getElementById('edit-mileage').value || 0),
        description: document.getElementById('edit-description').value.trim(),
        status: document.getElementById('edit-status').value,
        features: featureState.flat,
        ausstattung: featureState.flat,
        featuresByCategory: featureState.byCategory
    };
    try {
        const currentSnap = await getDoc(doc(db, 'cars', listingId));
        if (currentSnap.exists()) {
            const currentData = currentSnap.data() || {};
            const currentPrice = Number(currentData.price || 0);
            const currentOriginalPrice = Number(currentData.originalPrice || currentData.previousPrice || currentData.oldPrice || 0);
            if (newPrice > 0 && currentPrice > 0 && newPrice < currentPrice) {
                payload.previousPrice = currentPrice;
                payload.oldPrice = currentPrice;
                payload.originalPrice = currentOriginalPrice > 0 ? currentOriginalPrice : currentPrice;
            } else {
                payload.previousPrice = deleteField();
                payload.oldPrice = deleteField();
            }
        }
        await updateDoc(doc(db, 'cars', listingId), payload);
        window.closeModal?.('edit-listing-modal');
        toast('Inserat aktualisiert.', 'success');
        await renderMyListings();
        await loadAllPublicListings();
    } catch (error) {
        console.error('saveListingEdit failed:', error);
        toast('Inserat konnte nicht aktualisiert werden.', 'warning');
    }
}

async function deletePartListing(partId) {
    if (!window.confirm(tr('delete_part_confirm', 'Dieses Teil-Inserat wirklich löschen?'))) return;
    try {
        await deleteDoc(doc(db, 'parts', partId));
        toast('Teil-Inserat gelöscht.', 'success');
        await renderMyListings();
        await loadParts();
    } catch (error) {
        console.error('deletePartListing failed:', error);
        toast('Teil-Inserat konnte nicht gelöscht werden.', 'warning');
    }
}

async function changePartPrice(partId) {
    const input = window.prompt(tr('prompt_new_price', 'Neuen Preis eingeben (€):'));
    if (input == null) return;
    const newPrice = Number(input);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
        toast('Bitte einen gültigen Preis eingeben.', 'warning');
        return;
    }
    try {
        const partRef = doc(db, 'parts', partId);
        const snap = await getDoc(partRef);
        if (!snap.exists()) {
            toast('Teil wurde nicht gefunden.', 'warning');
            return;
        }
        const data = snap.data() || {};
        const currentPrice = Number(data.price || 0);
        const payload = { price: newPrice, updatedAt: serverTimestamp() };
        if (currentPrice > 0 && newPrice < currentPrice) {
            payload.previousPrice = currentPrice;
            payload.oldPrice = currentPrice;
            payload.originalPrice = Number(data.originalPrice || currentPrice);
        } else {
            payload.previousPrice = deleteField();
            payload.oldPrice = deleteField();
        }
        await updateDoc(partRef, payload);
        toast('Teil-Preis aktualisiert.', 'success');
        await renderMyListings();
        await loadParts();
    } catch (error) {
        console.error('changePartPrice failed:', error);
        toast('Teil-Preis konnte nicht aktualisiert werden.', 'warning');
    }
}

async function editPartListing(partId) {
    try {
        const partRef = doc(db, 'parts', partId);
        const snap = await getDoc(partRef);
        if (!snap.exists()) {
            toast('Teil wurde nicht gefunden.', 'warning');
            return;
        }
        openEditPartModal({ id: snap.id, ...snap.data() });
    } catch (error) {
        console.error('editPartListing failed:', error);
        toast('Teil-Inserat konnte nicht bearbeitet werden.', 'warning');
    }
}

async function savePartListingEdit(event) {
    event?.preventDefault();
    const listingId = document.getElementById('edit-part-id').value;
    if (!listingId) return;
    const title = document.getElementById('edit-part-title').value.trim();
    const price = Number(document.getElementById('edit-part-price').value || 0);
    const category = document.getElementById('edit-part-category').value.trim();
    const condition = document.getElementById('edit-part-condition').value.trim();
    const description = document.getElementById('edit-part-description').value.trim();
    const status = document.getElementById('edit-part-status').value.trim() || 'active';
    if (!title || !category || !condition || !description || price <= 0) {
        toast('Bitte alle Pflichtfelder im Teile-Inserat ausfüllen.', 'warning');
        return;
    }
    try {
        const currentSnap = await getDoc(doc(db, 'parts', listingId));
        const payload = {
            title,
            price,
            updatedAt: serverTimestamp(),
            category,
            condition,
            description,
            status
        };
        if (currentSnap.exists()) {
            const currentData = currentSnap.data() || {};
            const currentPrice = Number(currentData.price || 0);
            const currentOriginalPrice = Number(currentData.originalPrice || currentData.previousPrice || currentData.oldPrice || 0);
            if (price > 0 && currentPrice > 0 && price < currentPrice) {
                payload.previousPrice = currentPrice;
                payload.oldPrice = currentPrice;
                payload.originalPrice = currentOriginalPrice > 0 ? currentOriginalPrice : currentPrice;
            } else {
                payload.previousPrice = deleteField();
                payload.oldPrice = deleteField();
            }
        }
        await updateDoc(doc(db, 'parts', listingId), payload);
        window.closeModal?.('edit-part-listing-modal');
        toast('Teil-Inserat aktualisiert.', 'success');
        await renderMyListings();
        await loadParts();
    } catch (error) {
        console.error('savePartListingEdit failed:', error);
        toast('Teil-Inserat konnte nicht aktualisiert werden.', 'warning');
    }
}

function readCachedMyListings(userId) {
    try {
        const cacheKey = `hs_my_listings_cache_${userId}`;
        const values = [
            sessionStorage.getItem(cacheKey),
            localStorage.getItem(cacheKey)
        ];
        for (const value of values) {
            const cached = value ? JSON.parse(value) : null;
            if (cached && Array.isArray(cached.cars) && Array.isArray(cached.parts)) {
                return cached;
            }
        }
        return null;
    } catch (error) {
        console.warn('Unable to read cached my listings:', error);
        return null;
    }
}

function writeCachedMyListings(userId, cars, parts) {
    const serialized = JSON.stringify({
        cars,
        parts,
        updatedAt: Date.now()
    });
    try {
        sessionStorage.setItem(`hs_my_listings_cache_${userId}`, serialized);
    } catch (error) {
        console.warn('Unable to cache my listings:', error);
    }
    try {
        localStorage.setItem(`hs_my_listings_cache_${userId}`, serialized);
    } catch (error) {
        console.warn('Unable to write shared my listings cache:', error);
    }
}

function loadMyListingsData(userId) {
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedUserId) return Promise.reject(new Error('Missing user id for listings query.'));
    const existingPromise = myListingsLoadPromises.get(normalizedUserId);
    if (existingPromise) return existingPromise;

    const carsQueries = [
        query(collection(db, 'cars'), where('ownerId', '==', normalizedUserId)),
        query(collection(db, 'cars'), where('userId', '==', normalizedUserId))
    ];
    const partsQueries = [
        query(collection(db, 'parts'), where('ownerId', '==', normalizedUserId)),
        query(collection(db, 'parts'), where('userId', '==', normalizedUserId))
    ];
    const loadPromise = Promise.all([
        Promise.all(carsQueries.map(queryRef => getDocsWithTimeout(queryRef, 4500))),
        Promise.all(partsQueries.map(queryRef => getDocsWithTimeout(queryRef, 4500)))
    ]).then(([carsSnapshots, partsSnapshots]) => {
        const carMap = new Map();
        carsSnapshots.flat().forEach(snapshot => {
            snapshot.docs.forEach(docSnap => {
                carMap.set(String(docSnap.id), normalizeFirestoreCar(docSnap));
            });
        });
        const partMap = new Map();
        partsSnapshots.flat().forEach(snapshot => {
            snapshot.docs.forEach(docSnap => {
                partMap.set(String(docSnap.id), { id: docSnap.id, ...docSnap.data() });
            });
        });
        const result = { cars: Array.from(carMap.values()), parts: Array.from(partMap.values()) };
        writeCachedMyListings(normalizedUserId, result.cars, result.parts);
        return result;
    }).finally(() => {
        myListingsLoadPromises.delete(normalizedUserId);
    });
    myListingsLoadPromises.set(normalizedUserId, loadPromise);
    return loadPromise;
}

async function renderMyListings(options = {}) {
    const container = document.getElementById('my-listings-dashboard');
    if (!container) return;
    syncMyListingsStateFromUrl();
    const currentUser = auth.currentUser;
    const cachedBeforeAuth = currentUser && !options.background
        ? readCachedMyListings(currentUser.uid)
        : null;
    if (!authStateResolved && !cachedBeforeAuth && !options.background) {
        container.innerHTML = `<div class="no-results" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:100%;min-height:50vh;margin:auto;"><img src="etc_logos/merkliste_logos/hourglass.svg" alt="" style="width:80px;height:80px;object-fit:contain;margin-bottom:20px;"><div style="font-size:20px;font-weight:700;">${tr('route_loading', 'Wird geladen ...')}</div></div>`;
        setTimeout(() => {
            if (!authStateResolved && container.querySelector('.no-results')) {
                container.querySelector('.no-results').innerHTML = `<div style="font-size:20px;font-weight:700;">${tr('route_loading', 'Anmeldung wird im Hintergrund geprüft ...')}</div>`;
            }
        }, 300);
        return;
    }
    const user = currentUser || auth.currentUser;
    if (!user) {
        container.innerHTML = `<div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/merkliste_logos/lock_merkliste.svg" alt="" style="width:80px;height:80px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:22px;font-weight:700;">${tr('route_sign_in_required', 'Bitte anmelden')}</div></div>`;
        return;
    }
        if (!options.background && !cachedBeforeAuth) {
            container.innerHTML = `<div class="no-results my-listings-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/merkliste_logos/hourglass.svg" alt="" style="width: 80px; height: 80px; object-fit: contain; margin-bottom: 20px;"><div style="font-size:20px;font-weight:700;">${tr('route_loading', 'Wird geladen ...')}</div></div>`;
            setTimeout(() => {
                const loading = container.querySelector('.my-listings-loading');
                if (loading) loading.innerHTML = `<div style="font-size:20px;font-weight:700;">${tr('route_loading', 'Daten werden im Hintergrund geladen ...')}</div>`;
            }, 300);
        }
    try {
        const cachedListings = options.background ? null : cachedBeforeAuth || readCachedMyListings(user.uid);
        let cars;
        let parts;
        let usedCache = false;
        if (cachedListings) {
            cars = cachedListings.cars;
            parts = cachedListings.parts;
            usedCache = true;
        } else {
            const listings = await loadMyListingsData(user.uid);
            cars = listings.cars;
            parts = listings.parts;
        }
        const getSelectedListingId = tab => tab === 'parts' ? currentMyListingsSelectedPartId : currentMyListingsSelectedCarId;
        const setSelectedListingId = (tab, id) => {
            if (tab === 'parts') currentMyListingsSelectedPartId = id || '';
            else currentMyListingsSelectedCarId = id || '';
        };
        const renderListingPagination = (totalItems, activePage) => {
            const totalPages = Math.max(1, Math.ceil(totalItems / 5));
            if (totalPages <= 1) return '';
            const buttons = [];
            buttons.push(`<button type="button" data-my-page="${Math.max(1, activePage - 1)}" ${activePage === 1 ? 'disabled' : ''}>&lt;</button>`);
            for (let page = 1; page <= totalPages; page += 1) {
                buttons.push(`<button type="button" data-my-page="${page}" class="${page === activePage ? 'active' : ''}">${page}</button>`);
            }
            buttons.push(`<button type="button" data-my-page="${Math.min(totalPages, activePage + 1)}" ${activePage === totalPages ? 'disabled' : ''}>&gt;</button>`);
            return `<div class="my-listings-pagination">${buttons.join('')}</div>`;
        };
        const renderActionButton = (label, dataAttr, value, variant = 'dark', icon = '') => `
            <button class="my-listings-action-btn ${variant}" type="button" ${dataAttr}="${escapeHtml(value)}">
                <span class="my-listings-action-icon" aria-hidden="true">${icon}</span>
                <span>${label}</span>
            </button>
        `;
        const renderCarsList = activeCars => activeCars.map(car => {
            const isSelected = getSelectedListingId('cars') === car.id;
            const image = getCarPreviewImage(car);
            const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<div style="font-size:58px;line-height:1">🚗</div>';
            const yearLabel = escapeHtml(car.year || '—');
            const mileageLabel = `${formatNumber(car.mileage)} km`;
            const statusLabel = escapeHtml(localizedStatusLabel(car.status));
            return `<div class="my-listings-card ${isSelected ? 'selected' : ''}" data-my-card-id="${escapeHtml(car.id)}" data-my-card-type="cars">
                <div class="my-listings-card-media listing-card-image" data-open-id="${escapeHtml(car.id)}">${imageMarkup}</div>
                <div class="my-listings-card-body">
                    <div class="my-listings-card-top">
                        <div class="my-listings-price-row">
                            <div class="car-price">${renderPriceBadge(car)}</div>
                            ${car.priceNegotiable ? '<span data-t="vb" class="my-listings-inline-badge dark">VB</span>' : ''}
                            ${statusBadge(car.status)}
                        </div>
                    </div>
                    <h3 class="my-listings-card-title listing-card-title" data-open-id="${escapeHtml(car.id)}">${escapeHtml(car.title)}</h3>
                    <div class="my-listings-card-meta">
    <span><img src="etc_logos/meine_inserate_etc_logos/calendar.svg" alt="" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; object-fit: contain;">${yearLabel}</span>
    <span><img src="etc_logos/meine_inserate_etc_logos/odometer.svg" alt="" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; object-fit: contain;">${mileageLabel}</span>
    <span>${escapeHtml(car.make || '—')} ${escapeHtml(car.model || '')}</span>
</div>
<div class="my-listings-card-stats">
    <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="etc_logos/meine_inserate_etc_logos/eye_view.svg" alt="" style="width: 14px; height: 14px; object-fit: contain;">${formatNumber(car.viewsCount)} <span data-t="views_label">${escapeHtml(t('views_label'))}</span></span>
    <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="etc_logos/meine_inserate_etc_logos/wp_click.svg" alt="" style="width: 14px; height: 14px; object-fit: contain;">${formatNumber(car.whatsappClicks)} ${tr('route_whatsapp_clicks', 'WhatsApp-Klicks')}</span>
</div>
<div class="my-listings-card-footer">
    <span class="my-listings-inline-badge success">${statusLabel}</span>
</div>
                </div>
                <div class="my-listings-card-actions">
                    ${renderActionButton(tr('route_details', 'Details'), 'data-open-id', car.id, 'dark', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                    ${renderActionButton(tr('my_listings_edit', 'Bearbeiten'), 'data-edit-id', car.id, 'dark', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                    ${renderActionButton(tr('my_listings_change_price', 'Preis ändern'), 'data-price-id', car.id, 'light', '€', 'style="display: flex; align-items: center; justify-content: flex-start; gap: 8px; text-align: left; padding-left: 14px;"')}
                    ${renderActionButton(tr('my_listings_delete', 'Löschen'), 'data-delete-id', car.id, 'danger', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                </div>
            </div>`;
        }).join('');
        const renderPartsList = activeParts => activeParts.map(part => {
            const isSelected = getSelectedListingId('parts') === part.id;
            const image = getPartImageList(part)[0] || '';
            const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<img src="etc_logos/settings_logo/settings-logo.svg" alt="" style="width:58px;height:58px;object-fit:contain;">';
            const statusLabel = escapeHtml(localizedStatusLabel(part.status));
            return `<div class="my-listings-card ${isSelected ? 'selected' : ''}" data-my-card-id="${escapeHtml(part.id)}" data-my-card-type="parts">
                <div class="my-listings-card-media listing-card-image" data-part-open-id="${escapeHtml(part.id)}">${imageMarkup}</div>
                <div class="my-listings-card-body">
                    <div class="my-listings-card-top">
                        <div class="my-listings-price-row">
                            <div class="car-price">${renderPriceBadge(part)}</div>
                            ${part.priceNegotiable ? '<span data-t="vb" class="my-listings-inline-badge dark">VB</span>' : ''}
                            ${statusBadge(part.status)}
                        </div>
                    </div>
                    <h3 class="my-listings-card-title listing-card-title" data-part-open-id="${escapeHtml(part.id)}">${escapeHtml(part.title || 'Ersatzteil')}</h3>
                    <div class="my-listings-card-meta">
                        <span><img src="etc_logos/meine_inserate_etc_logos/tag_car_parts.svg" alt="" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; object-fit: contain;">${escapeHtml(localizedPartCategory(part.category))}</span>
                        <span><img src="etc_logos/meine_inserate_etc_logos/tools.svg" alt="" style="width: 14px; height: 14px; vertical-align: middle; margin-right: 4px; object-fit: contain;">${escapeHtml(localizedPartCondition(part.condition))}</span>
                    </div>
                    <div class="my-listings-card-stats">
                        <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="etc_logos/meine_inserate_etc_logos/eye_view.svg" alt="" style="width: 14px; height: 14px; object-fit: contain;">${formatNumber(part.viewsCount)} <span data-t="views_label">${escapeHtml(t('views_label'))}</span></span>
                        <span style="display: inline-flex; align-items: center; gap: 4px;"><img src="etc_logos/meine_inserate_etc_logos/wp_click.svg" alt="" style="width: 14px; height: 14px; object-fit: contain;">${formatNumber(part.whatsappClicks)} ${tr('route_whatsapp_clicks', 'WhatsApp-Klicks')}</span>
                    </div>
                    <div class="my-listings-card-footer">
                        <span class="my-listings-inline-badge success">${statusLabel}</span>
                    </div>
                </div>
                <div class="my-listings-card-actions">
                    ${renderActionButton(tr('route_details', 'Details'), 'data-part-open-id', part.id, 'dark', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                    ${renderActionButton(tr('my_listings_edit', 'Bearbeiten'), 'data-part-edit-id', part.id, 'dark', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                    ${renderActionButton(tr('my_listings_change_price', 'Preis ändern'), 'data-part-price-id', part.id, 'light', '€', 'style="display: flex; align-items: center; justify-content: flex-start; gap: 8px; text-align: left; padding-left: 14px;"')}
                    ${renderActionButton(tr('my_listings_delete', 'Löschen'), 'data-part-delete-id', part.id, 'danger', '', 'style="display: flex; align-items: center; justify-content: center; text-align: center;"')}
                </div>
            </div>`;
        }).join('');
        const activeItems = currentMyListingsTab === 'parts' ? parts : cars;
        const totalPages = Math.max(1, Math.ceil(activeItems.length / 5));
        currentMyListingsPage = Math.min(Math.max(1, currentMyListingsPage), totalPages);
        const routeState = getMyListingsRouteState(new URLSearchParams(window.location.search));
        if (routeState.tab !== currentMyListingsTab || routeState.page !== currentMyListingsPage) {
            pushMyListingsHistory(currentMyListingsTab, currentMyListingsPage, { replace: true });
        }
        const pageStart = (currentMyListingsPage - 1) * 5;
        const pageEnd = pageStart + 5;
        const pagedCars = cars.slice(pageStart, pageEnd);
        const pagedParts = parts.slice(pageStart, pageEnd);
        const activePageItems = currentMyListingsTab === 'parts' ? pagedParts : pagedCars;
        const currentSelection = getSelectedListingId(currentMyListingsTab);
        if (!activePageItems.some(item => item.id === currentSelection)) {
            setSelectedListingId(currentMyListingsTab, activePageItems[0]?.id || '');
        }
        const activeHeaderTitle = currentMyListingsTab === 'parts' ? t('listings_parts') : t('listings_cars');
        container.innerHTML = `
            <div class="my-listings-layout">
              <div class="listings-sidebar">
                <div class="my-listings-tabs">
                  <button type="button" class="my-listings-tab ${currentMyListingsTab === 'cars' ? 'active' : ''}" data-my-listings-tab="cars"><span aria-hidden="true"></span><span data-t="listings_cars">${t('listings_cars')}</span></button>
                  <button type="button" class="my-listings-tab ${currentMyListingsTab === 'parts' ? 'active' : ''}" data-my-listings-tab="parts"><span aria-hidden="true"></span><span data-t="listings_parts">${t('listings_parts')}</span></button>
                </div>
              </div>
              <div class="my-listings-main">
                <div class="my-listings-header">
                  <h2 class="my-listings-header-title">${activeHeaderTitle}</h2>
                </div>
                <div class="my-listings-panel ${currentMyListingsTab === 'cars' ? 'active' : ''}" data-my-listings-panel="cars">
                    ${cars.length ? `<div class="my-listings-list">${renderCarsList(pagedCars)}</div>${renderListingPagination(cars.length, currentMyListingsPage)}` : `<div class="empty-state"><img src="etc_logos/merkliste_logos/car_car_parts_not_available.svg" alt="" style="width: 48px; height: 48px; object-fit: contain; margin-bottom: 12px;"><div class="empty-title">${tr('route_no_active_listings', 'Keine aktiven Inserate')}</div></div>`}
                </div>
                <div class="my-listings-panel ${currentMyListingsTab === 'parts' ? 'active' : ''}" data-my-listings-panel="parts">
                    ${parts.length ? `<div class="my-listings-list">${renderPartsList(pagedParts)}</div>${renderListingPagination(parts.length, currentMyListingsPage)}` : `<div class="empty-state"><img src="etc_logos/merkliste_logos/car_car_parts_not_available.svg" alt="" style="width: 48px; height: 48px; object-fit: contain; margin-bottom: 12px;"><div class="empty-title" data-t="no_spare_parts">${t('no_spare_parts')}</div></div>`}
                </div>
              </div>
            </div>
        `;
        container.querySelectorAll('[data-my-listings-tab]').forEach(button => {
            button.addEventListener('click', () => {
                cleanupTransientUi();
                currentMyListingsTab = button.getAttribute('data-my-listings-tab') || 'cars';
                currentMyListingsPage = 1;
                pushMyListingsHistory(currentMyListingsTab, currentMyListingsPage, { replace: true });
                void renderMyListings();
            });
        });
        container.querySelectorAll('[data-my-page]').forEach(button => {
            button.addEventListener('click', () => {
                cleanupTransientUi();
                currentMyListingsPage = Number(button.getAttribute('data-my-page')) || 1;
                pushMyListingsHistory(currentMyListingsTab, currentMyListingsPage, { replace: true });
                void renderMyListings();
            });
        });
        container.querySelectorAll('[data-my-card-id]').forEach(card => {
            card.addEventListener('click', () => {
                setSelectedListingId(card.getAttribute('data-my-card-type'), card.getAttribute('data-my-card-id'));
                void renderMyListings();
            });
        });
        container.querySelectorAll('[data-delete-id]').forEach(button => {
            button.addEventListener('click', async event => {
                event.stopPropagation();
                await deleteListing(button.getAttribute('data-delete-id'));
            });
        });
        container.querySelectorAll('[data-open-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                handleCarCardClick(event, button.getAttribute('data-open-id'));
            });
        });
        container.querySelectorAll('[data-edit-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const car = cars.find(item => item.id === button.getAttribute('data-edit-id'));
                if (car) openEditListingModal(car);
            });
        });
        container.querySelectorAll('[data-price-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                const car = cars.find(item => item.id === button.getAttribute('data-price-id'));
                if (!car) return;
                void changeCarPrice(car.id, car);
            });
        });
        container.querySelectorAll('[data-part-open-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                void openPartDetailPage(button.getAttribute('data-part-open-id'));
            });
        });
        container.querySelectorAll('[data-part-edit-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                void editPartListing(button.getAttribute('data-part-edit-id'));
            });
        });
        container.querySelectorAll('[data-part-price-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                void changePartPrice(button.getAttribute('data-part-price-id'));
            });
        });
        container.querySelectorAll('[data-part-delete-id]').forEach(button => {
            button.addEventListener('click', event => {
                event.stopPropagation();
                void deletePartListing(button.getAttribute('data-part-delete-id'));
            });
        });
        if (usedCache && !options.background) {
            void renderMyListings({ background: true });
        }
    } catch (error) {
        console.error('renderMyListings failed:', error);
        if (!options.background) {
            container.innerHTML = '<div class="empty-state"><span class="empty-icon">⚠️</span><div class="empty-title">Inserate konnten nicht geladen werden</div></div>';
        }
    }
}

function loadMyListingsView(options = {}) {
    return renderMyListings(options);
}

async function handleSignIn(event) {
    event?.preventDefault();
    const email = getInputValue('si-email').toLowerCase();
    const password = document.getElementById('si-password')?.value || '';
    if (!email || !password) {
        toast('Bitte geben Sie E-Mail und Passwort ein.', 'warning');
        return;
    }
    setLoading('btn-signin', true);
    try {
        const methods = await fetchSignInMethodsForEmail(auth, email);
        if (methods.includes('google.com') && !methods.includes('password')) {
            toast('Dieses Konto nutzt Google-Anmeldung. Bitte mit Google fortfahren.', 'warning');
            return;
        }
        await signInWithEmailAndPassword(auth, email, password);
        closeAuthModal();
    } catch (error) {
        if (error?.code === 'auth/invalid-credential' || error?.code === 'auth/wrong-password') {
            toast('E-Mail oder Passwort ist falsch.', 'warning');
            return;
        }
        toast('Die Anmeldung ist fehlgeschlagen.', 'warning');
    } finally {
        setLoading('btn-signin', false);
    }
}

async function handleSignUp(event) {
    event?.preventDefault();
    const firstName = getInputValue('su-fname');
    const lastName = getInputValue('su-lname');
    const email = getInputValue('su-email').toLowerCase();
    const password = document.getElementById('su-password')?.value || '';
    if (!email || !password) {
        toast('Bitte geben Sie E-Mail und Passwort ein.', 'warning');
        return;
    }
    setLoading('btn-signup', true);
    try {
        const methods = await fetchSignInMethodsForEmail(auth, email);
        if (methods.includes('google.com') && !methods.includes('password')) {
            toast('Diese E-Mail ist mit Google registriert. Bitte melden Sie sich mit Google an.', 'warning');
            return;
        }
        const credential = await createUserWithEmailAndPassword(auth, email, password);
        const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();
        if (displayName) {
            await updateProfile(credential.user, { displayName });
        }
        await setDoc(doc(db, 'users', credential.user.uid), { displayName, email }, { merge: true });
        closeAuthModal();
    } catch (error) {
        if (error?.code === 'auth/email-already-in-use') {
            toast('Diese E-Mail-Adresse wird bereits verwendet.', 'warning');
            return;
        }
        toast('Registrierung fehlgeschlagen.', 'warning');
    } finally {
        setLoading('btn-signup', false);
    }
}

async function handleGoogleSignIn(event) {
    event?.preventDefault();
    try {
        const credential = await signInWithPopup(auth, googleProvider);
        await setDoc(doc(db, 'users', credential.user.uid), {
            displayName: credential.user.displayName || '',
            email: credential.user.email || '',
            photoURL: credential.user.photoURL || '',
            avatarUrl: credential.user.photoURL || '',
            avatar: credential.user.photoURL || ''
        }, { merge: true });
        closeAuthModal();
    } catch (error) {
        toast(error?.message || 'Google Anmeldung fehlgeschlagen.', 'warning');
    }
}

async function handleLogout(event) {
    event?.preventDefault();
    try {
        await signOut(auth);
    } catch (error) {
        toast(error?.message || 'Abmeldung fehlgeschlagen.', 'warning');
    }
}

function updateNavForAuth(user = auth.currentUser) {
    const userWrap = document.getElementById('nav-user-widget');
    const avatarEl = document.getElementById('nav-avatar-initials');
    const firstEl = document.getElementById('nav-user-firstname');
    const fullNameEl = document.getElementById('nav-ud-fullname');
    const emailEl = document.getElementById('nav-ud-email');
    const container = document.getElementById('nav-auth-container');
    if (user) {
        const email = user.email || '';
        const displayName = user.displayName || email || 'Konto';
        const avatarUrl = getResolvedAvatarUrl(currentUserProfileCache || {}, user);
        container?.classList.remove('nav-state-loading', 'nav-state-guest');
        container?.classList.add('nav-state-auth');
        if (userWrap) userWrap.style.display = '';
        if (avatarEl) {
            if (avatarUrl) {
                avatarEl.textContent = '';
                avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
                avatarEl.style.backgroundSize = 'cover';
                avatarEl.style.backgroundPosition = 'center';
            } else {
                avatarEl.textContent = (displayName[0] || 'U').toUpperCase();
                avatarEl.style.backgroundImage = '';
            }
        }
        if (firstEl) firstEl.textContent = displayName;
        if (fullNameEl) fullNameEl.textContent = displayName;
        if (emailEl) emailEl.textContent = email;
    } else {
        container?.classList.remove('nav-state-loading', 'nav-state-auth');
        container?.classList.add('nav-state-guest');
        if (userWrap) userWrap.style.display = 'none';
        if (avatarEl) {
            avatarEl.textContent = '?';
            avatarEl.style.backgroundImage = '';
        }
    }
}

function hasCachedCatalogEntries(storage, key) {
    try {
        const value = storage.getItem(key);
        const entries = value ? JSON.parse(value) : null;
        return Array.isArray(entries) && entries.length > 0;
    } catch (error) {
        console.warn(`Unable to inspect catalog cache ${key}:`, error);
        return false;
    }
}

function mirrorCatalogCache(key, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const serialized = JSON.stringify(entries);
    try {
        sessionStorage.setItem(key, serialized);
    } catch (error) {
        console.warn(`Unable to write session catalog cache ${key}:`, error);
    }
    try {
        localStorage.setItem(key, serialized);
    } catch (error) {
        console.warn(`Unable to write shared catalog cache ${key}:`, error);
    }
}

function bootstrapCatalogCache() {
    const jobs = [];
    if (!hasCachedCatalogEntries(sessionStorage, 'hs_all_cars_cache') &&
        !hasCachedCatalogEntries(localStorage, 'hs_all_cars_cache')) {
        jobs.push(listCarsCached()
            .then(cars => mirrorCatalogCache('hs_all_cars_cache', cars))
            .catch(error => console.warn('Background car catalog bootstrap failed:', error)));
    }
    if (!hasCachedCatalogEntries(sessionStorage, 'hs_all_parts_cache') &&
        !hasCachedCatalogEntries(localStorage, 'hs_all_parts_cache')) {
        jobs.push(listPartsCached()
            .then(parts => mirrorCatalogCache('hs_all_parts_cache', parts))
            .catch(error => console.warn('Background part catalog bootstrap failed:', error)));
    }
    return Promise.allSettled(jobs);
}

async function loadAllPublicListings(forceRefresh = false) {
    try {
        const cars = await fetchCarsFromFirestore(forceRefresh);
        allCarsCache = Array.isArray(cars) ? cars : [];
        window.__HS_ALL_CARS_CACHE = allCarsCache;
        renderHomeListingCards(cars);
        const params = new URLSearchParams(window.location.search);
        if (typeof window.applyFilters === 'function' &&
            typeof hasInlineSearchFilterParams === 'function' &&
            hasInlineSearchFilterParams(params)) {
            window.applyFilters();
        }
    } catch (error) {
        console.error('loadAllPublicListings failed:', error);
        showDatabaseConnectionWarning();
        renderHomeListingCards(allCarsCache);
    }
}

async function searchCars(event) {
    event?.preventDefault();
    if (typeof window.showPage === 'function') {
        window.showPage('search');
    }
    currentSearchMode = 'cars';
    renderCarSearchModeLayout();
    const filters = readSearchFilters();
    const urlFilters = {
        make: filters.brand || '',
        model: filters.model || '',
        fuel: filters.fuel || '',
        body: filters.body || '',
        transmission: filters.transmission || '',
        priceMin: Number(filters.minPrice || 0),
        priceMax: Number.isFinite(filters.maxPrice) ? filters.maxPrice : 0,
        kmMin: Number(filters.minMileage || 0),
        kmMax: Number.isFinite(filters.maxMileage) ? filters.maxMileage : 0,
        yearMin: Number(filters.firstRegFrom || 0),
        yearMax: Number.isFinite(filters.firstRegTo) ? filters.firstRegTo : 0,
        powerMin: Number(filters.powerMin || 0),
        powerMax: Number.isFinite(filters.powerMax) ? filters.powerMax : 0,
        color: filters.color || '',
        doors: filters.doors || '',
        seatsMin: Number(filters.seatsMin || 0),
        seatsMax: Number.isFinite(filters.seatsMax) ? filters.seatsMax : 0,
        sellerType: filters.sellerTypes?.[0] || '',
        zip: filters.zip || '',
        dealerOwnerId: readCarsCatalogParamsFromUrl().dealerOwnerId || '',
        dealerName: readCarsCatalogParamsFromUrl().dealerName || '',
        status: filters.status || ''
    };
    setCatalogQuery('cars', urlFilters, { replace: isPageActive('search') });
    renderCarFilterTags({
        make: urlFilters.make,
        model: urlFilters.model,
        body: urlFilters.body,
        transmission: urlFilters.transmission,
        color: urlFilters.color,
        doors: urlFilters.doors,
        powerMin: urlFilters.powerMin,
        powerMax: urlFilters.powerMax,
        seatsMin: urlFilters.seatsMin,
        seatsMax: urlFilters.seatsMax,
        sellerTypes: urlFilters.sellerType ? [urlFilters.sellerType] : [],
        priceMax: urlFilters.priceMax,
        priceMin: urlFilters.priceMin,
        kmMax: urlFilters.kmMax,
        kmMin: urlFilters.kmMin,
        yearMin: urlFilters.yearMin,
        yearMax: urlFilters.yearMax,
        zip: urlFilters.zip,
        dealerName: urlFilters.dealerName,
        fuels: urlFilters.fuel ? [urlFilters.fuel] : [],
        selectedFeatures: filters.selectedFeatures
    });
    const constraints = [];
    if (filters.brand) constraints.push(where('brand', '==', filters.brand));
    if (filters.model) constraints.push(where('model', '==', filters.model));
    if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) constraints.push(where('price', '<=', filters.maxPrice));
    if (Number.isFinite(filters.maxMileage) && filters.maxMileage > 0) constraints.push(where('mileage', '<=', filters.maxMileage));
    if (filters.fuel) constraints.push(where('fuel', '==', filters.fuel));
    if (filters.firstRegFrom > 0) constraints.push(where('year', '>=', filters.firstRegFrom));
    try {
        const carsRef = collection(db, 'cars');
        const snapshot = constraints.length ? await getDocs(query(carsRef, ...constraints)) : await getDocs(carsRef);
        currentSearchCars = snapshot.docs.map(normalizeFirestoreCar).filter(car => {
            const filterColor = filters.color;
            const filterFuel = filters.fuel;
            const filterTrans = filters.transmission;
            const filterBody = filters.body;
            const matchesColor = !filterColor || [car.color, car.exteriorColor, car.farbe]
                .some(val => val && String(val).toLowerCase() === String(filterColor).toLowerCase());
            const matchesFuel = !filterFuel || [car.fuel, car.fuelType, car.kraftstoff]
                .some(val => val && String(val).toLowerCase() === String(filterFuel).toLowerCase());
            const matchesTransmission = !filterTrans || [car.transmission, car.getriebe]
                .some(val => val && String(val).toLowerCase() === String(filterTrans).toLowerCase());
            const matchesBody = !filterBody || [car.body, car.bodyType, car.karosserie]
                .some(val => val && String(val).toLowerCase() === String(filterBody).toLowerCase());
            if (!matchesColor || !matchesFuel || !matchesTransmission || !matchesBody) return false;
            if (urlFilters.sellerType && String(car.sellerType || car.seller_type || car.dealer?.type || '').trim() !== urlFilters.sellerType) return false;
            if (urlFilters.zip && !`${car.zip || car.location || ''}`.toLowerCase().includes(String(urlFilters.zip).toLowerCase())) return false;
            if (urlFilters.dealerOwnerId && String(car.ownerId || car.userId || '').trim() !== String(urlFilters.dealerOwnerId).trim()) return false;
            if (!urlFilters.dealerOwnerId && urlFilters.dealerName && normalizeCompareValue(car.sellerName || car.contactName || car.ownerEmail || car.contactEmail || '') !== normalizeCompareValue(urlFilters.dealerName)) return false;
            return matchesSearchFilters(car, filters);
        });
        renderDealerFilterBanner(urlFilters);
        renderSearchCards(currentSearchCars);
    } catch (error) {
        console.error('searchCars failed:', error);
        toast(tr('searchFailed', 'Suche fehlgeschlagen.'), 'warning');
    }
}

function bindSortControl() {
    const select = document.getElementById('results-sort-select') || document.getElementById('sort-select');
    if (!select) return;
    select.addEventListener('change', () => {
        if (currentSearchMode === 'parts') {
            currentPartsSort = select.value;
            renderPartsCatalogPage();
            return;
        }
        currentSearchSort = select.value;
        renderSearchCards(currentSearchCars);
    });
}

async function toggleFavorite(type, item) {
    const user = auth.currentUser;
    if (!user) {
        toast(tr('signInToSave', 'Bitte melden Sie sich an, um Favoriten zu speichern.'), 'warning');
        openAuthModal();
        return false;
    }
    const favoritesRef = doc(db, 'users', user.uid, 'favorites', 'state');
    const targetField = type === 'parts' ? 'partIds' : 'carIds';
    const normalizedId = String(item.id);
    try {
        const existing = await getDoc(favoritesRef);
        const ids = existing.exists() ? (existing.data()?.[targetField] || []) : [];
        if (ids.includes(normalizedId)) {
            await setDoc(favoritesRef, { [targetField]: arrayRemove(normalizedId) }, { merge: true });
            if (type === 'parts') favoritePartIdsCache.delete(normalizedId);
            if (type === 'cars') favoriteCarIdsCache.delete(normalizedId);
            updateNavFavBadge();
            await checkPriceDropsForUser(user.uid);
            return false;
        }
        await setDoc(favoritesRef, { [targetField]: arrayUnion(normalizedId) }, { merge: true });
        if (type === 'parts') favoritePartIdsCache.add(normalizedId);
        if (type === 'cars') favoriteCarIdsCache.add(normalizedId);
        updateNavFavBadge();
        await checkPriceDropsForUser(user.uid);
        return true;
    } catch (error) {
        console.error('toggleFavorite failed:', error);
        toast('Favorit konnte nicht gespeichert werden.', 'warning');
        return false;
    }
}

function chunkIds(ids, chunkSize = 30) {
    const chunks = [];
    for (let index = 0; index < ids.length; index += chunkSize) {
        chunks.push(ids.slice(index, index + chunkSize));
    }
    return chunks;
}

async function fetchDocsByIdsInBatches(collectionName, ids, mapper) {
    const normalizedIds = Array.from(new Set((ids || []).map(id => String(id).trim()).filter(Boolean)));
    if (!normalizedIds.length) {
        return [];
    }
    const docsById = new Map();
    for (const idChunk of chunkIds(normalizedIds, 30)) {
        const chunkQuery = query(collection(db, collectionName), where(documentId(), 'in', idChunk));
        const snapshot = await getDocsWithTimeoutRetry(chunkQuery, { timeoutMs: FIRESTORE_QUERY_TIMEOUT_MS, retries: 1, retryDelayMs: 700 });
        snapshot.docs.forEach(docSnap => {
            const value = typeof mapper === 'function' ? mapper(docSnap) : ({ id: docSnap.id, ...docSnap.data() });
            docsById.set(String(docSnap.id), value);
        });
    }
    return normalizedIds.map(id => docsById.get(id)).filter(Boolean);
}

function getFavoritesPanel(content) {
    let panel = content.querySelector('[data-favorites-panel]');
    if (!panel) {
        panel = document.createElement('div');
        panel.className = 'favs-panel';
        panel.setAttribute('data-favorites-panel', '');
        content.appendChild(panel);
    }
    return panel;
}

function renderFavoritesEmptyState(content, messageKey = 'noFavorites', fallbackMessage = 'Noch keine Favoriten') {
    const panel = getFavoritesPanel(content);
    panel.className = 'favs-panel is-empty';
    panel.innerHTML = `<div class="empty-state"><img src="etc_logos/merkliste_logos/favs_not_available.svg" alt="Merkliste leer" class="empty-icon" style="width: 48px; height: 48px; object-fit: contain; margin-bottom: 12px;"><div class="empty-title" data-t="${escapeHtml(messageKey)}">${tr(messageKey, fallbackMessage)}</div></div>`;
}

function getFavoritesEmptyMessage(tab, favoriteData = {}) {
    const hasAnyFavorite = (favoriteData.carIds || []).length > 0 || (favoriteData.partIds || []).length > 0;
    if (!hasAnyFavorite) {
        return { messageKey: 'noFavorites', fallbackMessage: 'Noch keine Inserate' };
    }
    return tab === 'parts'
        ? { messageKey: 'no_spare_parts', fallbackMessage: 'Keine Ersatzteile' }
        : { messageKey: 'no_vehicles', fallbackMessage: 'Keine Fahrzeuge' };
}

function removeFavoriteCardFromDom(type, id) {
    const content = document.getElementById('favs-content');
    if (!content || !document.getElementById('page-favorites')?.classList.contains('active')) {
        return;
    }
    if ((type === 'parts' && currentFavoritesTab !== 'parts') || (type === 'cars' && currentFavoritesTab !== 'cars')) {
        return;
    }
    const card = content.querySelector(`[data-favorite-type="${type}"][data-favorite-id="${id}"]`);
    if (card) {
        card.remove();
    }
    const remaining = content.querySelectorAll('[data-favorites-panel] .favs-grid [data-favorite-type]').length;
    if (!remaining) {
        const messageKey = currentFavoritesTab === 'parts' ? 'no_spare_parts' : 'no_vehicles';
        const fallbackMessage = currentFavoritesTab === 'parts' ? t('no_spare_parts') : 'Keine Fahrzeuge';
        renderFavoritesEmptyState(content, messageKey, fallbackMessage);
    }
}

async function toggleFavoritePart(partId, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    const normalizedId = decodeURIComponent(String(partId || '').trim());
    if (!normalizedId) return;
    let part = allPartsCache.find(entry => String(entry.id) === normalizedId);
    if (!part) {
        try {
            const partSnap = await getDoc(doc(db, 'parts', normalizedId));
            if (partSnap.exists()) {
                part = { id: partSnap.id, ...partSnap.data() };
                allPartsCache = [part, ...allPartsCache.filter(entry => String(entry.id) !== normalizedId)];
            }
        } catch (error) {
            console.error('toggleFavoritePart load failed:', error);
        }
    }
    if (!part) {
        toast('Teil konnte nicht gefunden werden.', 'warning');
        return;
    }
    const added = await toggleFavorite('parts', part);
    syncPartFavoriteButtons(normalizedId);
    const detailFavBtn = document.getElementById('part-page-fav-btn');
    if (detailFavBtn && window.__detailPart && String(window.__detailPart.id) === normalizedId) {
        detailFavBtn.style.color = added ? '#e0132b' : '';
        detailFavBtn.innerHTML = `${added ? '♥' : '♡'} <span>${added ? t('btn_saved') : t('btn_save')}</span>`;
    }
    if (!added) {
        removeFavoriteCardFromDom('parts', normalizedId);
    }
}

async function toggleFavoriteCar(car, event) {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (typeof car === 'string') {
        const normalizedId = decodeURIComponent(car);
        car = (allCarsCache || []).find(item => String(item?.id || '') === normalizedId) ||
            (window.__HS_ALL_CARS_CACHE || []).find(item => String(item?.id || '') === normalizedId);
    }
    if (!car?.id) return false;
    const added = await toggleFavorite('cars', car);
    document.querySelectorAll('[data-list-favorite]').forEach(button => {
        if (String(button.getAttribute('data-list-favorite') || '') !== String(car.id)) return;
        button.classList.toggle('active', added);
        button.textContent = `${added ? '♥' : '♡'} ${t(added ? 'btn_saved' : 'btn_save')}`;
    });
    if (!added) {
        removeFavoriteCardFromDom('cars', String(car.id));
    }
    return added;
}

async function toggleDetailFav(event) {
    event?.preventDefault();
    if (!window.__detailCar) return;
    const added = await toggleFavoriteCar(window.__detailCar, event);
    toast(added ? 'Fahrzeug gespeichert.' : 'Fahrzeug entfernt.', 'success');
}

async function clearAllFavs() {
    const user = auth.currentUser;
    if (!user) {
        toast(`${tr('route_sign_in_required', 'Bitte anmelden')}.`, 'warning');
        return;
    }
    const favoritesRef = doc(db, 'users', user.uid, 'favorites', 'state');
    const targetField = currentFavoritesTab === 'parts' ? 'partIds' : 'carIds';
    try {
        await setDoc(favoritesRef, { [targetField]: [] }, { merge: true });
        if (currentFavoritesTab === 'parts') favoritePartIdsCache = new Set();
        if (currentFavoritesTab === 'cars') favoriteCarIdsCache = new Set();
        await renderFavorites();
    } catch (error) {
        console.error('clearAllFavs failed:', error);
        toast('Favoriten konnten nicht geleert werden.', 'warning');
    }
}

async function activatePriceAlert() {
    const user = auth.currentUser;
    if (!user) {
        toast(`${tr('route_sign_in_required', 'Bitte anmelden')}, um Preisalarme zu verwalten.`, 'warning');
        openAuthModal();
        return;
    }
    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const currentEnabled = Boolean(userData.priceAlertsEnabled ?? userData.notificationPreferences?.priceDrops ?? userData.notifications?.priceDrops ?? true);
        const nextEnabled = !currentEnabled;

        const updateData = {
            priceAlertsEnabled: nextEnabled,
            notificationPreferences: {
                ...(userData.notificationPreferences || {}),
                priceDrops: nextEnabled,
                priceAlertsEnabled: nextEnabled
            },
            notifications: {
                ...(userData.notifications || {}),
                priceDrops: nextEnabled
            },
            updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, 'users', user.uid), updateData, { merge: true });
        await setDoc(doc(db, 'users', user.uid, 'preferences', 'alerts'), {
            priceAlert: nextEnabled,
            priceAlertsEnabled: nextEnabled,
            updatedAt: serverTimestamp()
        }, { merge: true });
        await refreshPriceAlertBadge();
        await checkPriceDropsForUser(user.uid);
        toast(nextEnabled ? tr('priceAlertOn', 'Preisalarm aktiviert.') : 'Preisalarm deaktiviert.', nextEnabled ? 'success' : 'info');
    } catch (error) {
        console.error('activatePriceAlert failed:', error);
        toast('Preisalarm konnte nicht aktualisiert werden.', 'warning');
    }
}

async function refreshPriceAlertBadge() {
    const button = document.getElementById('btn-enable-price-alert');
    const badge = document.getElementById('price-alert-active-badge');
    const settingToggle = document.getElementById('notif-pricedrop') || document.getElementById('notif-pricedrops');
    if (!auth.currentUser) {
        if (button) {
            button.textContent = t('enable_alerts');
            button.classList.remove('is-active');
        }
        if (badge) badge.style.display = 'none';
        if (settingToggle) settingToggle.checked = false;
        return;
    }
    try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};
        const active = Boolean(userData.priceAlertsEnabled ?? userData.notificationPreferences?.priceDrops ?? userData.notificationPreferences?.priceAlertsEnabled ?? userData.notifications?.priceDrops ?? userData.notifications?.priceAlertsEnabled ?? false);
        if (button) {
            button.textContent = active ? t('price_alert_disable') : t('enable_alerts');
            button.classList.toggle('is-active', active);
        }
        if (badge) {
            badge.textContent = t('price_alert_active');
            badge.style.display = active ? 'inline-block' : 'none';
        }
        if (settingToggle) {
            settingToggle.checked = active;
        }
    } catch (error) {
        console.error('refreshPriceAlertBadge failed:', error);
        if (button) {
            button.textContent = t('enable_alerts');
            button.classList.remove('is-active');
        }
        if (badge) badge.style.display = 'none';
        if (settingToggle) settingToggle.checked = false;
    }
}

function updateNavFavBadge() {
    const userSavedCars = Array.from(favoriteCarIdsCache || new Set());
    const userSavedParts = Array.from(favoritePartIdsCache || new Set());
    const total = (userSavedCars?.length || 0) + (userSavedParts?.length || 0);
    const badge = document.getElementById('nav-fav-badge');
    const navBadges = document.querySelectorAll('.nav-fav-count');
    if (badge) badge.textContent = String(total);
    navBadges.forEach(element => {
        element.textContent = String(total);
    });
}

function syncFavoritesTabUi() {
    const carsBtn = document.getElementById('fav-tab-cars');
    const partsBtn = document.getElementById('fav-tab-parts');
    if (carsBtn) {
        carsBtn.classList.toggle('active', currentFavoritesTab === 'cars');
        carsBtn.style.opacity = currentFavoritesTab === 'cars' ? '1' : '0.75';
        carsBtn.setAttribute('aria-selected', String(currentFavoritesTab === 'cars'));
    }
    if (partsBtn) {
        partsBtn.classList.toggle('active', currentFavoritesTab === 'parts');
        partsBtn.style.opacity = currentFavoritesTab === 'parts' ? '1' : '0.75';
        partsBtn.setAttribute('aria-selected', String(currentFavoritesTab === 'parts'));
    }
}

async function renderFavorites() {
    const renderSequence = ++favoritesRenderSequence;
    syncFavoritesTabUi();
    const content = document.getElementById('favs-content');
    if (!content) return;
    const panel = getFavoritesPanel(content);
    if (!authStateResolved) {
        panel.className = 'favs-panel is-empty';
        panel.innerHTML = `<div class="no-results" style="display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;width:100%;min-height:50vh;margin:auto;"><img src="etc_logos/merkliste_logos/hourglass.svg" alt="" style="width:80px;height:80px;object-fit:contain;margin-bottom:20px;"><div style="font-size:20px;font-weight:700;">${tr('route_loading', 'Wird geladen ...')}</div></div>`;
        return;
    }
    const user = auth.currentUser;
    if (!user) {
        panel.className = 'favs-panel is-empty';
        panel.innerHTML = `<div class="empty-state"><img src="etc_logos/merkliste_logos/lock_merkliste.svg" alt="" style="width: 48px; height: 48px; object-fit: contain;"><div class="empty-title">${tr('route_sign_in_required', 'Bitte melden Sie sich an')}</div></div>`;
        return;
    }
    const targetField = currentFavoritesTab === 'parts' ? 'partIds' : 'carIds';
    try {
        const cachedFavoriteData = readCachedFavorites(user.uid);
        const favoritesSnapshotPromise = getDoc(doc(db, 'users', user.uid, 'favorites', 'state'));
        const favoritesSnapshot = cachedFavoriteData ? null : await favoritesSnapshotPromise;
        if (renderSequence !== favoritesRenderSequence) return;
        const favoriteData = cachedFavoriteData || (favoritesSnapshot?.exists() ? favoritesSnapshot.data() : {});
        if (cachedFavoriteData) {
            void favoritesSnapshotPromise.then(snapshot => {
                if (snapshot.exists()) writeCachedFavorites(user.uid, snapshot.data() || {});
            }).catch(error => console.warn('Background favorites refresh failed:', error));
        }
        const favoriteIds = favoriteData[targetField] || [];
        if (!favoriteIds.length) {
            const emptyMessage = getFavoritesEmptyMessage(currentFavoritesTab, favoriteData);
            renderFavoritesEmptyState(content, emptyMessage.messageKey, emptyMessage.fallbackMessage);
            return;
        }
        const cards = [];
        if (currentFavoritesTab === 'parts') {
            const cachedPartsById = new Map((allPartsCache || []).map(part => [String(part.id), part]));
            const missingPartIds = favoriteIds.filter(id => !cachedPartsById.has(String(id)));
            const fetchedParts = missingPartIds.length
                ? await fetchDocsByIdsInBatches('parts', missingPartIds, docSnap => ({ id: docSnap.id, ...docSnap.data() }))
                : [];
            fetchedParts.forEach(part => cachedPartsById.set(String(part.id), part));
            const parts = favoriteIds.map(id => cachedPartsById.get(String(id))).filter(Boolean);
            if (renderSequence !== favoritesRenderSequence) return;
            parts.forEach(part => {
                cards.push(`<div class="favorite-part-card" data-favorite-type="parts" data-favorite-id="${escapeHtml(String(part.id || ''))}">${partCardHtml(part, { favoriteParts: true })}</div>`);
            });
        } else {
            const cachedCarsById = new Map((allCarsCache || []).map(car => [String(car.id), car]));
            const missingCarIds = favoriteIds.filter(id => !cachedCarsById.has(String(id)));
            const fetchedCars = missingCarIds.length
                ? await fetchDocsByIdsInBatches('cars', missingCarIds, normalizeFirestoreCar)
                : [];
            fetchedCars.forEach(car => cachedCarsById.set(String(car.id), car));
            const cars = favoriteIds.map(id => cachedCarsById.get(String(id))).filter(Boolean);
            if (renderSequence !== favoritesRenderSequence) return;
            cars.forEach(car => {
                const image = getCarPreviewImage(car);
                const favoriteId = escapeHtml(String(car.id || ''));
                cards.push(`<div class="car-card" data-favorite-type="cars" data-favorite-id="${favoriteId}" onclick="window.handleCarCardClick(event, '${encodeURIComponent(car.id)}')">
                    <div class="car-img-wrap">${image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<div style="font-size:58px;line-height:1">🚗</div>'}</div>
                    <div class="car-body">
                        <div class="car-price">${renderPriceBadge(car)}</div>
                        <div class="car-name">${escapeHtml(car.title || '')}</div>
                        <div style="display:flex;gap:8px;margin-top:8px">
                            <button type="button" class="btn-save" onclick="event.preventDefault();event.stopPropagation();window.toggleFavoriteCar(window.__favoritesCarMap?.['${encodeURIComponent(car.id)}'], event)">♥ ${tr('route_remove', 'Entfernen')}</button>
                        </div>
                    </div>
                </div>`);
            });
            window.__favoritesCarMap = Object.fromEntries(cars.map(car => [encodeURIComponent(String(car.id)), car]));
        }
        if (!cards.length) {
            const emptyMessage = getFavoritesEmptyMessage(currentFavoritesTab, favoriteData);
            renderFavoritesEmptyState(content, emptyMessage.messageKey, emptyMessage.fallbackMessage);
            return;
        }
        panel.className = 'favs-panel';
        panel.innerHTML = `<div class="favs-grid">${cards.join('')}</div>`;
        bindPartCardInteractions(content);
    } catch (error) {
        console.error('renderFavorites failed:', error);
        panel.className = 'favs-panel is-empty';
        panel.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><div class="empty-title">${tr('favLoadFail', 'Favoriten konnten nicht geladen werden')}</div></div>`;
    }
}

async function loadParts(forceRefresh = false) {
    try {
        allPartsCache = await fetchPartsFromFirestore(forceRefresh);
        await refreshFavoriteCaches();
        renderHomePartsLatest(allPartsCache);
        renderPartsBrowser(allPartsCache);
        if (currentSearchMode === 'parts') {
            renderPartsSearchResults(allPartsCache);
        }
    } catch (error) {
        console.error('loadParts failed:', error);
        showDatabaseConnectionWarning();
        allPartsCache = [];
        renderHomePartsLatest([]);
        renderPartsBrowser([]);
        if (currentSearchMode === 'parts') {
            renderPartsSearchResults([]);
        }
    }
}

function applyPartsFilters(parts, prefix = 'parts-browser') {
    const category = normalizePartCategoryValue(getInputValue(`${prefix}-category`));
    const condition = getInputValue(`${prefix}-condition`);
    const maxPrice = readNumericFilterValue(document.getElementById(`${prefix}-price`)?.value || 0, 0);
    const keyword = getInputValue(`${prefix}-keyword`).toLowerCase();
    const urlFilters = readPartsCatalogParamsFromUrl();
    return parts.filter(part => {
        if (category && !partCategoryMatches(category, part.category)) return false;
        if (condition && part.condition !== condition) return false;
        if (urlFilters.status && String(part.status || 'active').trim() !== urlFilters.status) return false;
        if (maxPrice > 0 && Number(part.price || 0) > maxPrice) return false;
        if (urlFilters.dealerOwnerId && String(part.ownerId || '').trim() !== String(urlFilters.dealerOwnerId).trim()) return false;
        if (!urlFilters.dealerOwnerId && urlFilters.dealerName && normalizeCompareValue(part.sellerName || part.ownerEmail || '') !== normalizeCompareValue(urlFilters.dealerName)) return false;
        if (keyword) {
            const haystack = `${part.title || ''} ${part.description || ''} ${part.location || ''}`.toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
}

function syncPartsSortDropdown() {
    const select = document.getElementById('results-sort-select') || document.getElementById('sort-select');
    if (!select) return;
    if (currentSearchMode === 'parts') {
        const options = [
            ['newest', t('parts_sort_newest')],
            ['price-asc', t('parts_sort_price_asc')],
            ['price-desc', t('parts_sort_price_desc')]
        ];
        if (select.dataset.mode !== 'parts') {
            select.innerHTML = options.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
            select.dataset.mode = 'parts';
        }
        select.value = currentPartsSort;
        return;
    }
    const carOptions = [
        ['newest', t('sort_newest')],
        ['price-asc', t('parts_sort_price_asc')],
        ['price-desc', t('parts_sort_price_desc')],
        ['mileage-asc', t('parts_sort_km_asc')]
    ];
    if (select.dataset.mode !== 'cars') {
        select.innerHTML = carOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
        select.dataset.mode = 'cars';
    }
    select.value = currentSearchSort;
}

function partCardHtml(part, { homepage = false, listView = false, sellerProfile = false, favoriteParts = false } = {}) {
    const image = getPartImageList(part)[0] || '';
    const partId = encodeURIComponent(String(part.id || ''));
    const waNumber = part.phone ? String(part.phone).replace(/[^\d]/g, '') : '';
    const safePartId = escapeHtml(String(part.id || ''));
    const favoriteActive = isPartFavorited(part.id);
    const sellerMarkup = homepage || sellerProfile || favoriteParts ? '' : renderListingSellerLink(part, { showEmail: true });
    const catalogActions = `
                    <div class="card-actions catalog-list-actions">
                        <button type="button" class="btn-save catalog-list-action" data-t="parts_details" onclick="event.preventDefault();event.stopPropagation();window.openPartDetailPage('${partId}')">${t('parts_details')}</button>
                        <button type="button" class="btn-contact catalog-list-action" data-t="parts_whatsapp" onclick="event.preventDefault();event.stopPropagation();${waNumber ? `window.open('https://wa.me/${waNumber}', '_blank', 'noopener,noreferrer')` : 'return false;'}">${t('parts_whatsapp')}</button>
                        ${partFavoriteButtonHtml(part)}
                    </div>`;
    return `<a href="index.html?view=part-detail&partId=${partId}" class="car-card-link car-card catalog-list-item part-card catalog-part-card${listView ? ' catalog-parts-list-card' : ''}${homepage ? ' homepage-listing-card' : ''}${sellerProfile ? ' seller-profile-part-card' : ''}${favoriteParts ? ' favorite-parts-part-card' : ''}" data-id="${safePartId}" data-part-id="${safePartId}" style="text-decoration:none;color:inherit">
        <div class="car-img-wrap">
            ${image ? `<img src="${escapeHtml(image)}" alt="" style="width:100%;height:100%;object-fit:cover;">` : '<img src="etc_logos/settings_logo/settings-logo.svg" alt="" style="width:58px;height:58px;object-fit:contain;">'}
            ${listView ? `<div class="catalog-list-status-overlay">${statusBadge(part.status)}</div>` : ''}
        </div>
        <div class="car-body">
            <div class="catalog-list-middle">
                <div class="catalog-grid-header catalog-part-grid-header">
                    <div class="catalog-grid-price part-card-price${homepage ? ' homepage-card-price' : ''}">${renderPriceBadge(part)}</div>
                    ${listView ? '' : `<div class="catalog-grid-status">${statusBadge(part.status)}</div>`}
                </div>
                <div class="car-name">${escapeHtml(part.title || '')}</div>
                <div class="car-spec-row"><div class="car-spec">${escapeHtml(localizedPartCategory(part.category))}</div><div class="car-spec">${escapeHtml(localizedPartCondition(part.condition))}</div></div>
                ${homepage ? '' : sellerMarkup}
            </div>
            ${listView ? `<div class="catalog-list-side">
                <div class="catalog-list-price">${renderPriceBadge(part)}</div>
                ${catalogActions}
            </div>` : ''}
        </div>
    </a>`;
}

function bindPartCardInteractions(container) {
    if (!container || container.dataset.partInteractionsBound === '1') return;
    container.dataset.partInteractionsBound = '1';
    container.addEventListener('click', event => {
        const favButton = event.target.closest('.part-fav-btn[data-part-fav-id]');
        if (favButton) {
            const partId = favButton.getAttribute('data-part-fav-id');
            if (partId) {
                void toggleFavoritePart(partId, event);
            }
            return;
        }
        const card = event.target.closest('.part-card[data-part-id]');
        if (!card) return;
        if (event.target.closest('a,button')) return;
        const partId = card.getAttribute('data-part-id');
        if (!partId) return;
        if (event.ctrlKey || event.metaKey || event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            window.open(`index.html?view=part-detail&partId=${encodeURIComponent(partId)}`, '_blank', 'noopener,noreferrer');
            return;
        }
        void openPartDetailPage(partId);
    });
    container.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const card = event.target.closest('.part-card[data-part-id]');
        if (!card) return;
        event.preventDefault();
        const partId = card.getAttribute('data-part-id');
        if (!partId) return;
        void openPartDetailPage(partId);
    });
}

function renderPartDetailGallery(part, activeIndex = 0, config = {}) {
    const container = document.getElementById('part-gallery-container') ||
        document.getElementById('part-detail-gallery') ||
        document.querySelector('.part-gallery-box') ||
        document.getElementById(config.mainId || 'part-page-main-image')?.parentElement ||
        document.querySelector('.gallery-wrap');

    if (!container) return;

    container.innerHTML = '';

    const imageList = getPartImageList(part);
    const images = imageList.length > 0 ? imageList : ['/placeholder.jpg'];
    const totalCount = images.length;
    const safeActiveIndex = Math.max(0, Math.min(activeIndex, totalCount - 1));
    const mainImg = images[safeActiveIndex] || images[0];
    const thumbImages = images.slice(1, 5);

    container.innerHTML = `
        <style>
            .parts-encar-grid {
                display: grid !important;
                grid-template-columns: 1fr 250px !important;
                gap: 10px !important;
                height: 430px !important;
                max-height: 430px !important;
                width: 100% !important;
                position: relative;
                box-sizing: border-box;
                overflow: hidden;
            }
            .parts-main-card {
                position: relative;
                width: 100%;
                height: 430px !important;
                border-radius: 12px;
                overflow: hidden;
                cursor: pointer;
                background: #111;
            }
            .parts-main-card img {
                width: 100%;
                height: 100%;
                object-fit: cover !important;
                display: block;
            }
            .parts-action-group {
                position: absolute;
                top: 14px;
                right: 14px;
                display: flex;
                gap: 8px;
                z-index: 10;
            }
            .parts-action-btn {
                width: 38px;
                height: 38px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.9);
                border: none;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 2px 6px rgba(0,0,0,0.25);
                font-size: 15px;
                line-height: 1;
                padding: 0;
            }
            .parts-counter-tag {
                position: absolute;
                bottom: 16px;
                right: 16px;
                background: rgba(0, 0, 0, 0.75);
                color: #ffffff;
                padding: 6px 16px;
                border-radius: 24px;
                font-size: 16px;
                font-weight: 600;
                z-index: 10;
                display: flex;
                align-items: center;
                gap: 12px;
                user-select: none;
                box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            }
            .parts-nav-arrow {
                cursor: pointer;
                font-size: 20px;
                font-weight: 700;
                padding: 0 4px;
                transition: transform 0.1s ease, color 0.1s ease;
            }
            .parts-nav-arrow:hover {
                color: #ffcc00;
                transform: scale(1.25);
            }
            .parts-thumb-stack {
                display: grid;
                grid-template-rows: repeat(4, 100px);
                gap: 10px;
                height: 430px !important;
            }
            .parts-thumb-box {
                position: relative;
                width: 100%;
                height: 100px !important;
                border-radius: 8px;
                overflow: hidden;
                cursor: pointer;
                background: #e9ecef;
            }
            .parts-thumb-box img {
                width: 100%;
                height: 100%;
                object-fit: cover !important;
                display: block;
            }
            .parts-more-mask {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.65);
                color: #ffffff;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 12px;
                gap: 2px;
                text-align: center;
            }
            @media (max-width: 991px) {
                .parts-encar-grid {
                    grid-template-columns: 1fr !important;
                    height: 320px !important;
                }
                .parts-thumb-stack { display: none !important; }
                .parts-main-card { height: 320px !important; }
            }
        </style>

        <div class="parts-encar-grid">
            <div class="parts-main-card" onclick="openFullscreenLightbox(window.currentPartIdx || 0)">
                ${statusBadgeOverlay(part?.status)}
                <img id="parts-main-img" src="${escapeHtml(mainImg)}" alt="Part image" />
                
                <div class="parts-action-group">
                    <button class="parts-action-btn" title="${tr('gallery_print', 'Drucken')}" onclick="event.stopPropagation(); window.print();">
                    <img src="etc_logos/sell_page_logos/printer.svg" alt="${tr('gallery_print', 'Drucken')}" style="width: 20px; height: 20px; object-fit: contain;">
                    </button>
                    <button class="parts-action-btn" title="${tr('gallery_share', 'Teilen')}" onclick="event.stopPropagation(); navigator.clipboard.writeText(window.location.href); alert('${tr('link_copied', 'Link kopiert!')}');">
                    <img src="etc_logos/sell_page_logos/link.svg" alt="${tr('gallery_share', 'Teilen')}" style="width: 20px; height: 20px; object-fit: contain;">
                    </button>
                </div>

                <div class="parts-counter-tag">
                    <span class="parts-nav-arrow" onclick="event.stopPropagation(); window.changePartMainImg(-1);">&lt;</span>
                    <span><span id="part-img-idx-num">${safeActiveIndex + 1}</span> / ${totalCount}</span>
                    <span class="parts-nav-arrow" onclick="event.stopPropagation(); window.changePartMainImg(1);">&gt;</span>
                </div>
            </div>

            <div class="parts-thumb-stack">
                ${[0, 1, 2, 3].map(i => {
                    const imgUrl = thumbImages[i];
                    const isFourth = i === 3;
                    const remaining = totalCount - 4;

                    if (!imgUrl) return `<div class="parts-thumb-box"></div>`;

                    return `
                        <div class="parts-thumb-box" onclick="openFullscreenLightbox(${i + 1})">
                            <img src="${escapeHtml(imgUrl)}" alt="Thumbnail ${i + 1}" />
                            ${isFourth && remaining > 0 ? `
                                <div class="parts-more-mask">
                                    <span style="font-size: 16px;">+</span>
                                    <span>+${remaining} ${tr('gallery_all_photos', 'Alle Fotos anzeigen')}</span>
                                </div>
                            ` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;

    window.__detailPartImages = images;
    window.partsImagesList = images;
    window.galleryImagesList = images;
    window.currentPartIdx = safeActiveIndex;

    window.changePartMainImg = function(dir) {
        if (!window.partsImagesList || window.partsImagesList.length === 0) return;
        window.currentPartIdx = (window.currentPartIdx + dir + window.partsImagesList.length) % window.partsImagesList.length;

        const imgElem = document.getElementById('parts-main-img');
        const numElem = document.getElementById('part-img-idx-num');

        if (imgElem) imgElem.src = window.partsImagesList[window.currentPartIdx];
        if (numElem) numElem.innerText = window.currentPartIdx + 1;
    };
}

function renderPartDetailPage(part) {
    const title = part.title || tr('part_item', 'Ersatzteil');
    const phoneRaw = String(part.phone || '').trim();
    const waPhone = phoneRaw.replace(/[^\d]/g, '');
    document.getElementById('part-page-title').textContent = title;
    const partBreadcrumbEl = document.getElementById('part-page-breadcrumb-title');
    if (partBreadcrumbEl) {
        partBreadcrumbEl.textContent = title;
    }
    document.getElementById('part-page-price').innerHTML = renderPriceBadge(part);
    document.getElementById('part-page-category').textContent = localizedPartCategory(part.category);
    document.getElementById('part-page-condition').textContent = localizedPartCondition(part.condition);
    const partYearEl = document.getElementById('part-page-year');
    const partViewsEl = document.getElementById('d-views-meta');
    if (partYearEl) partYearEl.textContent = part.year || part.baujahr || '—';
    if (partViewsEl) partViewsEl.textContent = formatNumber(Number(part.viewsCount ?? part.views ?? 0));
    const partDescriptionEl = document.getElementById('part-page-description');
    if (partDescriptionEl) {
        partDescriptionEl.textContent = part.description || tr('route_not_available', 'Keine Beschreibung verfügbar.');
        setupDescriptionToggle(partDescriptionEl);
    }
    const wa = document.getElementById('part-page-whatsapp');
    const call = document.getElementById('part-page-call');
    const favBtn = document.getElementById('part-page-fav-btn');
    if (wa) {
        wa.href = waPhone ? `https://wa.me/${waPhone}` : '#';
        wa.onclick = event => {
            if (!waPhone) {
                event.preventDefault();
                toast(`${tr('route_whatsapp', 'WhatsApp')}: ${tr('route_not_available', 'Nicht verfügbar')}`, 'warning');
            }
        };
    }
    configureDetailPhoneAction(call, phoneRaw);
    if (favBtn) {
        const active = isPartFavorited(part.id);
        favBtn.style.color = active ? '#e0132b' : '';
        favBtn.innerHTML = `${active ? '♥' : '♡'} <span>${active ? t('btn_saved') : t('btn_save')}</span>`;
        favBtn.onclick = event => {
            void toggleFavoritePart(part.id, event);
        };
    }
    void hydrateSellerInfoCard('part-seller-box', part, {
        email: part.ownerEmail || '—',
        phone: part.phone || '',
        address: part.location || 'Adresse nicht hinterlegt',
        onProfile: profile => configureDetailPhoneAction(call, profile.phoneNumber || profile.phone || phoneRaw)
    });
    updateDetailNavigation(currentDetailOrigin);
    window.__detailPart = part;
    window.__partGalleryConfig = { mainId: 'part-page-main-image', thumbsId: 'part-page-thumbs' };
    renderPartDetailGallery(part, 0, window.__partGalleryConfig);
    activatePage('part-detail');
}

function showPartDetailUnavailable(message) {
    const fallbackMessage = message || 'Das Ersatzteil konnte nicht geladen werden.';
    const titleEl = document.getElementById('part-page-title');
    const breadcrumbEl = document.getElementById('part-page-breadcrumb-title');
    const priceEl = document.getElementById('part-page-price');
    const categoryEl = document.getElementById('part-page-category');
    const conditionEl = document.getElementById('part-page-condition');
    const yearEl = document.getElementById('part-page-year');
    const viewsEl = document.getElementById('d-views-meta');
    const descriptionEl = document.getElementById('part-page-description');
    const sellerBoxEl = document.getElementById('part-seller-box');
    const mainImageEl = document.getElementById('part-page-main-image');
    const thumbsEl = document.getElementById('part-page-thumbs');
    if (titleEl) titleEl.textContent = 'Ersatzteil nicht verfügbar';
    if (breadcrumbEl) breadcrumbEl.textContent = 'Ersatzteil nicht verfügbar';
    if (priceEl) priceEl.textContent = '—';
    if (categoryEl) categoryEl.textContent = '—';
    if (conditionEl) conditionEl.textContent = '—';
    if (yearEl) yearEl.textContent = '—';
    if (viewsEl) viewsEl.textContent = '0';
    if (descriptionEl) {
        descriptionEl.textContent = fallbackMessage;
        setupDescriptionToggle(descriptionEl);
    }
    if (sellerBoxEl) renderSellerInfoCard('part-seller-box', { sellerName: 'Verkäufer', email: '—', address: '—' });
    if (mainImageEl) mainImageEl.innerHTML = '<div style="height:240px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:64px">🚫</div>';
    if (thumbsEl) thumbsEl.innerHTML = '';
    activatePage('part-detail');
}

function showPartDetailLoading() {
    const titleEl = document.getElementById('part-page-title');
    const breadcrumbEl = document.getElementById('part-page-breadcrumb-title');
    const priceEl = document.getElementById('part-page-price');
    const descriptionEl = document.getElementById('part-page-description');
    const mainImageEl = document.getElementById('part-page-main-image');
    const thumbsEl = document.getElementById('part-page-thumbs');
    if (titleEl) titleEl.textContent = 'Ersatzteil wird geladen...';
    if (breadcrumbEl) breadcrumbEl.textContent = 'Ersatzteil wird geladen...';
    if (priceEl) priceEl.textContent = '...';
    if (descriptionEl) {
        descriptionEl.textContent = 'Bitte warten Sie einen Moment.';
        setupDescriptionToggle(descriptionEl);
    }
    if (mainImageEl) mainImageEl.innerHTML = '<div style="height:240px;border-radius:10px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;"><img src="etc_logos/merkliste_logos/hourglass.svg" alt="" style="width:64px;height:64px;object-fit:contain;"></div>';
    if (thumbsEl) thumbsEl.innerHTML = '';
    activatePage('part-detail');
}

function updateSellerCatalogUrl(tab, page) {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'seller-profile');
    url.searchParams.set('ownerId', currentSellerCatalog?.ownerId || '');
    url.searchParams.set('sellerTab', tab);
    url.searchParams.set('sellerPage', String(page));
    pushBrowserUrl(url, { replace: true, state: { view: 'seller-profile', ownerId: currentSellerCatalog?.ownerId || '', sellerTab: tab, sellerPage: page } });
}

function renderSellerCatalog() {
    const catalog = currentSellerCatalog;
    if (!catalog) return;
    const catalogEl = document.getElementById('seller-profile-catalog');
    const tabsEl = document.getElementById('seller-profile-tabs');
    const paginationEl = document.getElementById('seller-profile-pagination');
    if (!catalogEl || !tabsEl || !paginationEl) return;
    const availableTabs = [
    catalog.cars.length ? { id: 'cars', label: `${t('my_listings_cars', 'Fahrzeuge')} (${catalog.cars.length})` } : null,
    catalog.parts.length ? { id: 'parts', label: `${t('my_listings_parts', 'Autoteile')} (${catalog.parts.length})` } : null
    ].filter(Boolean);
    const activeTab = availableTabs.some(tab => tab.id === catalog.tab) ? catalog.tab : availableTabs[0]?.id;
    catalog.tab = activeTab || 'cars';
    const items = catalog.tab === 'parts' ? catalog.parts : catalog.cars;
    const totalPages = Math.max(1, Math.ceil(items.length / SELLER_CATALOG_PAGE_SIZE));
    catalog.page = Math.min(Math.max(1, catalog.page), totalPages);
    const start = (catalog.page - 1) * SELLER_CATALOG_PAGE_SIZE;
    tabsEl.innerHTML = availableTabs.map(tab => `<button type="button" class="seller-catalog-tab${tab.id === catalog.tab ? ' active' : ''}" data-seller-tab="${tab.id}">${tab.label}</button>`).join('');
    tabsEl.querySelectorAll('[data-seller-tab]').forEach(button => button.addEventListener('click', () => {
        catalog.tab = button.dataset.sellerTab || 'cars';
        catalog.page = 1;
        updateSellerCatalogUrl(catalog.tab, catalog.page);
        renderSellerCatalog();
    }));
    catalogEl.innerHTML = items.slice(start, start + SELLER_CATALOG_PAGE_SIZE).map(item => catalog.tab === 'cars' ? (() => {
        const title = escapeHtml(item.title || 'Fahrzeug');
        const image = getCarPreviewImage(item);
        const imageMarkup = image ? `<img src="${escapeHtml(image)}" alt="${title}" style="width:100%;height:100%;object-fit:cover;">` : '<div style="font-size:58px;line-height:1">🚗</div>';
        const detailUrl = `index.html?view=car-detail&id=${encodeURIComponent(String(item.id || ''))}`;
        return `<a href="${detailUrl}" class="car-card" data-id="${escapeHtml(String(item.id || ''))}" style="display:flex;flex-direction:column;text-decoration:none;color:inherit;width:100%;height:100%;"><div class="car-img-wrap">${imageMarkup}</div><div class="car-body"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div class="car-price">${renderPriceBadge(item)}</div>${statusBadge(item.status)}</div><div class="car-name">${title}</div><div class="car-spec-row"><div class="car-spec">${escapeHtml(item.year || '—')}</div><div class="car-spec">${formatNumber(item.mileage)} km</div></div></div></a>`;
    })() : partCardHtml(item, { sellerProfile: true })).join('') || `<div class="empty-state">${tr('seller_no_listings', 'Keine Inserate vorhanden.')}</div>` ;
    paginationEl.innerHTML = totalPages > 1 ? `<button type="button" class="seller-catalog-page-btn" data-page="${catalog.page - 1}" ${catalog.page === 1 ? 'disabled' : ''}>${tr('pagination_previous', 'Vorherige')}</button>${Array.from({ length: totalPages }, (_, index) => `<button type="button" class="seller-catalog-page-btn${index + 1 === catalog.page ? ' active' : ''}" data-page="${index + 1}">${index + 1}</button>`).join('')}<button type="button" class="seller-catalog-page-btn" data-page="${catalog.page + 1}" ${catalog.page === totalPages ? 'disabled' : ''}>${tr('pagination_next', 'Nächste')}</button>` : '';
    paginationEl.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => {
        if (button.disabled) return;
        catalog.page = Number(button.dataset.page);
        updateSellerCatalogUrl(catalog.tab, catalog.page);
        renderSellerCatalog();
    }));
    bindPartCardInteractions(catalogEl);
}

function updateSellerProfileListingSummary(catalog) {
    const summary = document.querySelector('#seller-profile-content [data-seller-listing-summary]');
    if (!summary || !catalog) return;
    const activeCount = (catalog.cars?.length || 0) + (catalog.parts?.length || 0);
    summary.textContent = `${tr('seller_active_listings', 'Aktive Inserate')}: ${formatNumber(activeCount)} · ${tr('seller_sold_listings', 'Verkaufte Inserate')}: ${formatNumber(catalog.soldCount || 0)}`;
}

async function renderSellerProfileByOwner(ownerId) {
    const container = document.getElementById('seller-profile-content');
    if (!container) return;
    const normalizedOwnerId = String(ownerId || '').trim();
    if (!normalizedOwnerId) return;
    const cachedProfile = publicSellerProfileData.get(normalizedOwnerId) || readCachedPublicSellerProfile(normalizedOwnerId);
    const hasRenderedProfile = Boolean(container.querySelector('.seller-profile-banner') && currentSellerCatalog?.ownerId === normalizedOwnerId);
    const preserveRenderedProfile = Boolean(cachedProfile || hasRenderedProfile);
    if (!preserveRenderedProfile) {
        container.innerHTML = `<div class="empty-state seller-profile-loading" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/sell_page_logos/dealer_portal_garage.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:20px;font-weight:700;">${tr('seller_loading', 'Händlerprofil wird geladen ...')}</div></div>`;
    }
    if (cachedProfile && !hasRenderedProfile) {
        const cachedName = cachedProfile.displayName || cachedProfile.companyName || cachedProfile.firstName || cachedProfile.email || 'Händlerprofil';
        const cachedAddress = cachedProfile.address || 'Adresse nicht hinterlegt';
        currentSellerCatalog = { ownerId: normalizedOwnerId, cars: [], parts: [], tab: 'cars', page: 1 };
        container.innerHTML = `
            <div class="seller-profile-banner">
                <img class="seller-profile-avatar" src="${escapeHtml(getResolvedAvatarUrl(cachedProfile, null))}" alt="${escapeHtml(cachedName)}">
                <div class="seller-profile-meta">
                    <h1>${escapeHtml(cachedName)}</h1>
                    <div>${tr('seller_active_since', 'Aktiv seit')} ${tr('route_months', 'Monaten')}</div>
                    <div data-seller-listing-summary>${tr('seller_active_listings', 'Aktive Inserate')}: 0 · ${tr('seller_sold_listings', 'Verkaufte Inserate')}: ${formatNumber(Number(cachedProfile.soldListingsCount || 0))}</div>
                </div>
            </div>
            <div class="seller-profile-card"><h3>${tr('seller_about', 'Über uns')}</h3><div>${escapeHtml(cachedProfile.description || 'Keine Unternehmensbeschreibung hinterlegt.')}</div></div>
            <div class="seller-profile-card"><h3>${tr('seller_listings', 'Händler-Inserate')}</h3><div id="seller-profile-tabs" class="seller-profile-tabs"></div><div id="seller-profile-catalog" class="seller-profile-catalog"></div><div id="seller-profile-pagination" class="seller-profile-pagination"></div></div>
            <div class="seller-profile-card"><h3>${tr('seller_location', 'Standort & Anfahrt')}</h3><div>${escapeHtml(cachedAddress)}</div><div>${tr('seller_phone', 'Telefon')}: ${escapeHtml(cachedProfile.phoneNumber || '—')}</div><div>${tr('seller_email', 'E-Mail')}: ${escapeHtml(cachedProfile.email || '—')}</div><iframe class="seller-profile-map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(cachedAddress)}&t=&z=13&ie=UTF8&iwloc=&output=embed"></iframe></div>
        `;
        renderSellerCatalog();
    }
    try {
        if (cachedProfile) {
            publicSellerProfileData.set(normalizedOwnerId, cachedProfile);
        }
        let profilePromise = publicSellerProfileCache.get(normalizedOwnerId);
        if (!profilePromise) {
            profilePromise = getDocWithTimeout(doc(db, 'users', normalizedOwnerId))
                .then(snapshot => snapshot.exists() ? snapshot.data() : {});
            profilePromise = profilePromise.then(profile => {
                publicSellerProfileData.set(normalizedOwnerId, profile);
                writeCachedPublicSellerProfile(normalizedOwnerId, profile);
                return profile;
            }).catch(error => {
                publicSellerProfileCache.delete(normalizedOwnerId);
                throw error;
            });
            publicSellerProfileCache.set(normalizedOwnerId, profilePromise);
        }
        const [userResult, carsResult, partsResult, sellerCarsResult, sellerPartsResult] = await Promise.allSettled([
            profilePromise,
            getDocsWithTimeoutRetry(query(collection(db, 'cars'), where('ownerId', '==', normalizedOwnerId))),
            getDocsWithTimeoutRetry(query(collection(db, 'parts'), where('ownerId', '==', normalizedOwnerId))),
            getDocsWithTimeoutRetry(query(collection(db, 'cars'), where('sellerId', '==', normalizedOwnerId))),
            getDocsWithTimeoutRetry(query(collection(db, 'parts'), where('sellerId', '==', normalizedOwnerId)))
        ]);
        if (userResult.status === 'rejected') {
            throw userResult.reason;
        }
        const profile = userResult.value || {};
        const carDocs = [
            ...(carsResult.status === 'fulfilled' ? carsResult.value.docs : []),
            ...(sellerCarsResult.status === 'fulfilled' ? sellerCarsResult.value.docs : [])
        ];
        const partDocs = [
            ...(partsResult.status === 'fulfilled' ? partsResult.value.docs : []),
            ...(sellerPartsResult.status === 'fulfilled' ? sellerPartsResult.value.docs : [])
        ];
        const uniqueDocs = docs => [...new Map(docs.map(docSnap => [docSnap.id, docSnap])).values()];
        const allCars = uniqueDocs(carDocs).map(normalizeFirestoreCar);
        const allParts = uniqueDocs(partDocs).map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        const isActiveListing = item => String(item.status || 'active').trim().toLowerCase() === 'active';
        const cars = allCars.filter(isActiveListing);
        const parts = allParts.filter(isActiveListing);
        const sellerName = profile.displayName || profile.companyName || profile.firstName || profile.email || 'Händlerprofil';
        const avatarUrl = getResolvedAvatarUrl(profile, null);
        const address = profile.address || 'Adresse nicht hinterlegt';
        const description = profile.description || 'Keine Unternehmensbeschreibung hinterlegt.';
        const phone = profile.phoneNumber || '—';
        const email = profile.email || '—';
        const soldCount = allCars.concat(allParts).filter(item => String(item.status || '').trim() === 'sold').length || Number(profile.soldListingsCount || 0);
        const activeCount = cars.length + parts.length;
        const createdAtRaw = profile.createdAt?.toDate?.() || (profile.createdAt?.seconds ? new Date(profile.createdAt.seconds * 1000) : null);
        const monthsActive = createdAtRaw ? Math.max(1, Math.round((Date.now() - createdAtRaw.getTime()) / (1000 * 60 * 60 * 24 * 30))) : 1;
        const params = new URLSearchParams(window.location.search);
        currentSellerCatalog = {
            ownerId: normalizedOwnerId,
            cars,
            parts,
            soldCount,
            tab: params.get('sellerTab') === 'parts' ? 'parts' : 'cars',
            page: Number.parseInt(params.get('sellerPage') || '1', 10) || 1
        };
        if (preserveRenderedProfile && container.querySelector('.seller-profile-banner')) {
            updateSellerProfileListingSummary(currentSellerCatalog);
            renderSellerCatalog();
            return;
        }
        container.innerHTML = `
            <div class="seller-profile-banner">
                <img class="seller-profile-avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(sellerName)}">
                <div class="seller-profile-meta">
                    <h1>${escapeHtml(sellerName)}</h1>
                    <div>${tr('seller_active_since', 'Aktiv seit')} ${monthsActive} ${tr('route_months', 'Monaten')}</div>
                    <div data-seller-listing-summary>${tr('seller_active_listings', 'Aktive Inserate')}: ${formatNumber(activeCount)} · ${tr('seller_sold_listings', 'Verkaufte Inserate')}: ${formatNumber(soldCount)}</div>
                </div>
            </div>
            <div class="seller-profile-card"><h3>${tr('seller_about', 'Über uns')}</h3><div>${escapeHtml(description)}</div></div>
            <div class="seller-profile-card"><h3>${tr('seller_listings', 'Händler-Inserate')}</h3><div id="seller-profile-tabs" class="seller-profile-tabs"></div><div id="seller-profile-catalog" class="seller-profile-catalog"></div><div id="seller-profile-pagination" class="seller-profile-pagination"></div></div>
            <div class="seller-profile-card"><h3>${tr('seller_location', 'Standort & Anfahrt')}</h3><div>${escapeHtml(address)}</div><div>${tr('seller_phone', 'Telefon')}: ${escapeHtml(phone)}</div><div>${tr('seller_email', 'E-Mail')}: ${escapeHtml(email)}</div><iframe class="seller-profile-map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(address)}&t=&z=13&ie=UTF8&iwloc=&output=embed"></iframe></div>
        `;
        renderSellerCatalog();
    } catch (error) {
        console.error('renderSellerProfileByOwner failed:', error);
        if (!container.querySelector('.seller-profile-banner')) {
            container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚠️</span><div class="empty-title">${tr('seller_load_failed', 'Händlerprofil konnte nicht geladen werden')}</div></div>`;
        }
    }
}

async function openPartDetail(partIdEncoded, options = {}) {
    const rawId = decodeURIComponent(String(partIdEncoded || ''));
    if (!rawId) return false;
    currentDetailOrigin = options.origin || (isPageActive('my-listings') ? 'my-listings' : 'search');
    const cachedPart = readCachedPart(rawId);
    if (cachedPart) {
        if (options.pushHistory !== false) {
            const url = new URL(window.location.href);
            url.searchParams.delete('id');
            url.searchParams.delete('catalog');
            url.searchParams.set('partId', rawId);
            pushBrowserUrl(url, { state: { view: 'part-detail', partId: rawId } });
        }
        window.__detailPart = cachedPart;
        renderPartDetailPage(cachedPart);
        void refreshPartDetailInBackground(rawId);
        return true;
    }
    showPartDetailLoading();
    try {
        let part = allPartsCache.find(entry => String(entry.id) === rawId);
        if (!part) {
            const partDoc = await getDocWithTimeout(doc(db, 'parts', rawId), 5000);
            if (partDoc.exists()) {
                part = { id: partDoc.id, ...partDoc.data() };
                allPartsCache = [part, ...allPartsCache.filter(entry => String(entry.id) !== rawId)];
            }
        }
        if (!part) {
            showPartDetailUnavailable('Das Ersatzteil wurde nicht gefunden oder ist nicht mehr verfügbar.');
            toast('Teil konnte nicht gefunden werden.', 'warning');
            return false;
        }
        const currentPartViews = Number(part.viewsCount ?? part.views ?? 0);
        void updateDoc(doc(db, 'parts', rawId), {
                viewsCount: increment(1),
                views: increment(1)
            }).then(() => {
                part.viewsCount = currentPartViews + 1;
                part.views = part.viewsCount;
            }).catch(error => {
                console.warn('openPartDetail view counter update failed:', error);
            });
        if (options.pushHistory !== false) {
            const url = new URL(window.location.href);
            url.searchParams.delete('id');
            url.searchParams.delete('catalog');
            url.searchParams.set('partId', rawId);
            pushBrowserUrl(url, { state: { view: 'part-detail', partId: rawId } });
        }
        renderPartDetailPage(part);
        void refreshFavoriteCaches().catch(error => {
            console.warn('openPartDetail favorite refresh failed:', error);
        });
        return true;
    } catch (error) {
        console.error('openPartDetail fetch failed:', error);
        showPartDetailUnavailable(LISTING_LOAD_BLOCKED_MESSAGE);
        toast(LISTING_LOAD_BLOCKED_MESSAGE, 'warning');
        return false;
    } finally {
        activatePage('part-detail');
    }
}

function readCachedPart(partId) {
    const inMemory = allPartsCache.find(entry => String(entry.id) === String(partId));
    if (inMemory) return inMemory;
    try {
        const cacheValues = [
            sessionStorage.getItem('hs_all_parts_cache'),
            localStorage.getItem('hs_all_parts_cache')
        ];
        for (const value of cacheValues) {
            const cachedParts = value ? JSON.parse(value) : [];
            if (Array.isArray(cachedParts)) {
                const cachedPart = cachedParts.find(entry => String(entry.id) === String(partId));
                if (cachedPart) return cachedPart;
            }
        }
        return null;
    } catch (error) {
        console.warn('Unable to read cached part:', error);
        return null;
    }
}

async function refreshPartDetailInBackground(partId) {
    try {
        const partDoc = await getDocWithTimeout(doc(db, 'parts', partId), 5000);
        if (partDoc.exists()) {
            const latestPart = { id: partDoc.id, ...partDoc.data() };
            allPartsCache = [latestPart, ...allPartsCache.filter(entry => String(entry.id) !== String(partId))];
            if (isPageActive('part-detail') && String(window.__detailPart?.id || '') === String(partId)) {
                window.__detailPart = latestPart;
                renderPartDetailPage(latestPart);
            }
        }
    } catch (error) {
        console.warn('Background part refresh failed:', error);
    }
    try {
        await refreshFavoriteCaches();
    } catch (error) {
        console.warn('Background part favorite refresh failed:', error);
    }
    try {
        await updateDoc(doc(db, 'parts', partId), {
            viewsCount: increment(1),
            views: increment(1)
        });
    } catch (error) {
        console.warn('Background part view counter update failed:', error);
    }
}

function openPartDetailModal(partId) {
    void openPartDetailPage(partId);
}

async function openPartDetailPage(partIdEncoded, options = {}) {
    activatePage('part-detail');
    try {
        return await openPartDetail(partIdEncoded, options);
    } catch (error) {
        console.error('openPartDetailPage failed:', error);
        showPartDetailUnavailable(LISTING_LOAD_BLOCKED_MESSAGE);
        toast(LISTING_LOAD_BLOCKED_MESSAGE, 'warning');
        return false;
    } finally {
        activatePage('part-detail');
    }
}

function renderHomePartsLatest(parts) {
    const grid = document.getElementById('home-parts-grid');
    if (!grid) return;
    const latest = [...parts].sort((a, b) => {
        const left = a.createdAt?.seconds || 0;
        const right = b.createdAt?.seconds || 0;
        return right - left;
    }).slice(0, 8);
    if (!latest.length) {
        grid.innerHTML = `<div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/meine_inserate_etc_logos/tools.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:20px;font-weight:700;">${tr('partsNone', 'Keine Teile gefunden')}</div></div>`;
        return;
    }
    grid.innerHTML = latest.map(part => partCardHtml(part, { homepage: true })).join('');
    bindPartCardInteractions(grid);
}

function renderPartsBrowser(parts) {
    const grid = document.getElementById('parts-browser-grid');
    if (!grid) return;
    const filtered = applyPartsFilters(parts, 'parts-browser');
    if (!filtered.length) {
        grid.innerHTML = `<div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/meine_inserate_etc_logos/tools.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:20px;font-weight:700;">${tr('partsNone', 'Keine Teile gefunden')}</div></div>`;
        return;
    }
    grid.innerHTML = `<div class="parts-grid">${filtered.map(partCardHtml).join('')}</div>`;
    bindPartCardInteractions(grid);
}

function renderCarParts(parts, rootSelector = '#results-grid') {
    const root = document.querySelector(rootSelector);
    if (!root) return;
    const entries = Array.isArray(parts) ? parts : [];
    root.innerHTML = entries.length
        ? `<div class="parts-grid">${entries.map(partCardHtml).join('')}</div>`
        : `<div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/meine_inserate_etc_logos/tools.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:20px;font-weight:700;">${tr('route_no_parts', 'Keine Teile gefunden')}</div></div>`;
    bindPartCardInteractions(root);
}

function renderPartsSearchResults(parts, prefix = 'parts-sidebar') {
    const params = readPartsCatalogParamsFromUrl();
    renderDealerFilterBanner({
        dealerOwnerId: params.dealerOwnerId || '',
        dealerName: params.dealerName || ''
    });
    const filtered = applyPartsFilters(parts, prefix);
    partsCatalogFiltered = sortParts(filtered, currentPartsSort);
    partsCatalogPage = 1;
    renderPartsCatalogPage();
}

function renderPartsCatalogPagination(totalItems) {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / PARTS_PAGE_SIZE));
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    const pages = Array.from({ length: totalPages }, (_, index) => {
        const page = index + 1;
        return `<button type="button" class="pagination-btn${partsCatalogPage === page ? ' active' : ''}" data-parts-page="${page}">${page}</button>`;
    }).join('');
    pagination.innerHTML = `<div class="parts-pagination-controls"><button type="button" class="pagination-btn" data-parts-page="${partsCatalogPage - 1}" ${partsCatalogPage === 1 ? 'disabled' : ''}>${tr('pagination_previous', 'Vorherige')}</button>${pages}<button type="button" class="pagination-btn" data-parts-page="${partsCatalogPage + 1}" ${partsCatalogPage === totalPages ? 'disabled' : ''}>${tr('pagination_next', 'Nächste')}</button></div>`;
    pagination.querySelectorAll('[data-parts-page]').forEach(button => {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            partsCatalogPage = Number(button.getAttribute('data-parts-page')) || 1;
            renderPartsCatalogPage();
            document.getElementById('results-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

function renderPartsCatalogPage() {
    const grid = document.getElementById('results-grid');
    const totalEl = document.getElementById('results-total');
    if (!grid) return;
    const sortedParts = sortParts(partsCatalogFiltered, currentPartsSort);
    if (totalEl) totalEl.textContent = partsCatalogFiltered.length.toLocaleString('de-DE');
    const start = (partsCatalogPage - 1) * PARTS_PAGE_SIZE;
    const pageItems = sortedParts.slice(start, start + PARTS_PAGE_SIZE);
    const listView = grid.classList.contains('list') || grid.classList.contains('list-view');
    grid.innerHTML = pageItems.length
        ? pageItems.map(part => partCardHtml(part, { listView })).join('')
        : `<div class="empty-state" style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; width: 100%; min-height: 50vh; margin: auto;"><img src="etc_logos/meine_inserate_etc_logos/tools.svg" alt="" style="width:100px;height:100px;object-fit:contain;margin-bottom:20px;"><div class="empty-title" style="font-size:20px;font-weight:700;">${tr('partsNone', 'Keine Teile gefunden')}</div></div>`;
    if (pageItems.length) {
        bindPartCardInteractions(grid);
        void hydrateCatalogSellerProfiles(grid);
    }
    renderPartsCatalogPagination(partsCatalogFiltered.length);
}

function toggleSearchViewForMode(mode) {
    if (typeof window.showPage === 'function') {
        window.showPage('search');
    }
    const sidebar = document.querySelector('#page-search .filters-sidebar');
    const layout = document.querySelector('#page-search .search-page-layout');
    const partsFilters = document.getElementById('parts-catalog-filters');
    const partsSidebar = document.getElementById('parts-sidebar-filters');
    const carsFilterSections = document.querySelectorAll('#page-search .filters-sidebar .filter-section');
    const countLabel = document.getElementById('results-type-label') || document.querySelector('.results-count-txt span:last-child');
    const grid = document.getElementById('results-grid');
    const viewButtons = document.querySelector('.results-controls .view-btns');
    if (sidebar) sidebar.style.display = '';
    if (layout) layout.classList.remove('parts-only');
    if (partsFilters) partsFilters.style.display = 'none';
    carsFilterSections.forEach(section => {
        section.style.display = mode === 'parts' ? 'none' : '';
    });
    if (partsSidebar) partsSidebar.style.display = mode === 'parts' ? 'block' : 'none';
    if (countLabel) countLabel.textContent = mode === 'parts' ? t('parts_found') : t('vehicles_found');
    syncPartsSortDropdown();
    if (grid) {
        grid.classList.toggle('parts-grid', mode === 'parts');
    }
    if (viewButtons) viewButtons.style.display = '';
}

function renderCarSearchModeLayout() {
    toggleSearchViewForMode('cars');
}

function isPageActive(pageId) {
    const page = document.getElementById(`page-${pageId}`);
    return Boolean(page && page.classList.contains('active'));
}

// Example: Whenever returning to the main home view
function showHomeView() {
    const cleanPath = window.location.pathname || 'index.html';
    if (window.location.search && !suppressHistoryRouting) {
        pushBrowserUrl(new URL(cleanPath, window.location.origin));
    }

    window.__detailCar = null;
    activatePage('home');
}

async function dispatchInitialRouteFromUrl(urlParams) {
    const params = urlParams instanceof URLSearchParams ? urlParams : new URLSearchParams(window.location.search);
    const catalogParam = String(params.get('catalog') || '').toLowerCase();
    const detailId = params.get('id');
    const partDetailId = params.get('partId');
    const ownerId = params.get('ownerId');
    const viewParam = String(params.get('view') || '').toLowerCase();
    const stepParam = Number(params.get('step') || 1);
    const carFilters = readCarsCatalogParamsFromUrl();
    try {
        if (viewParam === 'sell') {
            activatePage('sell');
            const targetStep = Math.max(1, Math.min(stepParam || 1, SELL_WIZARD_TOTAL_STEPS));
            maxReachedSellWizardStep = Math.max(maxReachedSellWizardStep, targetStep);
            showSellWizardStep(targetStep);
            return;
        }
        if (viewParam === 'seller-profile' && ownerId) {
            activatePage('seller-profile');
            await renderSellerProfileByOwner(ownerId);
            return;
        }
        if (viewParam === 'car-detail') {
            if (!detailId) {
                currentMyListingsTab = 'cars';
                currentMyListingsPage = 1;
                pushMyListingsHistory('cars', 1, { replace: true });
                activatePage('my-listings');
                await renderMyListings();
                return;
            }
            activatePage('detail');
            await openCarDetailById(detailId, { pushHistory: false });
            return;
        }
        if (viewParam === 'my-listings') {
            syncMyListingsStateFromUrl();
            activatePage('my-listings');
            await renderMyListings();
            return;
        }
        if (viewParam === 'favorites') {
            const favoriteTabParam = String(params.get('tab') || '').toLowerCase();
            currentFavoritesTab = favoriteTabParam === 'parts' ? 'parts' : 'cars';
            const favoritesPage = document.getElementById('page-favorites');
            if (favoritesPage) {
                activatePage('favorites');
                const tabButton = document.getElementById(currentFavoritesTab === 'parts' ? 'fav-tab-parts' : 'fav-tab-cars');
                if (tabButton) {
                    tabButton.click();
                } else {
                    await renderFavorites();
                }
                return;
            }
            activatePage('favorites');
            await renderFavorites();
            return;
        }
        if (partDetailId) {
            activatePage('part-detail');
            await openPartDetailPage(partDetailId, { pushHistory: false });
            return;
        }
        if (detailId) {
            activatePage('detail');
            await openCarDetailById(detailId, { pushHistory: false });
            return;
        }
        if (catalogParam === 'cars') {
            activatePage('search');
            await openCarsSearchView();
            return;
        }
        if (hasAnyCarsCatalogParam(carFilters)) {
            activatePage('search');
            await openCarsSearchView();
            return;
        }
        if (catalogParam === 'parts') {
            activatePage('search');
            await openPartsSearchView();
            return;
        }
        activatePage('home');
    } catch (error) {
        console.error('Initial route dispatch failed:', error);
        activatePage('home');
        toast('Die Seite konnte nicht geladen werden. Startseite wird angezeigt.', 'warning');
    } finally {
        ensureVisiblePageFallback();
    }
}

function openPartsBrowserModal() {
    renderPartsBrowser(allPartsCache);
    window.openModal?.('parts-browser-modal');
}

function setHomeSearchMode(mode) {
    currentSearchMode = mode === 'parts' ? 'parts' : 'cars';
    const carRow = document.getElementById('home-search-cars-row');
    const partsRow = document.getElementById('home-search-parts-row');
    const carTab = document.getElementById('home-search-tab-cars');
    const partsTab = document.getElementById('home-search-tab-parts');
    if (carRow) carRow.style.display = currentSearchMode === 'cars' ? '' : 'none';
    if (partsRow) partsRow.style.display = currentSearchMode === 'parts' ? '' : 'none';
    if (carTab) {
        carTab.style.opacity = currentSearchMode === 'cars' ? '1' : '0.7';
        carTab.classList.toggle('active', currentSearchMode === 'cars');
    }
    if (partsTab) {
        partsTab.style.opacity = currentSearchMode === 'parts' ? '1' : '0.7';
        partsTab.classList.toggle('active', currentSearchMode === 'parts');
    }
    if (currentSearchMode === 'parts' && !allPartsCache.length) {
        void loadParts();
    }
}

function buildHomeCarsSearchParams() {
    return {
        make: getInputValue('h-make'),
        model: getInputValue('h-model'),
        priceMin: normalizeMinFilterValue(document.getElementById('h-price-from')?.value),
        priceMax: readNumericFilterValue(document.getElementById('h-price')?.value, 0),
        kmMin: normalizeMinFilterValue(document.getElementById('h-km-from')?.value),
        kmMax: readNumericFilterValue(document.getElementById('h-km')?.value, 0),
        fuel: getInputValue('h-fuel'),
        yearMin: normalizeMinFilterValue(document.getElementById('h-first-reg')?.value),
        zip: getInputValue('h-zip')
    };
}

async function searchCarsFromHome(event) {
    event?.preventDefault();
    currentSearchMode = 'cars';
    const params = buildHomeCarsSearchParams();
    await openCarsSearchView(null, params);
}

async function searchPartsFromHome(event) {
    event?.preventDefault();
    currentSearchMode = 'parts';
    if (!allPartsCache.length) {
        await loadParts();
    }
    const params = {
        category: normalizePartCategoryValue(getInputValue('hp-category')),
        condition: getInputValue('hp-condition'),
        priceMax: readNumericFilterValue(document.getElementById('hp-price')?.value || 0, 0),
        keyword: getInputValue('hp-keyword')
    };
    setPartsCatalogQuery(params);
    const map = [
        ['hp-category', 'parts-sidebar-category'],
        ['hp-condition', 'parts-sidebar-condition'],
        ['hp-price', 'parts-sidebar-price'],
        ['hp-keyword', 'parts-sidebar-keyword']
    ];
    map.forEach(([from, to]) => {
        const source = document.getElementById(from);
        const target = document.getElementById(to);
        if (source && target) target.value = source.value || '';
    });
    toggleSearchViewForMode('parts');
    renderPartsSearchResults(allPartsCache, 'parts-sidebar');
}

async function openCarsSearchView(event, forcedParams, options = {}) {
    event?.preventDefault();
    currentSearchMode = 'cars';
    const params = forcedParams || (event ? {} : readCarsCatalogParamsFromUrl(window.location.search));
    const hasExplicitFilters = hasAnyCarsCatalogParam(params);
    setCatalogQuery('cars', hasExplicitFilters ? params : null, { replace: Boolean(options.replaceHistory) });
    if (hasExplicitFilters) {
        syncCarsSidebarFiltersFromUrl(params);
    } else {
        resetCarsSearchFiltersUi();
    }
    toggleSearchViewForMode('cars');
    try {
        const cars = await fetchCarsFromFirestore();
        allCarsCache = Array.isArray(cars) ? cars : [];
        if (hasExplicitFilters) {
            syncCarsSidebarFiltersFromUrl(params);
        }
        if (hasExplicitFilters && params.model) {
            const modelSelect = document.getElementById('f-model');
            if (modelSelect) modelSelect.value = params.model;
        }
        if (hasExplicitFilters) {
            currentSearchCars = filterCarsByCatalogParams(allCarsCache, params);
            renderCarsGrid(currentSearchCars);
        } else {
            currentSearchCars = [...allCarsCache];
            renderCarsGrid(currentSearchCars);
        }
        renderDealerFilterBanner(params);
        if (hasExplicitFilters) {
            syncCarsSidebarFiltersFromUrl(params);
            currentSearchCars = filterCarsByCatalogParams(allCarsCache, readCarsCatalogParamsFromUrl());
            renderCarsGrid(currentSearchCars);
        } else {
            applyCarsFilters();
        }
    } catch (error) {
        toast(tr('searchFailed', 'Suche fehlgeschlagen.'), 'warning');
    }
}

async function openPartsCatalogView(event) {
    event?.preventDefault();
    currentSearchMode = 'parts';
    const params = event ? buildPartsCatalogParams('parts-sidebar') : readPartsCatalogParamsFromUrl();
    setPartsCatalogQuery(params, { replace: !event });
    toggleSearchViewForMode('parts');
    if (!allPartsCache.length) {
        await loadParts();
    }
    applyPartsCatalogParamsToUi(params, 'parts-sidebar');
    renderPartsSearchResults(allPartsCache, 'parts-sidebar');
}

async function openPartsSearchView(event) {
    await openPartsCatalogView(event);
}

function filterBodyAndGo(body) {
    openCarsSearchView(null, { body: body || '' }).then(() => {
        document.getElementById('results-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

function filterFuelAndGo(fuel) {
    openCarsSearchView(null, { fuel: fuel || '' });
}

function filterMakeAndGo(make) {
    openCarsSearchView(null, { make: make || '' }).then(() => {
        document.getElementById('results-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

async function submitPart(event) {
    event?.preventDefault();
    const submitButton = setPartSubmitButtonLoading();
    const user = auth.currentUser;
    if (!user) {
        resetPartSubmitButton();
        openAuthModal();
        return;
    }
    if (!await ensureSellerProfileComplete()) {
        resetPartSubmitButton();
        return;
    }
    const titleInput = document.getElementById('part-title') || document.getElementById('part-name') || document.getElementById('part-number');
    const categoryInput = document.getElementById('part-category');
    const priceInput = document.getElementById('part-price');
    const conditionInput = document.getElementById('part-condition');
    const yearInput = document.getElementById('part-year-input');
    const descriptionInput = document.getElementById('part-description');
    const phoneInput = document.getElementById('part-phone');
    const title = String(titleInput?.value || '').trim();
    const category = normalizePartCategoryValue(String(categoryInput?.value || '').trim());
    const price = parseFloat(String(priceInput?.value || '').trim());
    const condition = String(conditionInput?.value || '').trim();
    const year = String(yearInput?.value || '').trim();
    const description = String(descriptionInput?.value || '').trim();
    const phone = String(phoneInput?.value || '').trim();
    const acceptedTerms = Boolean(document.getElementById('part-agb-checkbox')?.checked || document.getElementById('agb-checkbox')?.checked);
    const imageInput = document.getElementById('partImages') || document.getElementById('part-image');
    const files = partSelectedFiles.length ? [...partSelectedFiles] : Array.from(imageInput?.files || []);
    const missingFields = [];
    if (!title) missingFields.push('title');
    if (!category) missingFields.push('category');
    if (!Number.isFinite(price) || price <= 0) missingFields.push('price');
    if (!condition) missingFields.push('condition');
    if (!phone) missingFields.push('phone');
    if (missingFields.length) {
        console.log('Parts submit validation failed. Missing/invalid fields:', missingFields, {
            titleId: titleInput?.id || null,
            categoryId: categoryInput?.id || null,
            priceId: priceInput?.id || null,
            conditionId: conditionInput?.id || null,
            phoneId: phoneInput?.id || null
        });
        resetPartSubmitButton();
        toast('Bitte Titel, Kategorie, Preis, Zustand und Telefonnummer ausfüllen.', 'warning');
        return;
    }
    if (files.length > 15) {
        resetPartSubmitButton();
        toast('Sie können maximal 15 Bilder hochladen.', 'warning');
        return;
    }
    if (files.length < 1) {
        resetPartSubmitButton();
        toast('Bitte lade mindestens 1 Foto hoch.', 'warning');
        return;
    }
    if (!acceptedTerms) {
        resetPartSubmitButton();
        alert('Bitte akzeptieren Sie die AGB und Datenschutzerklärung, um Ihre Anzeige zu veröffentlichen.');
        return;
    }
    try {
        const imageUrls = files.length ? await uploadCompressedImages(files, user.uid, 'part-images') : [];
        const newPartPayload = {
            title,
            category,
            price,
            condition,
            year,
            description,
            phone,
            image: imageUrls[0] || '',
            images: imageUrls,
            ownerId: user.uid,
            ownerEmail: user.email || '',
            status: 'active',
            createdAt: serverTimestamp()
        };
        const newPartRef = await addDoc(collection(db, 'parts'), newPartPayload);
        const optimisticPart = { id: newPartRef.id, ...newPartPayload, createdAt: { seconds: Math.floor(Date.now() / 1000) } };
        allPartsCache = [optimisticPart, ...allPartsCache.filter(part => String(part.id || '') !== String(optimisticPart.id || ''))];
        clearPartImageDraft();
        if (imageInput) imageInput.value = '';
        ['part-title', 'part-category', 'part-price', 'part-condition', 'part-year-input', 'part-description', 'part-phone'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const termsCheckbox = document.getElementById('part-agb-checkbox');
        if (termsCheckbox) termsCheckbox.checked = false;
        renderHomePartsLatest(allPartsCache);
        renderPartsBrowser(allPartsCache);
        if (currentSearchMode === 'parts') {
            renderPartsSearchResults(allPartsCache, 'parts-sidebar');
        }
        window.closeModal?.('parts-modal');
        toast('Ersatzteil erfolgreich veröffentlicht!', 'success');
        await loadParts(true);
    } catch (error) {
        console.error('submitPart failed:', error);
        toast('Teil konnte nicht gespeichert werden.', 'warning');
    } finally {
        resetPartSubmitButton();
    }
}

async function openSettings() {
    const signedInUser = auth.currentUser;
    if (!signedInUser) {
        openAuthModal();
        return;
    }
    const firstNameInput = document.getElementById('set-fname');
    const lastNameInput = document.getElementById('set-lname');
    const emailInput = document.getElementById('set-email');
    const phoneInput = document.getElementById('set-phone');
    const addressInput = document.getElementById('set-address');
    const descriptionInput = document.getElementById('set-description');
    const notifEmail = document.getElementById('notif-email');
    const notifSaved = document.getElementById('notif-saved') || document.getElementById('notif-listings');
    const notifPriceDrop = document.getElementById('notif-pricedrop') || document.getElementById('notif-pricedrops');
    const currentPw = document.getElementById('set-current-pw');
    const newPw = document.getElementById('set-newpw');
    const confPw = document.getElementById('set-confpw');
    let userData = {};
    try {
        const userDoc = await getDoc(doc(db, 'users', signedInUser.uid));
        userData = userDoc.exists() ? userDoc.data() : {};
    } catch (error) {
        console.error('openSettings profile load failed:', error);
        toast('Einstellungen konnten nicht geladen werden.', 'warning');
    }
    const activeUser = auth.currentUser && auth.currentUser.uid === signedInUser.uid ? auth.currentUser : signedInUser;
    const displayName = userData.displayName || activeUser.displayName || '';
    const [firstName, ...rest] = displayName.split(' ');
    const notifications = userData.notifications || {};
    const notificationPreferences = userData.notificationPreferences || {};
    const emailAlerts = notifications.emailAlerts ?? notificationPreferences.email ?? true;
    const savedListingsings = notifications.savedListingsings ?? notificationPreferences.listings ?? true;
    const priceDrops = notifications.priceDrops ?? notificationPreferences.priceDrops ?? true;
    if (firstNameInput) firstNameInput.value = firstName || '';
    if (lastNameInput) lastNameInput.value = rest.join(' ') || '';
    if (emailInput) emailInput.value = activeUser.email || userData.email || '';
    if (phoneInput) phoneInput.value = userData.phoneNumber || '';
    if (notifEmail) notifEmail.checked = emailAlerts !== false;
    if (notifSaved) notifSaved.checked = savedListingsings !== false;
    if (notifPriceDrop) notifPriceDrop.checked = priceDrops !== false;
    if (currentPw) currentPw.value = '';
    if (newPw) newPw.value = '';
    if (confPw) confPw.value = '';
    if (addressInput) addressInput.value = userData.address || '';
    if (descriptionInput) descriptionInput.value = userData.description || '';
    setAvatarSelectionState(getResolvedAvatarUrl(userData, activeUser));
    syncPasswordSettingsState(activeUser);
    currentUserProfileCache = userData;
    window.openModal?.('settings-modal');
}

function validateSettingsSecurityInputs({ needsEmailUpdate, needsPasswordUpdate, hasPasswordProvider, currentPassword, newPassword, confirmPassword }) {
    if (needsPasswordUpdate && newPassword.length < 6) {
        toast('Das Passwort muss mindestens 6 Zeichen lang sein.', 'warning');
        return false;
    }
    if (needsPasswordUpdate && newPassword !== confirmPassword) {
        toast('Neues Passwort und Bestätigung stimmen nicht überein.', 'warning');
        return false;
    }
    if ((needsEmailUpdate || needsPasswordUpdate) && hasPasswordProvider && !currentPassword) {
        toast('Bitte aktuelles Passwort eingeben, um E-Mail/Passwort zu ändern.', 'warning');
        return false;
    }
    return true;
}

function getSettingsNotificationPreferences() {
    const notifEmail = document.getElementById('notif-email');
    const notifSaved = document.getElementById('notif-saved') || document.getElementById('notif-listings');
    const notifPriceDrop = document.getElementById('notif-pricedrop') || document.getElementById('notif-pricedrops');
    const enabled = Boolean(notifPriceDrop?.checked);
    return {
        emailAlerts: Boolean(notifEmail?.checked),
        savedListingsings: Boolean(notifSaved?.checked),
        priceDrops: enabled,
        priceAlertsEnabled: enabled
    };
}

async function saveSettings() {
    const user = auth.currentUser;
    if (!user) {
        openAuthModal();
        return;
    }
    const firstName = getInputValue('set-fname');
    const lastName = getInputValue('set-lname');
    const submittedEmail = getInputValue('set-email').toLowerCase();
    const currentPassword = document.getElementById('set-current-pw')?.value || '';
    const newPassword = document.getElementById('set-newpw')?.value || '';
    const confirmPassword = document.getElementById('set-confpw')?.value || '';
    const phoneNumber = getInputValue('set-phone');
    const address = getInputValue('set-address');
    const description = String(document.getElementById('set-description')?.value || '').trim();
    const avatarUrl = normalizeAvatarUrl(document.getElementById('set-avatar-url')?.value) || 'user_logo/user_default.webp';
    const notifications = getSettingsNotificationPreferences();
    const priceAlertsEnabled = Boolean(notifications.priceAlertsEnabled || notifications.priceDrops);
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim();
    const needsPasswordUpdate = Boolean(newPassword);
    const hasPasswordProvider = user.providerData.some(provider => provider.providerId === 'password');
    const needsSensitiveUpdate = needsPasswordUpdate;

    // 1) Frontend validation
    if (needsSensitiveUpdate && hasPasswordProvider && !currentPassword) {
        toast('Bitte geben Sie Ihr aktuelles Passwort ein, um Änderungen zu speichern.', 'warning');
        return;
    }
    if (needsPasswordUpdate && newPassword.length < 6) {
        toast('Das Passwort muss mindestens 6 Zeichen lang sein.', 'warning');
        return;
    }
    if (needsPasswordUpdate && newPassword !== confirmPassword) {
        toast('Neues Passwort und Bestätigung stimmen nicht überein.', 'warning');
        return;
    }
    // E-mail changes are globally disabled; ignore or normalize any submitted value.
    if (submittedEmail && submittedEmail !== (user.email || '').toLowerCase()) {
        const emailInput = document.getElementById('set-email');
        if (emailInput) emailInput.value = user.email || '';
        toast('Die E-Mail-Adresse kann nicht geändert werden.', 'warning');
    }

    // 2) Force re-authentication first (before credential changes)
    if (needsSensitiveUpdate && hasPasswordProvider) {
        try {
            const credential = EmailAuthProvider.credential(user.email || '', currentPassword);
            await reauthenticateWithCredential(user, credential);
        } catch (error) {
            if (error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
                toast('Das eingegebene aktuelle Passwort ist falsch.', 'warning');
                return;
            }
            console.error('reauthenticateWithCredential failed:', error);
            toast('Zur Sicherheit bitte erneut anmelden und dann die Änderung wiederholen.', 'warning');
            return;
        }
    }

    // 3) Safe credential updates (only after re-auth succeeds)
    if (needsPasswordUpdate) {
        try {
            await updatePassword(user, newPassword);
            toast('Passwort aktualisiert. Bitte beim nächsten Login neues Passwort verwenden.', 'success');
        } catch (error) {
            console.error('updatePassword failed:', error);
            if (error?.code === 'auth/requires-recent-login') {
                toast('Bitte melden Sie sich erneut an und versuchen Sie es dann noch einmal.', 'warning');
            } else {
                toast('Passwort konnte nicht aktualisiert werden.', 'warning');
            }
        }
    }

    // 4) Profile metadata updates
    try {
        await updateProfile(user, { displayName, photoURL: avatarUrl });
    } catch (error) {
        console.error('updateProfile failed:', error);
        toast('Profilname konnte nicht in Firebase Auth aktualisiert werden.', 'warning');
    }
    try {
        await setDoc(doc(db, 'users', user.uid), {
            firstName,
            lastName,
            displayName,
            phoneNumber,
            address,
            description,
            avatarUrl,
            avatar: avatarUrl,
            photoURL: avatarUrl,
            email: user.email || '',
            pendingEmail: null,
            priceAlertsEnabled,
            notifications,
            notificationPreferences: {
                email: notifications.emailAlerts,
                listings: notifications.savedListingsings,
                priceDrops: notifications.priceDrops,
                priceAlertsEnabled
            },
            updatedAt: serverTimestamp()
        }, { merge: true });
    } catch (error) {
        console.error('saveSettings Firestore update failed:', error);
        toast('Profil konnte nicht in Firestore gespeichert werden.', 'warning');
        return;
    }

    toast(tr('settingsSaved', 'Einstellungen gespeichert.'), 'success');
    window.closeModal?.('settings-modal');
    currentUserProfileCache = { ...(currentUserProfileCache || {}), firstName, lastName, displayName, phoneNumber, address, description, avatarUrl, avatar: avatarUrl, photoURL: avatarUrl, email: user.email || '' };
    setAvatarSelectionState(avatarUrl);
    updateNavForAuth(user);
    await refreshPriceAlertBadge();
    const currentPwEl = document.getElementById('set-current-pw');
    const newPwEl = document.getElementById('set-newpw');
    const confPwEl = document.getElementById('set-confpw');
    if (currentPwEl) currentPwEl.value = '';
    if (newPwEl) newPwEl.value = '';
    if (confPwEl) confPwEl.value = '';
}

async function saveSellerOnboarding(event) {
    event?.preventDefault();
    const user = auth.currentUser;
    if (!user) {
        openAuthModal();
        return false;
    }
    const address = getInputValue('seller-onboarding-address');
    const description = String(document.getElementById('seller-onboarding-description')?.value || '').trim();
    if (!address || !description) {
        toast('Bitte Adresse und Unternehmensbeschreibung angeben.', 'warning');
        return false;
    }
    try {
        await setDoc(doc(db, 'users', user.uid), { address, description, email: user.email || '', updatedAt: serverTimestamp() }, { merge: true });
        currentUserProfileCache = { ...(currentUserProfileCache || {}), address, description, email: user.email || '' };
        const settingsAddress = document.getElementById('set-address');
        const settingsDescription = document.getElementById('set-description');
        if (settingsAddress) settingsAddress.value = address;
        if (settingsDescription) settingsDescription.value = description;
        window.closeModal?.('seller-onboarding-modal');
        toast('Verkäuferprofil gespeichert.', 'success');
        return true;
    } catch (error) {
        console.error('saveSellerOnboarding failed:', error);
        toast('Verkäuferprofil konnte nicht gespeichert werden.', 'warning');
        return false;
    }
}

function closeOnboardingModal() {
    if (typeof window.closeModal === 'function') {
        window.closeModal('seller-onboarding-modal');
    }
}

async function showOnboardingModal(message = 'Verkäuferprofil unvollständig. Für die Veröffentlichung von Fahrzeugen oder Autoteilen sind Adresse und Unternehmensbeschreibung erforderlich.') {
    const messageEl = document.getElementById('seller-onboarding-message');
    if (messageEl) {
        const defaultMessage = 'Verkäuferprofil unvollständig. Für die Veröffentlichung von Fahrzeugen oder Autoteilen sind Adresse und Unternehmensbeschreibung erforderlich.';
        messageEl.textContent = message === defaultMessage ? t('onboarding_message') : message;
    }
    if (typeof openSettings === 'function') {
        await openSettings();
    }
    if (typeof window.openModal === 'function') {
        window.openModal('seller-onboarding-modal');
    }
    const modalEl = document.getElementById('seller-onboarding-modal');
    if (modalEl) {
        modalEl.style.zIndex = '3500';
    }
    const settingsButton = document.getElementById('btn-open-settings-from-modal') || document.getElementById('seller-onboarding-open-settings');
    if (settingsButton) {
        settingsButton.onclick = async () => {
            closeOnboardingModal();
            if (typeof openSettings === 'function') {
                await openSettings();
            }
            window.setTimeout(() => {
                const addressField = document.getElementById('set-address');
                if (addressField) {
                    addressField.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    addressField.focus();
                }
            }, 250);
        };
    }
    return true;
}

async function openListingModalWithSellerGate(modalId, onComplete) {
    if (!auth.currentUser) {
        openAuthModal();
        return false;
    }
    const profile = await loadCurrentUserProfile(auth.currentUser);
    if (!hasCompleteSellerProfile(profile)) {
        await showOnboardingModal('Verkäuferprofil unvollständig. Für die Veröffentlichung von Fahrzeugen oder Autoteilen sind Adresse und Unternehmensbeschreibung erforderlich.');
        return false;
    }
    if (typeof onComplete === 'function') {
        onComplete();
    }
    const targetModal = String(modalId || '').trim();
    if (targetModal && typeof window.openModal === 'function') {
        window.openModal(targetModal);
    }
    return true;
}

async function checkSellerOnboardingOrProceed(callback) {
    const user = auth.currentUser;
    if (!user) {
        openAuthModal();
        return false;
    }
    const profile = await loadCurrentUserProfile(user);
    if (hasCompleteSellerProfile(profile)) {
        if (typeof callback === 'function') {
            callback();
        }
        return true;
    }
    await showOnboardingModal('Verkäuferprofil unvollständig. Für die Veröffentlichung von Fahrzeugen oder Autoteilen sind Adresse und Unternehmensbeschreibung erforderlich.');
    return false;
}

async function ensureSellerProfileComplete() {
    const user = auth.currentUser;
    if (!user) {
        openAuthModal();
        return false;
    }
    const profile = await loadCurrentUserProfile(user);
    if (hasCompleteSellerProfile(profile)) return true;
    const messageEl = document.getElementById('seller-onboarding-message');
    if (messageEl) {
        messageEl.textContent = 'Verkäuferprofil unvollständig. Für die Veröffentlichung von Fahrzeugen oder Autoteilen sind Adresse und Unternehmensbeschreibung erforderlich.';
    }
    await showOnboardingModal();
    return false;
}

function renderAusstattungCategoryBlocks({ inputName, labelClass, gridClass, groupClass }) {
    const groupKeys = {
        'Komfort & Innenausstattung': 'comfort_interior',
        'Sicherheit & Assistenz': 'safety_assistance',
        'Unterhaltung & Media': 'entertainment_media',
        'Exterieur & Licht': 'filter_exterior'
    };
    const featureKeys = {
        Klimaanlage: 'filter_air_conditioning', Klimaautomatik: 'filter_climate_control', Sitzheizung: 'filter_heated_seats',
        Navigationssystem: 'filter_navigation', Tempomat: 'filter_cruise_control', Multifunktionslenkrad: 'filter_multifunction_steering',
        'Elektr. Fensterheber': 'filter_power_windows', 'Panorama-Dach': 'filter_panoramic_roof', Standheizung: 'filter_auxiliary_heater',
        ABS: 'filter_abs', ESP: 'filter_esp', Isofix: 'filter_isofix', 'Totwinkel-Assistent': 'filter_blind_spot',
        Spurhalteassistent: 'filter_lane_assist', Notbremsassistent: 'filter_emergency_braking', Verkehrszeichenerkennung: 'filter_traffic_signs',
        Bluetooth: 'feature_bluetooth', Freisprecheinrichtung: 'feature_hands_free', 'Apple CarPlay': 'feature_carplay', 'Android Auto': 'feature_android_auto',
        Soundsystem: 'feature_sound_system', 'Radio/DAB': 'feature_radio', Leichtmetallfelgen: 'feature_alloy_wheels', 'LED-Scheinwerfer': 'feature_led',
        Xenonscheinwerfer: 'feature_xenon', Kurvenlicht: 'feature_cornering', Anhängerkupplung: 'feature_towbar', Schiebedach: 'feature_sunroof'
    };
    return Object.entries(AUSSTATTUNG_CATEGORIES).map(([group, features]) => `<details class="${groupClass}" open>
        <summary data-t="${groupKeys[group] || ''}" style="font-weight:700;font-size:13px;margin-bottom:8px;cursor:pointer">${escapeHtml(t(groupKeys[group]) || group)}</summary>
        <div class="${gridClass}">
            ${features.map(feature => `<label class="${labelClass}"><input type="checkbox" name="${inputName}" value="${escapeHtml(feature)}" data-feature-group="${escapeHtml(group)}"> <span data-t="${featureKeys[feature] || ''}">${escapeHtml(t(featureKeys[feature]) || feature)}</span></label>`).join('')}
        </div>
    </details>`).join('');
}

function createFeatureCheckboxes(nameAttr) {
    return renderAusstattungCategoryBlocks({
        inputName: nameAttr,
        labelClass: 'check-label',
        gridClass: 'check-group',
        groupClass: 'feature-group'
    });
}

function renderAusstattungFilterOptions() {
    const container = document.getElementById('f-features-groups');
    if (!container) return;
    container.innerHTML = renderAusstattungCategoryBlocks({
        inputName: 'f-feature',
        labelClass: 'check-label',
        gridClass: 'check-group',
        groupClass: 'feature-group'
    });
}

function ensureUiBlocks() {
    const sellFeatures = document.getElementById('sell-feature-boxes');
    if (sellFeatures && !sellFeatures.dataset.ready) {
        sellFeatures.innerHTML = `<h3>Ausstattung</h3>${createFeatureCheckboxes('sell-feature')}`;
        sellFeatures.dataset.ready = '1';
    }
    renderAusstattungFilterOptions();
    const resultsControls = document.querySelector('.results-controls');
    if (resultsControls && !document.getElementById('results-sort-select') && !document.getElementById('sort-select')) {
        resultsControls.insertAdjacentHTML('beforeend', `<select id="results-sort-select" class="sort-select"><option value="newest" data-t="parts_sort_newest">${t('parts_sort_newest')}</option><option value="price-asc" data-t="parts_sort_price_asc">${t('parts_sort_price_asc')}</option><option value="price-desc" data-t="parts_sort_price_desc">${t('parts_sort_price_desc')}</option><option value="mileage-asc" data-t="parts_sort_km_asc">${t('parts_sort_km_asc')}</option></select>`);
    }
    syncPartsSortDropdown();

    const resultsPanel = document.querySelector('#page-search .results-panel');
    if (resultsPanel && !document.getElementById('parts-catalog-filters')) {
        resultsPanel.insertAdjacentHTML('afterbegin', `<div id="parts-catalog-filters" style="display:none;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:12px">
            <select id="parts-catalog-category" class="form-control"><option value="" data-t="filter_category">Kategorie</option><option value="motor" data-t="cat_engine">Motor</option><option value="getriebe" data-t="cat_transmission">Getriebe / Antrieb</option><option value="fahrwerk" data-t="cat_suspension">Fahrwerk &amp; Lenkung</option><option value="karosserie" data-t="cat_body">Karosserie / Exterieur</option><option value="innenraum" data-t="cat_interior">Innenraum &amp; Sicherheit</option><option value="elektronik" data-t="cat_electric">Elektrik / Elektronik</option><option value="zubehoer" data-t="cat_accessories">Zubehör &amp; Werkzeuge</option></select>
            <select id="parts-catalog-condition" class="form-control"><option value="" data-t="parts_condition_label">Zustand</option><option data-t="parts_condition_new">Neu</option><option data-t="parts_condition_used">Gebraucht</option></select>
            <input id="parts-catalog-price" class="form-control" type="number" data-placeholder-prefix="placeholder_example" data-placeholder-suffix=" 500" placeholder="z. B. 500">
            <input id="parts-catalog-keyword" class="form-control" type="text" data-placeholder-prefix="placeholder_example" data-placeholder-suffix=" A 651 090 16 52" placeholder="z. B. A 651 090 16 52">
            <button id="parts-catalog-search-btn" class="btn-search-main" type="button">Suchen</button>
        </div>`);
    }
    const filtersSidebar = document.querySelector('#page-search .filters-sidebar');
    if (filtersSidebar && !document.getElementById('parts-sidebar-filters')) {
        filtersSidebar.insertAdjacentHTML('beforeend', `<div id="parts-sidebar-filters" style="display:none;padding:14px 20px;border-top:1px solid var(--gray-200)">
            <div data-t="parts_filters" style="font-size:13px;font-weight:700;color:var(--gray-800);margin-bottom:12px">${t('parts_filters')}</div>
            <div class="form-field" style="margin-bottom:10px">
                <label class="form-label" style="margin-bottom:4px" data-t="filter_category">${t('filter_category')}</label>
                <select id="parts-sidebar-category" class="filter-select" style="width:100%">                <option value="" data-t="filter_all_categories">Alle Kategorien</option><option value="motor" data-t="part_motor">Motor &amp; Motorteile</option><option value="getriebe" data-t="part_drivetrain">Getriebe / Antrieb</option><option value="fahrwerk" data-t="part_chassis">Fahrwerk &amp; Lenkung</option><option value="karosserie" data-t="part_body">Karosserie / Exterieur</option><option value="bremsanlage" data-t="part_brakes">Bremsanlage</option><option value="elektronik" data-t="part_electronics">Elektrik &amp; Beleuchtung</option><option value="innenraum" data-t="part_interior">Innenausstattung</option><option value="auspuffanlage" data-t="part_exhaust">Auspuffanlage</option><option value="klima" data-t="part_climate">Klimaanlage &amp; Heizung</option><option value="filter" data-t="part_filters">Filter &amp; Öle</option><option value="zubehoer" data-t="part_accessories">Zubehör &amp; Werkzeuge</option><option value="sonstiges" data-t="part_other">Sonstiges</option></select>
            </div>
            <div class="form-field" style="margin-bottom:10px">
                <label class="form-label" style="margin-bottom:4px" data-t="part_condition">${t('part_condition')}</label>
                <select id="parts-sidebar-condition" class="filter-select" style="width:100%"><option value="" data-t="parts_conditions_all">Alle Zustände</option><option data-t="parts_condition_new">Neu</option><option data-t="parts_condition_used">Gebraucht</option></select>
            </div>
            <div class="form-field" style="margin-bottom:10px">
                <label class="form-label" style="margin-bottom:4px" data-t="filter_status">${t('filter_status')}</label>
                <select id="parts-sidebar-status" class="filter-select" style="width:100%"><option value="" data-t="status_any">Alle Status</option>                <option value="active" data-t="status_active">Aktiv</option><option value="reserved" data-t="status_reserved">Reserviert</option><option value="sold" data-t="status_sold">Verkauft</option></select>
            </div>
            <div class="form-field" style="margin-bottom:10px">
                <label class="form-label" style="margin-bottom:4px" data-t="filter_max_price">${t('filter_max_price')}</label>
                <input id="parts-sidebar-price" class="filter-input" type="number" step="500" data-placeholder-prefix="placeholder_example" data-placeholder-suffix=" 500" placeholder="z. B. 500">
            </div>
            <div class="form-field">
                <label class="form-label" style="margin-bottom:4px" data-t="filter_part_number">${t('filter_part_number')}</label>
                <input id="parts-sidebar-keyword" class="filter-input" type="text" data-placeholder-prefix="placeholder_example" data-placeholder-suffix=" A 651 090 16 52" placeholder="z. B. A 651 090 16 52">
            </div>
        </div>`);
    }
    const fuelField = document.getElementById('h-fuel');
    const homeKm = document.getElementById('h-km')?.closest('.sf');
    if (homeKm && !fuelField) {
        homeKm.insertAdjacentHTML('afterend', `<div class="sf"><div class="sf-label" data-t="filter_fuel">Kraftstoff</div><select class="sf-select" id="h-fuel"><option value="" data-t="fuel_all">Alle</option><option value="Benzin" data-t="fuel_petrol">Benzin</option><option value="Diesel" data-t="fuel_diesel">Diesel</option><option value="Elektro" data-t="fuel_electric">Elektro</option><option value="Hybrid" data-t="fuel_hybrid">Hybrid</option><option value="Autogas (LPG)" data-t="fuel_lpg">Autogas (LPG)</option><option value="Erdgas (CNG)" data-t="fuel_cng">Erdgas (CNG)</option><option value="Wasserstoff" data-t="fuel_hydrogen">Wasserstoff</option><option value="Sonstige" data-t="fuel_other">Sonstige</option></select></div><div class="sf"><div class="sf-label" data-t="filter_first_registration_from">Erstzulassung ab</div><select class="sf-select" id="h-first-reg"><option value="" data-t="fuel_all">Alle</option>${Array.from({ length: 20 }).map((_, i) => `<option>${new Date().getFullYear() - i}</option>`).join('')}</select></div>`);
    }
    const homeModelSelect = document.getElementById('h-model');
    if (homeModelSelect) {
        homeModelSelect.disabled = !getInputValue('h-make');
    }
    const vehicleFilterSection = document.querySelector('#page-search .filter-section .filter-section-body');
    if (vehicleFilterSection && !document.getElementById('f-zip')) {
        vehicleFilterSection.insertAdjacentHTML('beforeend', `<input class="filter-input" id="f-zip" type="text" data-t-placeholder="filter_location_zip" placeholder="Ort / PLZ" style="width:100%;margin-top:8px">`);
    }
    if (vehicleFilterSection && !document.getElementById('f-status')) {
        vehicleFilterSection.insertAdjacentHTML('beforeend', `<select class="filter-select" id="f-status" style="width:100%;margin-top:8px" onchange="applyFilters()"><option value="" data-t="status_any">Alle Status</option><option value="active" data-t="status_active">Aktiv</option><option value="reserved" data-t="status_reserved">Reserviert</option><option value="sold" data-t="status_sold">Verkauft</option></select>`);
    }
    if (!document.getElementById('image-lightbox-modal')) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="image-lightbox-modal"><div class="modal" style="max-width:92vw;width:92vw;background:#000"><div class="modal-close" style="color:#fff" onclick="document.getElementById('image-lightbox-modal').classList.remove('open')">×</div><img id="image-lightbox-img" src="" alt="" style="width:100%;max-height:85vh;object-fit:contain"></div></div>`);
    }
    if (!document.getElementById('edit-listing-modal')) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="edit-listing-modal"><div class="modal"><div class="modal-hd"><div class="modal-title" data-t="edit_listing_title">Inserat bearbeiten</div><div class="modal-close" onclick="closeModal('edit-listing-modal')">×</div></div><input type="hidden" id="edit-listing-id"><div class="modal-field"><label data-t="modal_price_label">Preis</label><input id="edit-price" type="number"></div><div class="modal-field"><label data-t="modal_mileage_label">Kilometerstand</label><input id="edit-mileage" type="number"></div><div class="modal-field"><label data-t="modal_description_label">Beschreibung</label><textarea id="edit-description" rows="3"></textarea></div><div class="modal-field"><label data-t="modal_status_label">Status</label><select id="edit-status"><option value="active" data-t="status_active">Aktiv</option><option value="reserved" data-t="status_reserved">Reserviert</option><option value="sold" data-t="status_sold">Verkauft</option></select></div><div id="edit-feature-boxes">${createFeatureCheckboxes('edit-feature')}</div><div class="modal-footer"><button class="btn-secondary" data-t="cancel" onclick="closeModal('edit-listing-modal')">Abbrechen</button><button class="btn-primary" id="btn-save-edit-listing" data-t="save">Speichern</button></div></div></div>`);
    }
    if (!document.getElementById('edit-part-listing-modal')) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="edit-part-listing-modal"><div class="modal"><div class="modal-hd"><div class="modal-title" data-t="edit_part_modal">${t('edit_part_modal')}</div><div class="modal-close" onclick="closeModal('edit-part-listing-modal')">×</div></div><input type="hidden" id="edit-part-id"><div class="modal-field"><label data-t="edit_part_title">${t('edit_part_title')}</label><input id="edit-part-title" type="text"></div><div class="modal-field"><label data-t="edit_part_price">${t('edit_part_price')}</label><input id="edit-part-price" type="number" min="1"></div><div class="modal-field"><label data-t="edit_part_category">${t('edit_part_category')}</label>        <select id="edit-part-category"><option value="" data-t="select_option">${t('select_option')}</option><option value="motor" data-t="part_motor">Motor</option><option value="getriebe" data-t="part_drivetrain">Getriebe / Antrieb</option><option value="fahrwerk" data-t="part_chassis">Fahrwerk &amp; Lenkung</option><option value="karosserie" data-t="part_body">Karosserie / Exterieur</option><option value="innenraum" data-t="part_interior">Innenraum &amp; Sicherheit</option><option value="elektronik" data-t="part_electronics">Elektrik / Elektronik</option><option value="zubehoer" data-t="part_accessories">Zubehör &amp; Werkzeuge</option></select></div><div class="modal-field"><label data-t="edit_part_condition">${t('edit_part_condition')}</label><select id="edit-part-condition"><option value="" data-t="select_option">${t('select_option')}</option><option value="Neu" data-t="condition_new">Neu</option><option value="Gebraucht" data-t="condition_used">Gebraucht</option></select></div><div class="modal-field"><label data-t="edit_part_description">${t('edit_part_description')}</label><textarea id="edit-part-description" rows="4"></textarea></div><div class="modal-field"><label data-t="edit_part_status">${t('edit_part_status')}</label><select id="edit-part-status"><option value="active" data-t="status_active">Aktiv</option><option value="reserved" data-t="status_reserved">Reserviert</option><option value="sold" data-t="status_sold">Verkauft</option></select></div><div class="modal-footer"><button class="btn-secondary" onclick="closeModal('edit-part-listing-modal')" data-t="edit_part_cancel">${t('edit_part_cancel')}</button><button class="btn-primary" id="btn-save-edit-part-listing" data-t="edit_part_save">${t('edit_part_save')}</button></div></div></div>`);
    }
    if (!document.getElementById('parts-modal')) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="parts-modal"><div class="modal"><div class="modal-hd"><div class="modal-title" data-t="modal_part_title">Autoteil veröffentlichen</div><div class="modal-close" onclick="closeModal('parts-modal')">×</div></div><div class="modal-field"><label data-t="label_title_part">Titel / Ersatzteilnummer</label><input id="part-title" data-t-placeholder="part_title_placeholder" placeholder="z.B. Audi A3 A 651 090 16 52"></div><div class="modal-field"><label data-t="label_category">Kategorie</label><select id="part-category"><option value="" data-t="select_option">Bitte wählen</option><option value="motor" data-t="part_motor">Motor</option><option value="getriebe" data-t="part_drivetrain">Getriebe / Antrieb</option><option value="fahrwerk" data-t="part_chassis">Fahrwerk &amp; Lenkung</option><option value="karosserie" data-t="part_body">Karosserie / Exterieur</option><option value="innenraum" data-t="part_interior">Innenraum &amp; Sicherheit</option><option value="elektronik" data-t="part_electronics">Elektrik / Elektronik</option><option value="zubehoer" data-t="part_accessories">Zubehör &amp; Werkzeuge</option></select></div><div class="modal-field"><label data-t="label_price">Preis</label><input id="part-price" type="number" step="5000"></div><div class="modal-field"><label data-t="label_condition">Zustand</label><select id="part-condition"><option value="" data-t="select_option">Bitte wählen</option><option data-t="parts_condition_new">Neu</option><option data-t="parts_condition_used">Gebraucht</option></select></div><div class="form-group mb-3"><label class="form-label" data-t="label_year">Baujahr</label><input type="number" id="part-year-input" class="form-control" data-t-placeholder="year_placeholder" placeholder="z.B. 2020" min="1900" max="2026"></div><div class="modal-field"><label data-t="label_description">Beschreibung</label><textarea id="part-description"></textarea></div><div class="modal-field"><label data-t="label_phone">Telefon</label><input id="part-phone" type="tel"></div><label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;cursor:pointer;margin:10px 0 0"><input type="checkbox" id="part-agb-checkbox" style="accent-color:var(--nav-bg);margin-top:2px;flex-shrink:0"><span data-t="label_terms">Ich akzeptiere die <u style="cursor:pointer">AGB</u> und <u style="cursor:pointer">Datenschutzerklärung</u> von H&amp;S Car.</span></label><div class="modal-field"><label data-t="label_images">Bilder (max. 15)</label><input id="partImages" type="file" accept="image/*" multiple><div id="part-images-preview" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div></div><div class="modal-footer"><button class="btn-secondary" onclick="closeModal('parts-modal')" data-t="btn_cancel">Abbrechen</button><button class="btn-primary" id="btn-submit-part" data-t="btn_publish">Veröffentlichen</button></div></div></div>`); }
    if (!document.getElementById('part-detail-modal')) {
        document.body.insertAdjacentHTML('beforeend', `<div class="modal-overlay" id="part-detail-modal"><div class="modal" style="max-width:920px;width:92vw"><div class="modal-hd"><div class="modal-title" id="part-detail-title">Ersatzteil</div><div class="modal-close" onclick="closeModal('part-detail-modal')">×</div></div><div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:18px"><div><div id="part-detail-main-image"></div><div id="part-detail-thumbs" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"></div><div style="margin-top:14px;color:#374151;font-size:14px;line-height:1.6" id="part-detail-description"></div></div><div><div style="font-size:28px;font-weight:700;margin-bottom:12px" id="part-detail-price">0 €</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px"><div style="padding:10px;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:12px;color:#6b7280">Kategorie</div><div style="font-weight:600" id="part-detail-category">—</div></div><div style="padding:10px;border:1px solid #e5e7eb;border-radius:10px"><div style="font-size:12px;color:#6b7280">Zustand</div><div style="font-weight:600" id="part-detail-condition">—</div></div></div><div style="display:flex;flex-direction:column;gap:8px"><a id="part-detail-whatsapp" class="btn-contact" target="_blank" rel="noopener noreferrer" href="#"> WhatsApp</a><a id="part-detail-call" class="btn-save" href="#"> Anrufen</a></div></div></div></div></div>`);
    }
    syncPartCategoryControls();
    applyTranslations();
}

function initializeSpaNavigationBridge() {
    if (typeof window.showPage === 'function' && !rawShowPageFn) {
        rawShowPageFn = window.showPage.bind(window);
        window.showPage = async function wrappedShowPage(pageId) {
            const target = String(pageId || '').trim();
            if (!suppressHistoryRouting) {
                if (target === 'home') {
                    pushBrowserUrl(new URL(window.location.pathname || 'index.html', window.location.origin));
                } else if (target === 'favorites') {
                    const url = new URL(window.location.href);
                    url.searchParams.set('view', 'favorites');
                    url.searchParams.set('tab', currentFavoritesTab === 'parts' ? 'parts' : 'cars');
                    pushBrowserUrl(url);
                } else if (target === 'my-listings' || target === 'listings') {
                    pushMyListingsHistory(currentMyListingsTab, currentMyListingsPage, { replace: false });
                } else if (target === 'sell') {
                    if (!auth.currentUser) {
                        openAuthModal();
                        return;
                    }
                    if (!await checkSellerOnboardingOrProceed(() => {
                        const url = new URL(window.location.href);
                        url.searchParams.delete('id');
                        url.searchParams.delete('partId');
                        url.searchParams.delete('catalog');
                        CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
                        url.searchParams.set('view', 'sell');
                        url.searchParams.set('step', String(currentSellWizardStep || 1));
                        pushBrowserUrl(url);
                    })) {
                        return;
                    }
                    const url = new URL(window.location.href);
                    url.searchParams.delete('id');
                    url.searchParams.delete('partId');
                    url.searchParams.delete('catalog');
                    CAR_CATALOG_FILTER_KEYS.forEach(key => url.searchParams.delete(key));
                    url.searchParams.set('view', 'sell');
                    url.searchParams.set('step', String(currentSellWizardStep || 1));
                    pushBrowserUrl(url);
                } else if (target === 'add-part') {
                    const didOpen = await openListingModalWithSellerGate('parts-modal', () => {
                        clearPartImageDraft();
                        resetPartSubmitButton();
                    });
                    if (!didOpen) {
                        return;
                    }
                    clearPartImageDraft();
                    resetPartSubmitButton();
                    return;
                } else if (target === 'search' && currentSearchMode === 'cars') {
                    setCatalogQuery('cars', buildCarsCatalogParamsFromSidebarFilters(readCarsSidebarFilters()));
                } else if (target === 'search' && currentSearchMode === 'parts') {
                    setCatalogQuery('parts');
                }
            }
            rawShowPageFn(target);
        };
    }
    window.addEventListener('popstate', async () => {
        suppressHistoryRouting = true;
        try {
            cleanupTransientUi();
            await dispatchInitialRouteFromUrl(new URLSearchParams(window.location.search));
        } finally {
            suppressHistoryRouting = false;
        }
    });
}

function applyModuleLanguageUi(langCode) {
    const lang = String(langCode || 'de').toLowerCase();
    const meta = LANGUAGE_META[lang] || LANGUAGE_META.de;
    const langFlag = document.getElementById('cur-flag');
    const langCodeEl = document.getElementById('cur-code');
    if (langFlag) {
        let flagImage = langFlag.querySelector('img');
        if (!flagImage) {
            flagImage = document.createElement('img');
            langFlag.replaceChildren(flagImage);
        }
        flagImage.src = meta.flag;
        flagImage.alt = meta.alt;
        flagImage.style.cssText = 'width:18px;height:14px;object-fit:contain;vertical-align:middle;';
        langFlag.style.cssText = 'width:18px;height:14px;object-fit:contain;vertical-align:middle;';
    }
    if (langCodeEl) langCodeEl.textContent = meta.code;
    document.querySelectorAll('.lang-option').forEach(option => {
        const isActive = option.getAttribute('data-lang') === lang;
        option.classList.toggle('active', isActive);
    });
    populateStandardBrandSelects();
    updateHomeModels();
    updateFilterModels();
    updateSellModels();
    populateVehicleColorSelects();
    syncPartCategoryControls();
    applyTranslations();
    syncPartsSortDropdown();
    if (document.getElementById('page-favorites')?.classList.contains('active')) {
        void renderFavorites();
    } else if (document.getElementById('page-my-listings')?.classList.contains('active')) {
        void renderMyListings();
    } else if (document.getElementById('page-search')?.classList.contains('active')) {
        if (currentSearchMode === 'parts') {
            renderPartsSearchResults(allPartsCache, 'parts-sidebar');
        } else {
            renderSearchCards(currentSearchCars || []);
        }
    }
}

function bindUiEvents() {
    const signInButton = document.getElementById('btn-signin');
    const signUpButton = document.getElementById('btn-signup');
    const searchButton = document.getElementById('home-search-btn');
    const partsSearchButton = document.getElementById('home-search-parts-btn');
    const googleButtons = [document.getElementById('btn-google-signin'), document.getElementById('btn-google-signup')].filter(Boolean);
    if (signInButton) signInButton.addEventListener('click', handleSignIn);
    if (signUpButton) signUpButton.addEventListener('click', handleSignUp);
    if (searchButton) searchButton.addEventListener('click', searchCarsFromHome);
    if (partsSearchButton) partsSearchButton.addEventListener('click', searchPartsFromHome);
    document.getElementById('h-make')?.addEventListener('change', updateHomeModels);
    document.getElementById('s-make')?.addEventListener('change', () => {
        updateSellModels();
        syncSellWizardStateFromDom();
        updateSellWizardValuation();
    });
    document.getElementById('s-model')?.addEventListener('change', () => {
        syncSellWizardStateFromDom();
        if (currentSellWizardStep === 6) {
            renderSellWizardSummary();
        }
    });
    document.getElementById('agb-checkbox')?.addEventListener('change', syncSellTermsCheckboxState);
    googleButtons.forEach(button => button.addEventListener('click', handleGoogleSignIn));
    document.getElementById('btn-save-edit-listing')?.addEventListener('click', saveListingEdit);
    document.getElementById('btn-save-edit-part-listing')?.addEventListener('click', savePartListingEdit);
    document.getElementById('btn-submit-part')?.addEventListener('click', submitPart);
    document.getElementById('btn-enable-price-alert')?.addEventListener('click', activatePriceAlert);
    const onboardingSettingsButton = document.getElementById('seller-onboarding-open-settings') || document.getElementById('btn-open-settings-from-modal');
    onboardingSettingsButton?.addEventListener('click', async () => {
        closeOnboardingModal();
        if (typeof openSettings === 'function') {
            await openSettings();
        }
        window.setTimeout(() => {
            const addressInput = document.getElementById('set-address');
            if (!addressInput) return;
            addressInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
            addressInput.focus();
        }, 250);
    });
    document.getElementById('btn-add-part')?.addEventListener('click', async () => {
        const didOpen = await openListingModalWithSellerGate('parts-modal', () => {
            clearPartImageDraft();
            resetPartSubmitButton();
        });
        if (!didOpen) {
            return;
        }
        clearPartImageDraft();
        resetPartSubmitButton();
    });
    document.querySelectorAll('#btn-open-add-car, #btn-open-add-part, .btn-create-listing').forEach(trigger => {
        trigger.addEventListener('click', async event => {
            event.preventDefault();
            event.stopPropagation();
            const modalId = trigger.getAttribute('data-modal-id') || (trigger.id === 'btn-open-add-car' ? 'modal-add-car' : 'parts-modal');
            const didOpen = await openListingModalWithSellerGate(modalId, () => {
                if (modalId === 'parts-modal') {
                    clearPartImageDraft();
                    resetPartSubmitButton();
                }
            });
            if (!didOpen) {
                return;
            }
            if (modalId === 'parts-modal') {
                clearPartImageDraft();
                resetPartSubmitButton();
            }
        });
    });
    document.getElementById('parts-view-all-link')?.addEventListener('click', event => {
        openPartsCatalogView(event);
    });
    document.querySelectorAll('[data-avatar-option]').forEach(option => {
        option.addEventListener('click', () => setAvatarSelectionState(option.getAttribute('data-avatar-option') || 'user_logo/user_default.webp'));
    });
    document.getElementById('toggle-avatars-btn')?.addEventListener('click', event => {
        const button = event.currentTarget;
        const extraAvatars = document.getElementById('extra-avatars');
        if (!extraAvatars) return;
        const expanded = extraAvatars.classList.toggle('is-expanded');
        extraAvatars.style.display = expanded ? 'grid' : 'none';
        button.setAttribute('aria-expanded', String(expanded));
        extraAvatars.setAttribute('aria-hidden', String(!expanded));
        button.setAttribute('aria-label', expanded ? 'Weniger Avatare anzeigen' : 'Weitere Avatare anzeigen');
    });
    document.getElementById('set-avatar-file')?.addEventListener('change', async event => {
        const file = event.target?.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressAvatarFile(file);
            setAvatarSelectionState(compressed);
        } catch (error) {
            console.error('Avatar compression failed:', error);
            toast('Profilbild konnte nicht verarbeitet werden.', 'warning');
        }
    });
    document.querySelectorAll('[data-open-cars-search="1"]').forEach(link => {
        link.addEventListener('click', openCarsSearchView);
    });
    document.getElementById('hero-dream-car-cta')?.addEventListener('click', event => {
        event.preventDefault();
        if (!auth.currentUser) {
            openAuthModal();
            return;
        }
        document.getElementById('home-cars-grid')?.scrollIntoView({ behavior: 'smooth' });
    });
    document.getElementById('home-search-tab-cars')?.addEventListener('click', () => setHomeSearchMode('cars'));
    document.getElementById('home-search-tab-parts')?.addEventListener('click', () => setHomeSearchMode('parts'));
    document.getElementById('parts-catalog-search-btn')?.addEventListener('click', () => {
        setPartsCatalogQuery(buildPartsCatalogParams('parts-catalog'));
        renderPartsSearchResults(allPartsCache);
    });
    ['parts-catalog-category', 'parts-catalog-condition', 'parts-catalog-price', 'parts-catalog-keyword'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => {
            setPartsCatalogQuery(buildPartsCatalogParams('parts-catalog'), { replace: true });
            renderPartsSearchResults(allPartsCache);
        });
        document.getElementById(id)?.addEventListener('input', () => {
            if (id === 'parts-catalog-keyword' || id === 'parts-catalog-price') {
                setPartsCatalogQuery(buildPartsCatalogParams('parts-catalog'), { replace: true });
                renderPartsSearchResults(allPartsCache);
            }
        });
        ['parts-sidebar-category', 'parts-sidebar-condition', 'parts-sidebar-status', 'parts-sidebar-price', 'parts-sidebar-keyword'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                setPartsCatalogQuery(buildPartsCatalogParams('parts-sidebar'), { replace: true });
                renderPartsSearchResults(allPartsCache, 'parts-sidebar');
            });
            document.getElementById(id)?.addEventListener('input', () => {
                setPartsCatalogQuery(buildPartsCatalogParams('parts-sidebar'), { replace: true });
                renderPartsSearchResults(allPartsCache, 'parts-sidebar');
            });
        });
    });
    ['parts-browser-category', 'parts-browser-condition', 'parts-browser-price', 'parts-browser-keyword'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', () => renderPartsBrowser(allPartsCache));
        document.getElementById(id)?.addEventListener('input', () => renderPartsBrowser(allPartsCache));
    });
    const partImagesInput = document.getElementById('partImages') || document.getElementById('part-image');
    if (partImagesInput) {
        partImagesInput.addEventListener('change', addPartImagesFromInput);
    }
    document.getElementById('part-images-preview')?.addEventListener('click', event => {
        const button = event.target.closest('[data-remove-part-image]');
        if (!button) return;
        const index = Number(button.getAttribute('data-remove-part-image'));
        if (Number.isNaN(index)) return;
        partSelectedFiles.splice(index, 1);
        syncPartImageInputWithState();
        renderPartImagePreviews();
    });
    document.getElementById('fav-tab-cars')?.addEventListener('click', async () => {
        currentFavoritesTab = 'cars';
        syncFavoritesTabUi();
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'favorites');
        url.searchParams.set('tab', 'cars');
        pushBrowserUrl(url);
        await renderFavorites();
    });
    document.getElementById('fav-tab-parts')?.addEventListener('click', async () => {
        currentFavoritesTab = 'parts';
        syncFavoritesTabUi();
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'favorites');
        url.searchParams.set('tab', 'parts');
        pushBrowserUrl(url);
        await renderFavorites();
    });
    setHomeSearchMode('cars');
    renderCarSearchModeLayout();
    bindCarsSidebarFilterEvents();
    bindSortControl();
}

ready(async () => {
    suppressHistoryRouting = true;
    if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'manual';
    }
    initializeSpaNavigationBridge();
    activatePage('home');
    try {
        populateStandardBrandSelects();
        populateVehicleColorSelects();
        updateHomeModels();
        updateFilterModels();
        updateSellModels();
        populateSellYearOptions();
        ensureUiBlocks();
        bindUiEvents();
        initSellWizard();
        syncSellTermsCheckboxState();
        void bootstrapCatalogCache();
        const urlParams = new URLSearchParams(window.location.search);
        try {
            await dispatchInitialRouteFromUrl(urlParams);
        } finally {
            suppressHistoryRouting = false;
        }
        await loadAllPublicListings();
        await loadParts();
        const persistedLang = localStorage.getItem('hs_lang') || 'de';
        setLanguage(persistedLang);
        applyModuleLanguageUi(persistedLang);
        sanitizeHeaderActionLabels();
        await refreshPriceAlertBadge();
    } catch (error) {
        console.error('App startup failed:', error);
        activatePage('home');
        toast('Die Seite konnte nicht vollständig geladen werden. Startseite wird angezeigt.', 'warning');
    } finally {
        ensureVisiblePageFallback();
    }
});

document.addEventListener('app:language-changed', event => {
    const lang = event?.detail?.lang || localStorage.getItem('hs_lang') || 'de';
    applyModuleLanguageUi(lang);
    if (isPageActive('detail') && window.__detailCar) {
        renderDetailPage(window.__detailCar);
    } else if (isPageActive('part-detail') && window.__detailPart) {
        renderPartDetailPage(window.__detailPart);
    } else if (isPageActive('seller-profile') && currentSellerCatalog?.ownerId) {
        void renderSellerProfileByOwner(currentSellerCatalog.ownerId);
    } else if (isPageActive('my-listings')) {
        void renderMyListings();
    } else if (isPageActive('favorites')) {
        void renderFavorites();
    }
    if (isPageActive('sell')) {
        renderSellWizardSummary();
        updateSellWizardValuation();
    }
    sanitizeHeaderActionLabels();
});

async function updateCarPrice(carId, newPrice) {
    const numericNewPrice = Number(newPrice);
    if (!carId || !Number.isFinite(numericNewPrice)) return false;
    try {
        if (typeof firebase !== 'undefined' && typeof firebase.firestore === 'function') {
            const carRef = firebase.firestore().collection('cars').doc(carId);
            const doc = await carRef.get();
            if (!doc.exists) return false;
            const currentPrice = Number(doc.data()?.price || 0);
            if (numericNewPrice < currentPrice) {
                await carRef.update({ previousPrice: currentPrice, price: numericNewPrice });
                return true;
            }
            return false;
        }

        const carRef = doc(db, 'cars', carId);
        const snap = await getDoc(carRef);
        if (!snap.exists()) return false;
        const currentPrice = Number(snap.data()?.price || 0);
        if (numericNewPrice < currentPrice) {
            await updateDoc(carRef, { previousPrice: currentPrice, price: numericNewPrice });
            return true;
        }
        return false;
    } catch (error) {
        console.error('updateCarPrice failed:', error);
        return false;
    }
}

function renderPriceDropNotificationState(items = []) {
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    const normalizedItems = Array.isArray(items) ? items : [];

    const totalPages = Math.max(1, Math.ceil(normalizedItems.length / NOTIFICATION_PAGE_SIZE));
    notificationPage = Math.min(Math.max(notificationPage, 1), totalPages);
    if (!normalizedItems.length) {
        if (badge) {
            badge.textContent = '0';
            badge.style.display = 'none';
        }
        if (list) {
            list.innerHTML = `<div class="notif-empty-state"><p data-t="notifications_empty">${t('notifications_empty')}</p></div>`;
        }
        return;
    }

    const unreadCount = normalizedItems.filter(item => item.isRead !== true).length;
    if (badge) {
        badge.textContent = String(unreadCount);
        badge.style.display = unreadCount ? 'inline-block' : 'none';
    }

    if (list) {
        const start = (notificationPage - 1) * NOTIFICATION_PAGE_SIZE;
        const visibleItems = normalizedItems.slice(start, start + NOTIFICATION_PAGE_SIZE);
        const pagination = totalPages > 1
            ? `<div class="notif-pagination"><button type="button" class="notif-pagination-btn" ${notificationPage === 1 ? 'disabled' : ''} onclick="event.preventDefault();event.stopPropagation();changeNotificationPage(-1)">‹</button><span>Seite ${notificationPage} von ${totalPages}</span><button type="button" class="notif-pagination-btn" ${notificationPage === totalPages ? 'disabled' : ''} onclick="event.preventDefault();event.stopPropagation();changeNotificationPage(1)">›</button></div>`
            : '';
        list.innerHTML = pagination + visibleItems.map(item => {
            const isCar = Boolean(item.type === 'car' || item.isCar);
            const title = String(item.title || item.name || `${item.make || ''} ${item.model || ''}`.trim() || 'Eintrag').trim();
            const previous = Number(item.oldPrice ?? item.previousPrice ?? 0);
            const current = Number(item.newPrice ?? item.price ?? item.currentPrice ?? 0);
            const href = isCar
                ? `index.html?view=car-detail&id=${encodeURIComponent(String(item.id || ''))}`
                : `index.html?view=part-detail&partId=${encodeURIComponent(String(item.id || ''))}`;
            return `
                <a href="${href}" class="notif-item-card ${item.isRead ? 'is-read' : 'is-unread'}" data-notification-key="${escapeHtml(`${item.type}:${item.id}`)}">
                    <div class="notif-left-group">
                        <span class="unread-dot"></span>
                        <div class="notif-icon-circle" aria-hidden="true">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                                <line x1="7" y1="7" x2="7.01" y2="7"></line>
                            </svg>
                        </div>
                        <div class="notif-content-body">
                            <div class="notif-type-tag">Preis gesenkt!</div>
                            <div class="notif-item-title">${escapeHtml(title)}</div>
                            <div class="notif-price-row">
                                <span class="notif-price-new">${Number(current).toLocaleString('de-DE')} €</span>
                                <span class="notif-price-old">${Number(previous).toLocaleString('de-DE')} €</span>
                            </div>
                        </div>
                    </div>
                    <div class="notif-time-group">
                        <div class="notif-time">${escapeHtml(item.timeAgo || formatTimeAgo(item.updatedAt))}</div>
                        <button type="button" class="btn-delete-notif" aria-label="Benachrichtigung löschen" onclick="event.preventDefault();event.stopPropagation();deleteNotification('${escapeHtml(String(item.id || ''))}')">✕</button>
                    </div>
                </a>
            `;
        }).join('');
    }
}

function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Gerade eben';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    if (Number.isNaN(date.getTime())) return 'Gerade eben';
    const diffInSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffInSeconds < 60) return 'Gerade eben';
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) return `vor ${diffInMinutes} Min.`;
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `vor ${diffInHours} Std.`;
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays === 1) return 'gestern';
    if (diffInDays < 7) return `vor ${diffInDays} Tagen`;
    return date.toLocaleDateString('de-DE');
}

function addNotificationToBell(notif) {
    if (!notif?.id || !notif.type) return;
    if (notificationDeletedIds.has(String(notif.id))) return;
    const key = `${notif.type}:${notif.id}`;
    activePriceDropNotifications = [
        { ...notif, isRead: notificationReadIds.has(String(notif.id)), timeAgo: notif.timeAgo || formatTimeAgo(notif.updatedAt) },
        ...activePriceDropNotifications.filter(item => `${item.type}:${item.id}` !== key)
    ];
    renderPriceDropNotificationState(activePriceDropNotifications);
}

async function markAllNotificationsRead() {
    activePriceDropNotifications = activePriceDropNotifications.map(item => ({ ...item, isRead: true }));
    activePriceDropNotifications.forEach(item => notificationReadIds.add(String(item.id)));
    renderPriceDropNotificationState(activePriceDropNotifications);
    const user = auth.currentUser;
    if (user && activePriceDropNotifications.length) {
        try {
            await setDoc(doc(db, 'users', user.uid, 'notifications', 'state'), {
                readIds: arrayUnion(...activePriceDropNotifications.map(item => String(item.id)))
            }, { merge: true });
        } catch (error) {
            console.error('markAllNotificationsRead persistence failed:', error);
        }
    }
}

function changeNotificationPage(direction) {
    notificationPage += Number(direction) || 0;
    renderPriceDropNotificationState(activePriceDropNotifications);
}

async function deleteNotification(id) {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;
    notificationDeletedIds.add(normalizedId);
    activePriceDropNotifications = activePriceDropNotifications.filter(item => String(item.id) !== normalizedId);
    renderPriceDropNotificationState(activePriceDropNotifications);
    const user = auth.currentUser;
    if (user) {
        try {
            await setDoc(doc(db, 'users', user.uid, 'notifications', 'state'), {
                deletedIds: arrayUnion(normalizedId)
            }, { merge: true });
        } catch (error) {
            console.error('deleteNotification persistence failed:', error);
        }
    }
}

function removeNotificationFromBell(type, id) {
    const key = `${type}:${id}`;
    activePriceDropNotifications = activePriceDropNotifications.filter(item => `${item.type}:${item.id}` !== key);
    renderPriceDropNotificationState(activePriceDropNotifications);
}

async function checkPriceDropsForUser(userId) {
    const currentUser = auth.currentUser;
    const normalizedUserId = String(userId || '').trim();
    if (!currentUser?.uid || !normalizedUserId || currentUser.uid !== normalizedUserId) {
        return;
    }

    const stopActiveListeners = () => {
        priceDropRealtimeUnsubscribe.forEach(unsubscribe => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
        priceDropRealtimeUnsubscribe = [];
    };

    stopActiveListeners();
    activePriceDropNotifications = [];
    renderPriceDropNotificationState([]);

    const userRef = doc(db, 'users', normalizedUserId);
    try {
        const [userSnap, favoritesSnap] = await Promise.all([
            getDoc(userRef),
            getDoc(doc(db, 'users', normalizedUserId, 'favorites', 'state'))
        ]);
        const userData = userSnap.exists() ? (userSnap.data() || {}) : {};
        if (userData.priceAlertsEnabled === false) return;
        let notificationState = {};
        try {
            const notificationStateSnap = await getDoc(doc(db, 'users', normalizedUserId, 'notifications', 'state'));
            notificationState = notificationStateSnap.exists() ? (notificationStateSnap.data() || {}) : {};
        } catch (error) {
            if (error?.code !== 'permission-denied') {
                throw error;
            }
            console.warn('Price-drop notification state is unavailable; continuing without persisted notification state.');
        }
        notificationReadIds = new Set((notificationState.readIds || []).map(id => String(id)));
        notificationDeletedIds = new Set((notificationState.deletedIds || []).map(id => String(id)));

        const favoritesData = favoritesSnap.exists() ? (favoritesSnap.data() || {}) : {};
        const savedItemId = item => {
            if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
            if (item && typeof item === 'object') return String(item.id || item.carId || item.partId || '').trim();
            return '';
        };
        const savedCars = Array.isArray(favoritesData.carIds)
            ? favoritesData.carIds
            : (Array.isArray(userData.savedCars) ? userData.savedCars : []);
        const savedParts = Array.isArray(favoritesData.partIds)
            ? favoritesData.partIds
            : (Array.isArray(userData.savedParts) ? userData.savedParts : []);
        const watchDocument = (collectionName, id, type) => {
            const unsubscribe = onSnapshot(doc(db, collectionName, id), snapshot => {
                if (!snapshot.exists()) return;
                const data = snapshot.data() || {};
                if (notificationDeletedIds.has(String(snapshot.id))) {
                    removeNotificationFromBell(type, snapshot.id);
                    return;
                }
                const oldPrice = Number(data.previousPrice);
                const newPrice = Number(data.price);
                if (!Number.isFinite(oldPrice) || !Number.isFinite(newPrice) || newPrice >= oldPrice) {
                    removeNotificationFromBell(type, snapshot.id);
                    return;
                }
                addNotificationToBell({
                    id: snapshot.id,
                    title: type === 'car' ? `${data.make || ''} ${data.model || ''}`.trim() || 'Fahrzeug' : data.title || 'Autoteil',
                    newPrice,
                    oldPrice,
                    updatedAt: data.updatedAt,
                    type
                });
            }, error => console.error(`${type} price monitor failed:`, error));
            priceDropRealtimeUnsubscribe.push(unsubscribe);
        };
        Array.from(new Set(savedCars.map(savedItemId).filter(Boolean))).forEach(id => watchDocument('cars', id, 'car'));
        Array.from(new Set(savedParts.map(savedItemId).filter(Boolean))).forEach(id => watchDocument('parts', id, 'part'));
    } catch (error) {
        if (error?.code === 'permission-denied') {
            console.warn('checkPriceDropsForUser skipped a permission-denied read.');
        } else {
            console.error('checkPriceDropsForUser failed:', error);
        }
        renderPriceDropNotificationState([]);
    }
}

function toggleNotifDropdown(forceState) {
    const drop = document.getElementById('notif-dropdown');
    if (!drop) return;
    if (typeof forceState === 'boolean') {
        drop.style.display = forceState ? 'block' : 'none';
        return;
    }
    drop.style.display = drop.style.display === 'block' ? 'none' : 'block';
}

function openSettingsNotifications() {
    toggleNotifDropdown(false);
    void openSettings().then(() => {
      window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const modalBody = document.querySelector('#settings-modal .modal-body');
        if (!modalBody) return;

        const notifInput = document.getElementById('notif-pricedrop') || document.getElementById('notif-email');
        const targetSection = notifInput
            ? (notifInput.closest('div[style*="border-top"]') || notifInput.parentElement?.parentElement)
            : Array.from(modalBody.querySelectorAll('div')).find(element =>
                element.textContent.trim() === 'Benachrichtigungen'
            )?.parentElement;
        const scrollContainer = modalBody.scrollHeight > modalBody.clientHeight
            ? modalBody
            : (modalBody.closest('.modal') || modalBody);

        if (targetSection) {
            const bodyRect = scrollContainer.getBoundingClientRect();
            const targetRect = targetSection.getBoundingClientRect();
            const scrollPosition = scrollContainer.scrollTop + (targetRect.top - bodyRect.top) - 20;

            scrollContainer.scrollTo({
                top: Math.max(0, Math.min(scrollPosition, scrollContainer.scrollHeight - scrollContainer.clientHeight)),
                behavior: 'smooth'
            });

            targetSection.style.transition = 'background-color 0.4s ease';
            targetSection.style.backgroundColor = '#fef3c7';
            window.setTimeout(() => {
                targetSection.style.backgroundColor = 'transparent';
            }, 1200);
        } else {
            scrollContainer.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });
        }
      }, 200);
      });
    });
}

ready(() => {
    initDarkModeControls();
    window.addEventListener('popstate', syncFloatingDetailNav);
    window.addEventListener('hashchange', syncFloatingDetailNav);
});

document.addEventListener('click', e => {
    if (!e.target || typeof e.target.closest !== 'function') return;
    if (!e.target.closest('.notif-wrapper')) {
        const drop = document.getElementById('notif-dropdown');
        if (drop) drop.style.display = 'none';
    }
});

onAuthStateChanged(auth, async user => {
    authStateResolved = true;
    await Promise.all([
        loadCurrentUserProfile(user),
        user ? checkPriceDropsForUser(user.uid) : Promise.resolve(),
        refreshFavoriteCaches()
    ]);
    updateNavForAuth(user);
    updateNavFavBadge();
    prefillSellWizardContactFromUser(user);
    if (isPageActive('home')) {
        renderHomePartsLatest(allPartsCache);
        renderPartsBrowser(allPartsCache);
    }
    if (currentSearchMode === 'parts' && isPageActive('search')) {
        renderPartsSearchResults(allPartsCache);
    }
    await Promise.all([
        isPageActive('my-listings') ? renderMyListings() : Promise.resolve(),
        isPageActive('favorites') ? renderFavorites() : Promise.resolve(),
        user ? refreshPriceAlertBadge() : Promise.resolve()
    ]);
    const params = new URLSearchParams(window.location.search);
    if (window.__detailCar && (isPageActive('detail') || Boolean(params.get('id')))) {
        renderDetailPage(window.__detailCar);
    }
    if (window.__detailPart && (isPageActive('part-detail') || Boolean(params.get('partId')))) {
        renderPartDetailPage(window.__detailPart);
    }
});

window.setLanguage = setLanguage;
window.setLang = setLanguage;
window.doSignIn = handleSignIn;
window.doSignUp = handleSignUp;
window.searchCars = searchCars;
window.doHomeSearch = searchCarsFromHome;
window.showHomeView = showHomeView;
window.openCarsSearchView = openCarsSearchView;
window.openPartsCatalogView = openPartsCatalogView;
window.openPartsSearchView = openPartsSearchView;
window.setHomeSearchMode = setHomeSearchMode;
window.searchPartsFromHome = searchPartsFromHome;
window.submitPart = submitPart;
window.goSellStep = goSellStep;
window.nextStep = nextStep;
window.prevStep = prevStep;
window.goToStep = goToStep;
window.filterBodyAndGo = filterBodyAndGo;
window.filterFuelAndGo = filterFuelAndGo;
window.filterMakeAndGo = filterMakeAndGo;
window.loadCarDetailFromUrl = loadCarDetailFromUrl;
window.renderMyListings = renderMyListings;
window.loadMyListingsView = loadMyListingsView;
window.publishListing = publishListing;
window.doLogout = handleLogout;
window.updateNavForAuth = updateNavForAuth;
window.loadAllPublicListings = loadAllPublicListings;
window.handleUniversalCardClick = handleUniversalCardClick;
window.handleCarCardClick = handleCarCardClick;
window.updateCarPrice = updateCarPrice;
window.checkPriceDropsForUser = checkPriceDropsForUser;
window.markAllNotificationsRead = markAllNotificationsRead;
window.changeNotificationPage = changeNotificationPage;
window.deleteNotification = deleteNotification;
window.toggleNotifDropdown = toggleNotifDropdown;
window.openSettingsNotifications = openSettingsNotifications;
window.openCarDetailById = openCarDetailById;
window.openCarDetail = openCarDetail;
window.toggleDetailFav = toggleDetailFav;
window.toggleFavoriteCar = toggleFavoriteCar;
window.renderFavorites = renderFavorites;
window.clearAllFavs = clearAllFavs;
window.openSettings = openSettings;
window.saveSettings = saveSettings;
window.openPartDetail = openPartDetail;
window.openPartDetailModal = openPartDetailModal;
window.openPartDetailPage = openPartDetailPage;
window.renderPartsCatalogPage = renderPartsCatalogPage;
window.openSellerProfile = openSellerProfile;
window.renderSellerInfoCard = renderSellerInfoCard;
window.toggleFavoritePart = toggleFavoritePart;
window.selectPartDetailImage = selectPartDetailImage;
window.cleanupTransientUi = cleanupTransientUi;
if (typeof window.applyFilters !== 'function') window.applyFilters = searchCars;
window.clearAllFilters = clearAllFilters;
window.updateFilterModels = updateFilterModels;

function selectPartDetailImage(index) {
    if (!window.__detailPart) return;
    renderPartDetailGallery(window.__detailPart, index);
}
