import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, collection, addDoc, getDocs, serverTimestamp, onSnapshot, query, doc, deleteDoc, updateDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyATXciA0jR4liu_YbQaZgsV3dmAWHxIs3Y",
    authDomain: "mypatrimoine-12ea8.firebaseapp.com",
    projectId: "mypatrimoine-12ea8",
    storageBucket: "mypatrimoine-12ea8.firebasestorage.app",
    messagingSenderId: "264004329695",
    appId: "1:264004329695:web:ec7a03f6fb3f912859096a"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();
const PRICE_API_URL = "https://noisy-moon-34c5.nathan-pro-po.workers.dev"; 

const livePricesCache = {};
const livePricesCacheMeta = {};
const formatEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const CATEGORIES = ['Salaire', 'Logement', 'Alimentation', 'Transports', 'Loisirs', 'Autre'];
const CHART_PALETTE = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#06B6D4'];

const setEl = (id, prop, val) => { const el = document.getElementById(id); if (el) el[prop] = val; };

// FONCTION ANTI-CRASH POUR LES DATES
const parseDate = (d) => {
    if (!d) return new Date();
    if (typeof d.toDate === 'function') return d.toDate();
    if (d.seconds) return new Date(d.seconds * 1000);
    return new Date(d);
};

const loginScreen = document.getElementById('login-screen');
const dashboardScreen = document.getElementById('dashboard-screen');
const budgetScreen = document.getElementById('budget-screen');
const bourseScreen = document.getElementById('bourse-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userEmailSpan = document.getElementById('user-email');

let showBoursePercent = false; 
let currentBourseFilter = 'ALL'; 
let bourseCash = { PEA: 0, CTO: 0, "A.V.": 0 };

onAuthStateChanged(auth, (user) => {
    if (user) {
        loginScreen.classList.remove('active'); loginScreen.classList.add('hidden');
        dashboardScreen.classList.remove('hidden'); dashboardScreen.classList.add('active');
        userEmailSpan.innerText = user.email;
        loadDashboardData(user.uid);
    } else {
        [dashboardScreen, budgetScreen, bourseScreen].forEach(s => { if(s) { s.classList.remove('active'); s.classList.add('hidden'); } });
        loginScreen.classList.remove('hidden'); loginScreen.classList.add('active');
        stopDashboardData();
    }
});

loginBtn.addEventListener('click', async () => { try { await signInWithPopup(auth, provider); } catch (error) { alert("Erreur lors de la connexion."); } });
logoutBtn.addEventListener('click', async () => { try { await signOut(auth); } catch (error) { console.error(error); } });

const fabAdd = document.getElementById('fab-add');
const addModal = document.getElementById('add-modal');
const closeModalBtn = document.getElementById('close-modal');

fabAdd.addEventListener('click', () => {
    if(document.getElementById('tx-date')) { const today = new Date(); document.getElementById('tx-date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`; }
    if(document.getElementById('tx-id')) document.getElementById('tx-id').value = '';
    if(document.getElementById('submit-tx')) document.getElementById('submit-tx').innerText = "Valider";
    addModal.classList.remove('hidden');
});
closeModalBtn.addEventListener('click', () => addModal.classList.add('hidden'));
addModal.addEventListener('click', (e) => { if (e.target === addModal) addModal.classList.add('hidden'); });

if (document.getElementById('btn-back-dashboard')) document.getElementById('btn-back-dashboard').addEventListener('click', () => { budgetScreen.classList.remove('active'); budgetScreen.classList.add('hidden'); dashboardScreen.classList.remove('hidden'); dashboardScreen.classList.add('active'); });
if (document.getElementById('btn-back-dashboard-bourse')) document.getElementById('btn-back-dashboard-bourse').addEventListener('click', () => { bourseScreen.classList.remove('active'); bourseScreen.classList.add('hidden'); dashboardScreen.classList.remove('hidden'); dashboardScreen.classList.add('active'); });

const radioToggles = document.querySelectorAll('input[name="tx_type"]');
radioToggles.forEach(radio => {
    radio.addEventListener('change', (e) => {
        if (e.target.value === 'transfer') {
            document.getElementById('group-account-single').classList.add('d-none'); document.getElementById('group-account-transfer').classList.remove('d-none');
            if(document.getElementById('group-category')) document.getElementById('group-category').classList.add('d-none');
            if(document.getElementById('group-frequency')) document.getElementById('group-frequency').classList.add('d-none');
            document.getElementById('tx-label').value = "Virement interne";
        } else {
            document.getElementById('group-account-single').classList.remove('d-none'); document.getElementById('group-account-transfer').classList.add('d-none');
            if(document.getElementById('group-category')) document.getElementById('group-category').classList.remove('d-none');
            if(document.getElementById('group-frequency')) document.getElementById('group-frequency').classList.remove('d-none');
            if (document.getElementById('tx-label').value === "Virement interne") document.getElementById('tx-label').value = "";
        }
    });
});

let unsubscribeTransactions = null, unsubscribeBourse = null, unsubscribeImmo = null, unsubscribeAccounts = null, unsubscribeBudgets = null, unsubscribeBourseCash = null;
let patrimoineChart = null, budgetChart = null;
let userAccountsList = []; let budgetsMap = {}; 

function initChart() {
    const ctx = document.getElementById('patrimoine-chart').getContext('2d');
    if(patrimoineChart) patrimoineChart.destroy();
    patrimoineChart = new Chart(ctx, { type: 'doughnut', data: { labels: ['Banque', 'Bourse / A.V.', 'Immobilier'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#3B82F6', '#8B5CF6', '#10B981'], borderWidth: 0, hoverOffset: 10 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#F8FAFC', padding: 20 } } }, cutout: '75%' } });
}

async function fetchPrices(tickers) {
    const missing = [...new Set(tickers)].filter(t => t && !(t in livePricesCache));
    for (let i = 0; i < missing.length; i += 30) {
        const chunk = missing.slice(i, i + 30);
        try {
            const res = await fetch(`${PRICE_API_URL}/quote?symbols=${chunk.map(encodeURIComponent).join(',')}`);
            const data = await res.json();
            chunk.forEach(t => {
                const p = data[t] && data[t].priceEUR; livePricesCache[t] = p > 0 ? p : null;
                livePricesCacheMeta[t] = { priceEUR: p > 0 ? p : null, name: data[t] && data[t].name ? data[t].name : null };
            });
        } catch (e) { chunk.forEach(t => { livePricesCache[t] = null; livePricesCacheMeta[t] = { priceEUR: null, name: null }; }); }
    }
}
function getLivePrice(ticker, fallbackPrice) { const p = livePricesCache[ticker]; return p > 0 ? p : fallbackPrice; }

function loadDashboardData(userId) {
    initChart();
    let viewedDate = new Date(); let globalTxDocs = [];
    let totalLiquidites = 0, totalBourse = 0, totalImmo = 0; let globalRenderBourse = null; 

    const updateNetWorthAndChart = () => {
        const netWorth = totalLiquidites + totalBourse + totalImmo;
        setEl('card-liquidites', 'querySelector(".amount").innerText', formatEuro.format(totalLiquidites));
        setEl('card-immo', 'querySelector(".amount").innerText', formatEuro.format(totalImmo));
        const elNetWorth = document.querySelector('.net-worth-card .amount');
        if (elNetWorth) {
            elNetWorth.innerText = formatEuro.format(netWorth); 
            elNetWorth.className = netWorth >= 0 ? "amount highlight-green" : "amount highlight-red";
        }
        if (patrimoineChart) { patrimoineChart.data.datasets[0].data = [Math.max(0, totalLiquidites), totalBourse, totalImmo]; patrimoineChart.update(); }
    };

    document.getElementById('card-liquidites')?.addEventListener('click', () => { dashboardScreen.classList.add('hidden'); dashboardScreen.classList.remove('active'); budgetScreen.classList.remove('hidden'); budgetScreen.classList.add('active'); viewedDate = new Date(); renderTransactions(); });
    document.getElementById('card-bourse')?.addEventListener('click', () => { dashboardScreen.classList.add('hidden'); dashboardScreen.classList.remove('active'); bourseScreen.classList.remove('hidden'); bourseScreen.classList.add('active'); });
    document.getElementById('btn-prev-month')?.addEventListener('click', () => { viewedDate = new Date(viewedDate.getFullYear(), viewedDate.getMonth() - 1, 1); renderTransactions(); });
    document.getElementById('btn-next-month')?.addEventListener('click', () => { viewedDate = new Date(viewedDate.getFullYear(), viewedDate.getMonth() + 1, 1); renderTransactions(); });
    
    document.getElementById('bourse-filter')?.addEventListener('change', (e) => { currentBourseFilter = e.target.value; if(globalRenderBourse) globalRenderBourse(); });
    
    document.getElementById('btn-toggle-perf')?.addEventListener('click', (e) => {
        showBoursePercent = !showBoursePercent; 
        e.target.innerText = showBoursePercent ? "Afficher en €" : "Afficher en %";
        if(globalRenderBourse) globalRenderBourse();
    });

    unsubscribeBourseCash = onSnapshot(doc(db, `users/${userId}/bourse_settings`, 'cash'), (docSnap) => {
        if (docSnap.exists()) { bourseCash = { PEA: 0, CTO: 0, "A.V.": 0, ...docSnap.data() }; } else { bourseCash = { PEA: 0, CTO: 0, "A.V.": 0 }; }
        if(globalRenderBourse) globalRenderBourse();
    });

    unsubscribeAccounts = onSnapshot(query(collection(db, `users/${userId}/accounts`)), (snapshot) => {
        userAccountsList = []; snapshot.forEach(doc => userAccountsList.push(doc.data().name));
        if (userAccountsList.length === 0) { addDoc(collection(db, `users/${userId}/accounts`), { name: "Compte Courant", date: serverTimestamp() }); return; }
        const optionsHtml = userAccountsList.map(name => `<option value="${name}">${name}</option>`).join('');
        ['tx-account', 'tx-from', 'tx-to', 'express-account'].forEach(id => { setEl(id, 'innerHTML', optionsHtml); });
    });

    unsubscribeBudgets = onSnapshot(query(collection(db, `users/${userId}/budgets`)), (snapshot) => { budgetsMap = {}; snapshot.forEach(d => { budgetsMap[d.data().category] = d.data().limit; }); renderBudgetsManager(); renderTransactions(); });

    const renderTransactions = () => {
        totalLiquidites = 0; let htmlList = ''; let balances = {};
        userAccountsList.forEach(name => balances[name] = 0);
        let monthIn = 0, monthOut = 0; let categoriesExpenses = {}; let detailedHtmlList = '';
        const viewedMonth = viewedDate.getMonth(); const viewedYear = viewedDate.getFullYear();
        if (document.getElementById('current-month-badge')) { const monthName = viewedDate.toLocaleString('fr-FR', { month: 'long', year: 'numeric' }); setEl('current-month-badge', 'innerText', monthName.charAt(0).toUpperCase() + monthName.slice(1)); }

        globalTxDocs.forEach(docSnapshot => {
            const data = docSnapshot.data();
            if (data.type === 'transfer') {
                if (balances[data.from_account] === undefined) balances[data.from_account] = 0;
                if (balances[data.to_account] === undefined) balances[data.to_account] = 0;
                balances[data.from_account] -= data.amount; balances[data.to_account] += data.amount;
            } else {
                const accName = data.account || "Compte Courant";
                if (balances[accName] === undefined) balances[accName] = 0;
                balances[accName] += data.amount; totalLiquidites += data.amount;
            }
            const txDate = parseDate(data.date); 
            const dateStr = txDate.toLocaleDateString('fr-FR');

            if(htmlList.split('<li>').length <= 5) {
                const accountBadge = data.type === 'transfer' ? `🔄 ${data.from_account} ➔ ${data.to_account}` : data.account || "Compte Courant";
                let amountColorClass = data.amount > 0 ? 'text-green' : (data.type === 'transfer' ? 'text-muted' : '');
                htmlList += `<li><div class="item-details"><span class="item-title">${data.label} <span class="badge">${accountBadge}</span></span><span class="item-sub">${dateStr}</span></div><div class="item-details right"><span class="item-value ${amountColorClass}">${formatEuro.format(data.amount)}</span></div></li>`;
            }

            if (txDate.getMonth() === viewedMonth && txDate.getFullYear() === viewedYear) {
                if (data.type !== 'transfer') {
                    if (data.amount > 0) monthIn += data.amount;
                    if (data.amount < 0) { monthOut += Math.abs(data.amount); const cat = data.category || 'Autre'; if (!categoriesExpenses[cat]) categoriesExpenses[cat] = 0; categoriesExpenses[cat] += Math.abs(data.amount); }
                }
                const safeData = encodeURIComponent(JSON.stringify({ label: data.label, type: data.type, amount: data.amount, account: data.account, from_account: data.from_account, to_account: data.to_account, category: data.category, frequency: data.frequency, dateISO: `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}` }));
                const isRecurring = data.frequency === 'Mensuel' ? '🔄' : '';
                detailedHtmlList += `<li><div class="item-details"><span class="item-title">${data.label} ${isRecurring} <span class="badge">${data.category || 'Virement'}</span></span><span class="item-sub">${dateStr} - ${data.account || (data.from_account + '➔' + data.to_account)}</span></div><div class="item-actions"><span class="item-value ${data.amount > 0 ? 'text-green' : (data.type === 'transfer' ? 'text-muted' : '')}" style="margin-right: 15px;">${formatEuro.format(data.amount)}</span><button class="action-small edit btn-edit-tx" data-id="${docSnapshot.id}" data-full="${safeData}">✏️</button><button class="action-small delete btn-del-tx" data-id="${docSnapshot.id}">🗑️</button></div></li>`;
            }
        });
        
        setEl('tx-list', 'innerHTML', htmlList || '<p class="text-muted">Aucune opération.</p>');
        let breakdownHtml = ''; for (const [accName, accTotal] of Object.entries(balances)) { breakdownHtml += `<div class="account-line"><span>${accName}</span><span class="acc-value">${formatEuro.format(accTotal)}</span></div>`; }
        setEl('accounts-breakdown', 'innerHTML', breakdownHtml);
        
        setEl('month-in', 'innerText', formatEuro.format(monthIn));
        setEl('month-out', 'innerText', formatEuro.format(monthOut));
        const epargne = monthIn - monthOut;
        setEl('month-rest', 'innerText', formatEuro.format(epargne));
        setEl('month-rest', 'className', epargne >= 0 ? "amount highlight-green" : "amount highlight-red");

        // RESTAURATION DU BUDGET
        const realizedLabels = new Set();
        globalTxDocs.forEach(t => { const d = t.data(); const dt = parseDate(d.date); if (dt.getMonth() === viewedMonth && dt.getFullYear() === viewedYear && d.type === 'expense' && d.frequency === 'Mensuel') realizedLabels.add(d.label); });
        const now = new Date(); const isHistory = viewedYear < now.getFullYear() || (viewedYear === now.getFullYear() && viewedMonth < now.getMonth());
        let recurringCharges = [];
        if (!isHistory) { globalTxDocs.forEach(t => { const d = t.data(); if (d.type === 'expense' && d.frequency === 'Mensuel' && !realizedLabels.has(d.label)) recurringCharges.push({ label: d.label, amount: Math.abs(d.amount), day: parseDate(d.date).getDate() }); }); }
        const chargesRestantes = recurringCharges.reduce((s, c) => s + c.amount, 0);
        const resteReel = monthIn - monthOut - chargesRestantes;
        setEl('month-rest-reel', 'innerText', formatEuro.format(resteReel));
        setEl('month-rest-reel', 'className', resteReel >= 0 ? "amount highlight-green" : "amount highlight-red");
        setEl('upcoming-charges', 'innerHTML', recurringCharges.length ? '<strong>Charges à venir :</strong> ' + recurringCharges.map(c => `${c.label}`).join(', ') : '<span class="text-muted">Aucune charge fixe restante.</span>');

        const sortedCats = Object.entries(categoriesExpenses).sort((a, b) => b[1] - a[1]);
        Object.keys(budgetsMap).forEach(cat => { if (!sortedCats.some(([c]) => c === cat)) sortedCats.push([cat, 0]); });
        sortedCats.sort((a, b) => b[1] - a[1]);
        let catHtml = '';
        sortedCats.forEach(([cat, amount]) => {
            const limit = budgetsMap[cat] || 0; let fillClass = 'cat-progress-fill'; let labelRight, width;
            if (limit > 0) { const ratio = amount / limit; width = Math.min(100, Math.round(ratio * 100)); if (ratio > 1) fillClass += ' gauge-red'; else if (ratio >= 0.8) fillClass += ' gauge-orange'; else fillClass += ' gauge-green'; labelRight = `${formatEuro.format(amount)} / ${formatEuro.format(limit)}`; } 
            else { const percentage = monthOut > 0 ? Math.round((amount / monthOut) * 100) : 0; width = percentage; labelRight = `${formatEuro.format(amount)} (${percentage}%)`; }
            catHtml += `<div style="margin-bottom: 15px;"><div class="cat-header"><span>${cat}</span><span>${labelRight}</span></div><div class="cat-progress-bg"><div class="${fillClass}" style="width: ${width}%"></div></div></div>`;
        });
        setEl('category-analysis', 'innerHTML', catHtml || '<p class="text-muted">Aucune dépense ce mois-ci.</p>');
        setEl('detailed-tx-list', 'innerHTML', detailedHtmlList || '<p class="text-muted">Aucune transaction ce mois-ci.</p>');

        const bctx = document.getElementById('budget-chart');
        if (bctx) {
            if (budgetChart) budgetChart.destroy();
            const chartCats = sortedCats.filter(([cat, amount]) => amount > 0);
            if (chartCats.length > 0) budgetChart = new Chart(bctx.getContext('2d'), { type: 'doughnut', data: { labels: chartCats.map(c => c[0]), datasets: [{ data: chartCats.map(c => c[1]), backgroundColor: CHART_PALETTE, borderWidth: 0, hoverOffset: 10 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#F8FAFC', padding: 15 } } }, cutout: '60%' } });
        }
        
        updateNetWorthAndChart();
    };

    unsubscribeTransactions = onSnapshot(query(collection(db, `users/${userId}/transactions`)), (snapshot) => {
        globalTxDocs = snapshot.docs.sort((a, b) => { const timeA = parseDate(a.data().date).getTime(); const timeB = parseDate(b.data().date).getTime(); return timeB - timeA; });
        renderTransactions();
    });

    let bourseTimer = null;
    unsubscribeBourse = onSnapshot(query(collection(db, `users/${userId}/assets_bourse`)), (snapshot) => {
        const bourseDocs = snapshot.docs;
        globalRenderBourse = async () => {
            const autoTickers = bourseDocs.map(d => d.data()).filter(d => d.tracking !== 'manual').map(d => d.ticker);
            await fetchPrices(autoTickers);
            
            for (const docSnapshot of bourseDocs) {
                const data = docSnapshot.data(); const apiInfo = livePricesCacheMeta[data.ticker];
                if (apiInfo && apiInfo.name && (!data.nom || data.nom === data.ticker)) await updateDoc(doc(db, `users/${userId}/assets_bourse`, docSnapshot.id), { nom: apiInfo.name });
            }
            
            let valPeaAssets = 0, achatPea = 0, valCtoAssets = 0, achatCto = 0, valAvAssets = 0, achatAv = 0;
            let enrichedDocs = [];

            for (const docSnapshot of bourseDocs) {
                const data = docSnapshot.data(); const isManual = data.tracking === 'manual';
                const livePrice = isManual ? (data.prix_actuel || data.price_achat) : getLivePrice(data.ticker, data.price_achat);
                const valeurActuelle = data.quantity * livePrice; const valAchat = data.quantity * data.price_achat;
                enrichedDocs.push({ id: docSnapshot.id, data, livePrice, valeurActuelle, valAchat, isManual });
            }

            enrichedDocs.sort((a, b) => b.valeurActuelle - a.valeurActuelle);
            let detailedHtml = ''; let dashboardHtml = '';

            enrichedDocs.forEach(item => {
                const { id, data, livePrice, valeurActuelle, valAchat, isManual } = item;
                const plusValue = valeurActuelle - valAchat; 
                const percent = valAchat > 0 ? (plusValue / valAchat) * 100 : 0;
                
                if (data.enveloppe === 'PEA') { valPeaAssets += valeurActuelle; achatPea += valAchat; }
                if (data.enveloppe === 'CTO') { valCtoAssets += valeurActuelle; achatCto += valAchat; }
                if (data.enveloppe === 'A.V.') { valAvAssets += valeurActuelle; achatAv += valAchat; }

                const pnlClass = plusValue >= 0 ? 'text-green' : 'text-red'; const sign = plusValue >= 0 ? '+' : '';
                
                const pnlDisplay = showBoursePercent ? `${sign}${percent.toFixed(2)}%` : `${sign}${formatEuro.format(plusValue)}`;
                const displayName = data.nom || data.ticker;

                if(dashboardHtml.split('<li>').length <= 5) {
                    dashboardHtml += `<li><div class="item-details"><span class="item-title">${displayName} <span class="badge">${data.enveloppe}</span></span><span class="item-sub">${data.quantity} parts @ ${formatEuro.format(livePrice)}</span></div><div class="item-details right"><span class="item-value">${formatEuro.format(valeurActuelle)}</span><span class="item-sub ${pnlClass}">${pnlDisplay}</span></div></li>`;
                }

                if (currentBourseFilter === 'ALL' || data.enveloppe === currentBourseFilter) {
                    const editBtn = isManual ? `<button class="action-small edit btn-edit-price" data-id="${id}" data-name="${displayName}" data-price="${livePrice}" style="margin-right: 8px;" title="Changer le prix">✏️</button>` : '';
                    const delBtn = `<button class="action-small delete btn-del-asset" data-id="${id}" style="margin-right: 8px;" title="Annuler/Supprimer (sans toucher aux liquidités)">🗑️</button>`;
                    detailedHtml += `<li><div class="item-details"><span class="item-title">${displayName} <span class="badge">${data.enveloppe} ${isManual?'(Manuel)':''}</span></span><span class="item-sub">${data.quantity} parts @ ${formatEuro.format(livePrice)}</span></div><div class="item-actions"><div class="item-details right" style="margin-right: 15px;"><span class="item-value">${formatEuro.format(valeurActuelle)}</span><span class="item-sub ${pnlClass}">${pnlDisplay}</span></div>${editBtn}${delBtn}<button class="btn-secondary sell-bourse" data-id="${id}" data-qty="${data.quantity}" data-ticker="${data.ticker}" data-liveprice="${livePrice}" data-env="${data.enveloppe}" data-pru="${data.price_achat}">Vendre</button></div></li>`;
                }
            });

            const totalPea = valPeaAssets + (bourseCash['PEA'] || 0);
            const totalCto = valCtoAssets + (bourseCash['CTO'] || 0);
            const totalAv = valAvAssets + (bourseCash['A.V.'] || 0);
            const globalTotal = totalPea + totalCto + totalAv;

            setEl('dashboard-bourse-total', 'innerText', formatEuro.format(globalTotal));
            setEl('dashboard-bourse-breakdown', 'innerHTML', `
                <div class="account-line"><span>PEA</span><span class="acc-value">${formatEuro.format(totalPea)}</span></div>
                <div class="account-line"><span>CTO</span><span class="acc-value">${formatEuro.format(totalCto)}</span></div>
                <div class="account-line"><span>Assurance Vie</span><span class="acc-value">${formatEuro.format(totalAv)}</span></div>`);
            setEl('bourse-list', 'innerHTML', dashboardHtml || '<p class="text-muted">Aucune action.</p>');

            const formatPerfCombined = (valAssets, achatAssets, envCash, envKey) => {
                const realized = bourseCash['realized_' + envKey] || 0;
                const latent = valAssets - achatAssets;
                const totalDiff = latent + realized;
                const currentTotalValue = valAssets + envCash;
                const initialInvested = currentTotalValue - totalDiff;
                let perc = 0; if (initialInvested > 0) perc = (totalDiff / initialInvested) * 100;
                const signDiff = totalDiff === 0 ? '' : (totalDiff > 0 ? '+' : '');
                
                const txt = showBoursePercent ? `${signDiff}${perc.toFixed(2)}%` : `${signDiff}${formatEuro.format(totalDiff)}`;
                return { txt, color: totalDiff >= 0 ? 'amount highlight-green' : 'amount highlight-red' };
            };

            setEl('bourse-detailed-list', 'innerHTML', detailedHtml || '<p class="text-muted">Aucune action.</p>');
            setEl('bourse-pea-total', 'innerText', formatEuro.format(totalPea));
            setEl('bourse-cto-total', 'innerText', formatEuro.format(totalCto));
            setEl('bourse-av-total', 'innerText', formatEuro.format(totalAv));
            setEl('bourse-global-total', 'innerText', formatEuro.format(globalTotal));
            
            setEl('bourse-pea-investi', 'innerText', formatEuro.format(valPeaAssets));
            setEl('bourse-cto-investi', 'innerText', formatEuro.format(valCtoAssets));
            setEl('bourse-av-investi', 'innerText', formatEuro.format(valAvAssets));
            
            setEl('bourse-pea-cash', 'innerText', formatEuro.format(bourseCash['PEA'] || 0));
            setEl('bourse-cto-cash', 'innerText', formatEuro.format(bourseCash['CTO'] || 0));
            setEl('bourse-av-cash', 'innerText', formatEuro.format(bourseCash['A.V.'] || 0));

            // Ajout du bouton ✏️ à côté de la performance pour pouvoir réinitialiser un test
            const makePerfHtml = (perfObj, env) => `${perfObj.txt} <button class="action-small edit btn-edit-realized" data-env="${env}" style="background:none;border:none;cursor:pointer;font-size:0.8rem;padding:0;margin-left:5px;" title="Corriger la plus-value enregistrée">✏️</button>`;

            const pPea = formatPerfCombined(valPeaAssets, achatPea, bourseCash['PEA'] || 0, 'PEA');
            setEl('bourse-pea-perf', 'innerHTML', makePerfHtml(pPea, 'PEA')); setEl('bourse-pea-perf', 'className', pPea.color);
            const pCto = formatPerfCombined(valCtoAssets, achatCto, bourseCash['CTO'] || 0, 'CTO');
            setEl('bourse-cto-perf', 'innerHTML', makePerfHtml(pCto, 'CTO')); setEl('bourse-cto-perf', 'className', pCto.color);
            const pAv = formatPerfCombined(valAvAssets, achatAv, bourseCash['A.V.'] || 0, 'A.V.');
            setEl('bourse-av-perf', 'innerHTML', makePerfHtml(pAv, 'A.V.')); setEl('bourse-av-perf', 'className', pAv.color);
            
            const globalRealized = (bourseCash['realized_PEA'] || 0) + (bourseCash['realized_CTO'] || 0) + (bourseCash['realized_A.V.'] || 0);
            const globalLatent = (valPeaAssets + valCtoAssets + valAvAssets) - (achatPea + achatCto + achatAv);
            const globalDiff = globalLatent + globalRealized;
            const globalInvested = globalTotal - globalDiff;
            let gPerc = 0; if (globalInvested > 0) gPerc = (globalDiff / globalInvested) * 100;
            const gSign = globalDiff === 0 ? '' : (globalDiff > 0 ? '+' : '');
            
            const gTxt = showBoursePercent ? `${gSign}${gPerc.toFixed(2)}%` : `${gSign}${formatEuro.format(globalDiff)}`;
            setEl('bourse-global-perf', 'innerText', gTxt); 
            setEl('bourse-global-perf', 'className', globalDiff >= 0 ? 'amount highlight-green' : 'amount highlight-red');

            totalBourse = globalTotal; updateNetWorthAndChart();
        };
        
        globalRenderBourse();
        if (bourseTimer) clearInterval(bourseTimer);
        bourseTimer = setInterval(() => { if (!document.hidden) { for (let key in livePricesCache) delete livePricesCache[key]; globalRenderBourse(); } }, 60000);
    });

    unsubscribeImmo = onSnapshot(query(collection(db, `users/${userId}/assets_immo`)), (snapshot) => {
        totalImmo = 0; let htmlList = '';
        snapshot.forEach(doc => {
            const data = doc.data(); totalImmo += data.valeur;
            htmlList += `<li><div class="item-details"><span class="item-title">${data.nom} <span class="badge">${data.type}</span></span><span class="item-sub">${data.surface > 0 ? data.surface + ' m²' : '-'}</span></div><div class="item-details right"><span class="item-value">${formatEuro.format(data.valeur)}</span></div></li>`;
        });
        setEl('immo-list', 'innerHTML', htmlList || '<p class="text-muted">Aucun bien.</p>');
        setEl('card-immo', 'querySelector(".amount").innerText', formatEuro.format(totalImmo));
        updateNetWorthAndChart();
    });
}

function renderBudgetsManager() {
    const bm = document.getElementById('budgets-manager'); if (!bm) return;
    bm.innerHTML = CATEGORIES.map(cat => `<div class="budget-row"><span>${cat}</span><input type="number" class="budget-input" data-cat="${cat}" min="0" step="10" placeholder="Pas de budget" value="${budgetsMap[cat] || ''}"></div>`).join('');
}

function stopDashboardData() {
    if (unsubscribeTransactions) unsubscribeTransactions(); if (unsubscribeBourse) unsubscribeBourse(); if (unsubscribeImmo) unsubscribeImmo(); if (unsubscribeAccounts) unsubscribeAccounts(); if (unsubscribeBudgets) unsubscribeBudgets(); if (unsubscribeBourseCash) unsubscribeBourseCash();
    if (patrimoineChart) patrimoineChart.destroy(); if (budgetChart) budgetChart.destroy();
}

const viewChoice = document.getElementById('modal-view-choice'); const viewTransaction = document.getElementById('modal-view-transaction'); const viewBourse = document.getElementById('modal-view-bourse'); const viewImmo = document.getElementById('modal-view-immo'); const viewExpress = document.getElementById('modal-view-express');
function showModalView(viewToShow) { [viewChoice, viewTransaction, viewBourse, viewImmo, viewExpress].forEach(view => { if(view) { view.classList.remove('active-view'); view.classList.add('hidden-view'); } }); viewToShow.classList.remove('hidden-view'); viewToShow.classList.add('active-view'); }

document.querySelector('.action-btn[data-type="transaction"]').addEventListener('click', () => showModalView(viewTransaction)); document.querySelector('.action-btn[data-type="bourse"]').addEventListener('click', () => showModalView(viewBourse)); document.querySelector('.action-btn[data-type="immo"]').addEventListener('click', () => showModalView(viewImmo));
const expressBtn = document.querySelector('.action-btn[data-type="express"]');
if (expressBtn) expressBtn.addEventListener('click', () => { if(document.getElementById('express-amount')) document.getElementById('express-amount').value = ''; showModalView(viewExpress); });
document.querySelectorAll('.back-to-choices').forEach(btn => btn.addEventListener('click', () => showModalView(viewChoice)));
document.querySelectorAll('.express-cat').forEach(btn => { btn.addEventListener('click', () => { document.querySelectorAll('.express-cat').forEach(b => b.classList.remove('active')); btn.classList.add('active'); }); });

const allForms = [document.getElementById('transaction-form'), document.getElementById('bourse-form'), document.getElementById('immo-form'), document.getElementById('express-form')];
function closeAndResetModal() { addModal.classList.add('hidden'); setTimeout(() => { showModalView(viewChoice); allForms.forEach(form => { if (form) form.reset(); }); }, 500); }

const searchInput = document.getElementById('bourse-search'); const hiddenTicker = document.getElementById('bourse-ticker'); const hiddenName = document.getElementById('bourse-name'); const resultsList = document.getElementById('bourse-results'); let searchTimeout;
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout); hiddenTicker.value = ''; hiddenName.value = '';
        const queryVal = e.target.value.trim(); if (queryVal.length < 2) { resultsList.classList.add('hidden'); return; }
        searchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${PRICE_API_URL}/search?q=${encodeURIComponent(queryVal)}`); const results = await res.json(); resultsList.innerHTML = '';
                if (Array.isArray(results) && results.length > 0) {
                    results.forEach(item => {
                        const li = document.createElement('li'); li.innerHTML = `<span class="result-name">${item.name}</span> <span class="result-symbol">${item.symbol} (${item.exchange})</span>`;
                        li.addEventListener('click', () => { searchInput.value = item.name; hiddenName.value = item.name; hiddenTicker.value = item.symbol; resultsList.classList.add('hidden'); }); resultsList.appendChild(li);
                    });
                } else { resultsList.innerHTML = '<li class="text-muted">Aucun résultat</li>'; } resultsList.classList.remove('hidden');
            } catch (err) {}
        }, 300);
    });
    document.addEventListener('click', (e) => { if (!e.target.closest('.autocomplete-container')) resultsList.classList.add('hidden'); });
}

const btnAddAccount = document.getElementById('btn-add-account');
if (btnAddAccount) { btnAddAccount.addEventListener('click', async () => { const accName = prompt("Nom du nouveau compte :"); if (accName && accName.trim() !== "") { const user = auth.currentUser; if (user) await addDoc(collection(db, `users/${user.uid}/accounts`), { name: accName.trim(), date: serverTimestamp() }); } }); }

const btnSaveBudgets = document.getElementById('btn-save-budgets');
if (btnSaveBudgets) { btnSaveBudgets.addEventListener('click', async () => { const user = auth.currentUser; if (!user) return; const inputs = document.querySelectorAll('.budget-input'); for (const inp of inputs) { const cat = inp.dataset.cat; const val = parseFloat(inp.value); if (!isNaN(val) && val > 0) { await setDoc(doc(db, `users/${user.uid}/budgets`, cat), { category: cat, limit: val }); } else { await deleteDoc(doc(db, `users/${user.uid}/budgets`, cat)).catch(() => {}); } } alert("Budgets enregistrés !"); }); }

document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const user = auth.currentUser; if (!user) return;
    const txId = document.getElementById('tx-id').value; const type = document.querySelector('input[name="tx_type"]:checked').value; const amountRaw = parseFloat(document.getElementById('tx-amount').value); let finalAmount = Math.abs(amountRaw);
    const dateInput = document.getElementById('tx-date').value; const txDate = dateInput ? new Date(dateInput) : new Date();
    let dataToSave = { label: document.getElementById('tx-label').value, type: type, date: txDate };
    if (type === 'transfer') { dataToSave.amount = finalAmount; dataToSave.from_account = document.getElementById('tx-from').value; dataToSave.to_account = document.getElementById('tx-to').value; } else { dataToSave.amount = type === 'expense' ? -finalAmount : finalAmount; dataToSave.account = document.getElementById('tx-account').value; dataToSave.category = document.getElementById('tx-category') ? document.getElementById('tx-category').value : "Autre"; dataToSave.frequency = document.getElementById('tx-frequency') ? document.getElementById('tx-frequency').value : "Ponctuel"; }
    if (txId) { await updateDoc(doc(db, `users/${user.uid}/transactions`, txId), dataToSave); } else { await addDoc(collection(db, `users/${user.uid}/transactions`), dataToSave); }
    closeAndResetModal();
});

document.getElementById('express-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const user = auth.currentUser; if (!user) return;
    const amount = parseFloat(document.getElementById('express-amount').value); if (isNaN(amount) || amount <= 0) return;
    const activeCat = document.querySelector('.express-cat.active'); const cat = activeCat ? activeCat.dataset.cat : 'Autre'; const account = document.getElementById('express-account').value || "Compte Courant"; const now = new Date();
    await addDoc(collection(db, `users/${user.uid}/transactions`), { label: cat, type: 'expense', amount: -Math.abs(amount), account: account, category: cat, frequency: 'Ponctuel', date: new Date(now.getFullYear(), now.getMonth(), now.getDate()) });
    closeAndResetModal();
});

document.getElementById('bourse-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const user = auth.currentUser; if (!user) return;
    const searchVal = document.getElementById('bourse-search').value.trim(); const ticker = (document.getElementById('bourse-ticker').value || searchVal).toUpperCase(); const name = document.getElementById('bourse-name').value || searchVal;
    const tracking = document.getElementById('bourse-tracking').value; const addedQty = parseFloat(document.getElementById('bourse-quantity').value); const addedPrice = parseFloat(document.getElementById('bourse-price').value); const enveloppe = document.getElementById('bourse-enveloppe').value;

    if (!ticker || isNaN(addedQty) || addedQty <= 0 || isNaN(addedPrice) || addedPrice < 0) return alert("Valeurs invalides.");

    const cost = addedQty * addedPrice;
    await setDoc(doc(db, `users/${user.uid}/bourse_settings`, 'cash'), { [enveloppe]: (bourseCash[enveloppe] || 0) - cost }, { merge: true });

    const existingSnap = await getDocs(collection(db, `users/${user.uid}/assets_bourse`)); let matchingDoc = null;
    existingSnap.forEach((d) => { const item = d.data(); if ((item.ticker || '').toUpperCase() === ticker && item.enveloppe === enveloppe) matchingDoc = { id: d.id, ...item }; });

    if (matchingDoc) {
        const oldQty = parseFloat(matchingDoc.quantity) || 0; const oldPru = parseFloat(matchingDoc.price_achat) || 0;
        const totalQty = oldQty + addedQty; const newPru = totalQty > 0 ? ((oldQty * oldPru) + (addedQty * addedPrice)) / totalQty : addedPrice;
        const updatePayload = { quantity: totalQty, price_achat: newPru, nom: matchingDoc.nom || name, tracking: matchingDoc.tracking || tracking };
        if ((matchingDoc.tracking || tracking) === 'manual') updatePayload.prix_actuel = addedPrice;
        await updateDoc(doc(db, `users/${user.uid}/assets_bourse`, matchingDoc.id), updatePayload);
    } else {
        const assetData = { nom: name, ticker: ticker, quantity: addedQty, price_achat: addedPrice, enveloppe: enveloppe, tracking: tracking, date_ajout: serverTimestamp() };
        if (tracking === 'manual') assetData.prix_actuel = addedPrice;
        await addDoc(collection(db, `users/${user.uid}/assets_bourse`), assetData);
    }
    closeAndResetModal();
});

document.getElementById('immo-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const user = auth.currentUser; if (!user) return;
    await addDoc(collection(db, `users/${user.uid}/assets_immo`), { nom: document.getElementById('immo-name').value, type: document.getElementById('immo-type').value, valeur: parseFloat(document.getElementById('immo-value').value), surface: parseFloat(document.getElementById('immo-surface').value) || 0, date_ajout: serverTimestamp() });
    closeAndResetModal();
});

document.addEventListener('click', async (e) => {
    const user = auth.currentUser;
    if (!user) return;

    const btnCash = e.target.closest('.btn-edit-cash');
    if (btnCash) {
        const env = btnCash.dataset.env; 
        const currentVal = bourseCash[env] || 0;
        const newValStr = prompt(`Solde total de vos espèces/fonds euro sur ${env} ?\n(Remplacez par le solde exact de votre banque)`, currentVal);
        if (newValStr !== null && newValStr.trim() !== "") {
            const newVal = parseFloat(newValStr.replace(',', '.'));
            if (!isNaN(newVal)) await setDoc(doc(db, `users/${user.uid}/bourse_settings`, 'cash'), { [env]: newVal }, { merge: true }); 
        }
        return;
    }

    // Le bouton pour corriger la Plus-Value de ton test boursier !
    const btnRealized = e.target.closest('.btn-edit-realized');
    if (btnRealized) {
        const env = btnRealized.dataset.env;
        const currentRealized = bourseCash['realized_' + env] || 0;
        const newValStr = prompt(`Corriger l'historique des gains/pertes pour ${env} ?\n(Mettez 0 pour annuler la trace de votre test)\nActuellement: ${currentRealized} €`, currentRealized);
        if (newValStr !== null && newValStr.trim() !== "") {
            const newVal = parseFloat(newValStr.replace(',', '.'));
            if (!isNaN(newVal)) await setDoc(doc(db, `users/${user.uid}/bourse_settings`, 'cash'), { ['realized_' + env]: newVal }, { merge: true });
        }
        return;
    }

    const btnSell = e.target.closest('.sell-bourse');
    if (btnSell) {
        const docId = btnSell.dataset.id; const maxQty = parseFloat(btnSell.dataset.qty);
        const liveP = parseFloat(btnSell.dataset.liveprice); const pru = parseFloat(btnSell.dataset.pru); const env = btnSell.dataset.env;
        const qtyToSellStr = prompt(`Combien de parts voulez-vous VENDRE ? (L'argent sera ajouté au fond espèces : ${env})\n(Maximum: ${maxQty})`);
        if (qtyToSellStr !== null && qtyToSellStr.trim() !== "") {
            const qtyToSell = parseFloat(qtyToSellStr.replace(',', '.'));
            if (isNaN(qtyToSell) || qtyToSell <= 0 || qtyToSell > maxQty) return alert("Quantité invalide.");
            const cashGagne = qtyToSell * liveP;
            const realizedGagne = qtyToSell * (liveP - pru); 
            await setDoc(doc(db, `users/${user.uid}/bourse_settings`, 'cash'), { 
                [env]: (bourseCash[env] || 0) + cashGagne,
                ['realized_' + env]: (bourseCash['realized_' + env] || 0) + realizedGagne
            }, { merge: true });
            if (qtyToSell === maxQty) await deleteDoc(doc(db, `users/${user.uid}/assets_bourse`, docId));
            else await updateDoc(doc(db, `users/${user.uid}/assets_bourse`, docId), { quantity: maxQty - qtyToSell });
        }
        return;
    }

    const btnDel = e.target.closest('.btn-del-asset');
    if (btnDel) {
        if (confirm("Supprimer définitivement cette ligne ?\n(Ceci est une annulation pure, cela n'ajoutera AUCUN argent à vos espèces).")) {
            await deleteDoc(doc(db, `users/${user.uid}/assets_bourse`, btnDel.dataset.id));
        }
        return;
    }

    const btnEditP = e.target.closest('.btn-edit-price');
    if (btnEditP) {
        const docId = btnEditP.dataset.id; const nom = btnEditP.dataset.name; const oldPrice = parseFloat(btnEditP.dataset.price);
        const newPriceStr = prompt(`Nouveau prix actuel pour ${nom} ? (Prix actuel : ${oldPrice} €)`);
        if (newPriceStr !== null && newPriceStr.trim() !== "") {
            const newPrice = parseFloat(newPriceStr.replace(',', '.'));
            if (!isNaN(newPrice) && newPrice >= 0) await updateDoc(doc(db, `users/${user.uid}/assets_bourse`, docId), { prix_actuel: newPrice }); 
            else alert("Prix invalide.");
        }
        return;
    }

    const btnDelTx = e.target.closest('.btn-del-tx');
    if (btnDelTx) {
        if(confirm("Supprimer cette opération ?")) await deleteDoc(doc(db, `users/${user.uid}/transactions`, btnDelTx.dataset.id));
        return;
    }

    const btnEditTx = e.target.closest('.btn-edit-tx');
    if (btnEditTx) {
        const txData = JSON.parse(decodeURIComponent(btnEditTx.dataset.full));
        document.getElementById('tx-id').value = btnEditTx.dataset.id;
        document.getElementById('tx-label').value = txData.label;
        document.getElementById('tx-amount').value = Math.abs(txData.amount);
        
        // Date parser aussi dans la modification !
        const txDate = parseDate(txData.dateISO);
        document.getElementById('tx-date').value = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}-${String(txDate.getDate()).padStart(2, '0')}`;
        
        const radio = document.getElementById(`type-${txData.type}`);
        if(radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
        if (txData.type === 'transfer') { 
            document.getElementById('tx-from').value = txData.from_account; 
            document.getElementById('tx-to').value = txData.to_account; 
        } else { 
            document.getElementById('tx-account').value = txData.account; 
            document.getElementById('tx-category').value = txData.category || "Autre"; 
            document.getElementById('tx-frequency').value = txData.frequency || "Ponctuel"; 
        }
        document.getElementById('submit-tx').innerText = "Modifier l'opération";
        showModalView(document.getElementById('modal-view-transaction')); 
        document.getElementById('add-modal').classList.remove('hidden');
        return;
    }
});