export function calculateMonthlyPayment(price, downPayment, interestRate, termMonths) {
    const totalPrice = Number(price) || 0;
    const down = Math.max(0, Number(downPayment) || 0);
    const annualRate = Math.max(0, Number(interestRate) || 0);
    const months = Math.max(1, Math.round(Number(termMonths) || 1));
    const principal = Math.max(0, totalPrice - down);

    if (!principal) {
        return 0;
    }

    const monthlyRate = annualRate / 100 / 12;
    if (!monthlyRate) {
        return principal / months;
    }

    const numerator = principal * monthlyRate * ((1 + monthlyRate) ** months);
    const denominator = ((1 + monthlyRate) ** months) - 1;
    return denominator ? numerator / denominator : 0;
}

export function renderFinancingCalculator(containerId, vehiclePrice) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const price = Number(vehiclePrice) || 0;
    const defaultDown = Math.round(price * 0.2);
    container.innerHTML = `
        <div class="finance-calculator-card">
            <h4>Finanzierungsrechner</h4>
            <div style="display:grid;gap:10px">
                <label>Anzahlung (€)
                    <input id="${containerId}-down" type="number" min="0" value="${defaultDown}">
                </label>
                <label>Zinssatz p.a. (%)
                    <input id="${containerId}-rate" type="number" min="0" step="0.1" value="5.9">
                </label>
                <label>Laufzeit (Monate)
                    <input id="${containerId}-term" type="number" min="6" step="6" value="60">
                </label>
                <div id="${containerId}-result" style="font-weight:700"></div>
            </div>
        </div>
    `;

    const downEl = document.getElementById(`${containerId}-down`);
    const rateEl = document.getElementById(`${containerId}-rate`);
    const termEl = document.getElementById(`${containerId}-term`);
    const resultEl = document.getElementById(`${containerId}-result`);

    const update = () => {
        const monthly = calculateMonthlyPayment(
            price,
            downEl?.value,
            rateEl?.value,
            termEl?.value
        );
        resultEl.textContent = `Monatliche Rate: ${monthly.toLocaleString('de-DE', {
            style: 'currency',
            currency: 'EUR'
        })}`;
    };

    downEl?.addEventListener('input', update);
    rateEl?.addEventListener('input', update);
    termEl?.addEventListener('input', update);
    update();
}

window.calculateMonthlyPayment = calculateMonthlyPayment;
window.renderFinancingCalculator = renderFinancingCalculator;
