import { db } from '../../firebase-config.js?v=20260802';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const carsCollection = collection(db, 'cars');
const CACHE_KEY = 'hs_all_cars_cache';
let listCarsPromise = null;

function readCache() {
    try {
        const value = sessionStorage.getItem(CACHE_KEY);
        if (!value) return null;
        const cars = JSON.parse(value);
        return Array.isArray(cars) ? cars : null;
    } catch (error) {
        console.warn('Unable to read cached cars:', error);
        return null;
    }
}

function writeCache(cars) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(cars));
    } catch (error) {
        console.warn('Unable to cache cars:', error);
    }
}

export async function listCars({ forceRefresh = false } = {}) {
    if (!forceRefresh) {
        const cachedCars = readCache();
        if (cachedCars) return cachedCars;
    }
    if (listCarsPromise) return listCarsPromise;
    listCarsPromise = getDocs(carsCollection)
        .then(snapshot => {
            const cars = snapshot.docs.map(snapshotDoc => ({ id: snapshotDoc.id, ...snapshotDoc.data() }));
            writeCache(cars);
            return cars;
        })
        .finally(() => {
            listCarsPromise = null;
        });
    return listCarsPromise;
}

export async function getCar(carId) {
    const cachedCar = (readCache() || []).find(car => String(car.id) === String(carId));
    if (cachedCar) return cachedCar;
    const snapshot = await getDoc(doc(db, 'cars', carId));
    if (!snapshot.exists()) return null;
    const car = { id: snapshot.id, ...snapshot.data() };
    writeCache([car, ...(readCache() || []).filter(item => String(item.id) !== String(carId))]);
    return car;
}

export function createCar(data) {
    return addDoc(carsCollection, data);
}

export function updateCar(carId, data) {
    return updateDoc(doc(db, 'cars', carId), data).then(() => {
        const cars = readCache() || [];
        const index = cars.findIndex(car => String(car.id) === String(carId));
        if (index >= 0) writeCache(cars.map((car, i) => i === index ? { ...car, ...data } : car));
    });
}

export function deleteCar(carId) {
    return deleteDoc(doc(db, 'cars', carId)).then(() => {
        writeCache((readCache() || []).filter(car => String(car.id) !== String(carId)));
    });
}
