const COMPARE_STORAGE_KEY = 'hs_compare_cars_v1';
const MAX_COMPARE_CARS = 3;

function readCompareState() {
    try {
        const raw = localStorage.getItem(COMPARE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Failed to read compare state:', error);
        return [];
    }
}

function writeCompareState(cars) {
    try {
        localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(cars));
    } catch (error) {
        console.error('Failed to save compare state:', error);
    }
}

export function getComparedCars() {
    return readCompareState();
}

export function toggleCompareCar(carObject) {
    if (!carObject || !carObject.id) {
        throw new Error('A valid car object with id is required.');
    }

    const compareCars = readCompareState();
    const carId = String(carObject.id);
    const index = compareCars.findIndex(entry => String(entry.id) === carId);

    if (index >= 0) {
        compareCars.splice(index, 1);
        writeCompareState(compareCars);
        return { selected: false, cars: compareCars };
    }

    if (compareCars.length >= MAX_COMPARE_CARS) {
        return { selected: false, cars: compareCars, error: 'max_limit_reached' };
    }

    compareCars.push(carObject);
    writeCompareState(compareCars);
    return { selected: true, cars: compareCars };
}

export function renderComparisonModal() {
    const cars = readCompareState();
    const existing = document.getElementById('compare-modal');
    if (existing) {
        existing.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'compare-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1200;display:flex;align-items:center;justify-content:center;padding:16px;';

    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;width:min(1100px,100%);max-height:85vh;overflow:auto;border-radius:12px;padding:16px;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
    header.innerHTML = '<h3 style="margin:0">Fahrzeuge vergleichen</h3>';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = 'Schließen';
    closeBtn.onclick = () => modal.remove();
    header.appendChild(closeBtn);

    const content = document.createElement('div');
    if (!cars.length) {
        content.innerHTML = '<p style="margin:0;color:#6b7280">Noch keine Fahrzeuge zum Vergleich ausgewählt.</p>';
    } else {
        const columns = cars.map(car => `
            <div style="border:1px solid #e5e7eb;border-radius:10px;padding:12px">
                <div style="font-weight:700;margin-bottom:6px">${car.title || 'Fahrzeug'}</div>
                <div><strong>Preis:</strong> ${Number(car.price || 0).toLocaleString('de-DE')} €</div>
                <div><strong>Marke:</strong> ${car.brand || car.make || '—'}</div>
                <div><strong>Modell:</strong> ${car.model || '—'}</div>
                <div><strong>Baujahr:</strong> ${car.year || '—'}</div>
                <div><strong>Kilometer:</strong> ${Number(car.mileage || 0).toLocaleString('de-DE')} km</div>
            </div>
        `).join('');
        content.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">${columns}</div>`;
    }

    panel.appendChild(header);
    panel.appendChild(content);
    modal.appendChild(panel);
    modal.addEventListener('click', event => {
        if (event.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
}

window.toggleCompareCar = toggleCompareCar;
window.getComparedCars = getComparedCars;
window.renderComparisonModal = renderComparisonModal;
