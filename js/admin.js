/**
 * admin.js - Gestión del Panel de Administración
 * Correcciones: Importación de API, unificación de funciones de inversión y consistencia de datos.
 */

import * as api from './api.js'; // Importamos todo el módulo como 'api'

/**
 * ==========================================
 *   VARIABLES DE ESTADO
 * ==========================================
 */
let state = {
    allCategories: [],
    allProducts: [],
    allPayments: [],
    currentCategoryId: null,
    ordersInterval: null,
    confirmResolver: null
};

/**
 * ==========================================
 *   SISTEMA DE AUTENTICACIÓN
 * ==========================================
 */

window.handleLogin = async () => {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    const btn = document.querySelector('#modal-login .btn-add');
    const errorMsg = document.getElementById('login-error');

    if (!user || !pass) {
        showToast("Por favor, completa todos los campos", "error");
        return;
    }

    try {
        btn.innerText = "Verificando...";
        btn.disabled = true;
        
        const userData = await api.loginAdmin(user, pass);
        
        localStorage.setItem('admin_token', 'active_session');
        localStorage.setItem('admin_role', userData.role); 
        localStorage.setItem('admin_username', userData.username);
        
        showDashboard();
        showToast(`¡Bienvenido ${userData.username}!`, "success");
    } catch (e) {
        errorMsg.style.display = 'block';
        showToast("Credenciales inválidas", "error");
    } finally {
        btn.innerText = "Entrar al Sistema";
        btn.disabled = false;
    }
};

window.handleLogout = () => {
    localStorage.clear();
    location.reload();
};

/**
 * ==========================================
 *   CONTROL DE UI Y MODALES
 * ==========================================
 */

function showDashboard() {
    const role = localStorage.getItem('admin_role');
    const isAdmin = (role === 'admin');

    document.getElementById('modal-login').classList.remove('active');
    document.getElementById('admin-content').style.display = 'block';
    
    // Control de permisos
    const cardReports = document.getElementById('card-reports');
    const cardInvestment = document.getElementById('card-investment');
    
    if (cardReports) cardReports.style.display = isAdmin ? 'block' : 'none';
    if (cardInvestment) cardInvestment.style.display = isAdmin ? 'block' : 'none';
    
    refreshData();
}

window.openModal = async (modalId) => {
    const role = localStorage.getItem('admin_role');

    // Restricción de acceso
    const restricted = ['modal-orders', 'modal-investment'];
    if (restricted.includes(modalId) && role !== 'admin') {
        showToast("Acceso denegado: Solo Administradores", "error");
        return;
    }

    const modal = document.getElementById(modalId);
    if (!modal) return;

    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Lógica de carga según el modal
    switch (modalId) {
        case 'modal-store':
            await refreshData();
            showMainPanel();
            break;
        case 'modal-payments':
            await refreshData();
            break;
        case 'modal-orders':
            await loadOrdersSummary();
            if (state.ordersInterval) clearInterval(state.ordersInterval);
            state.ordersInterval = setInterval(loadOrdersSummary, 15000);
            break;
        case 'modal-investment':
            await renderInvestmentAnalysis();
            break;
    }
};

window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = 'auto';
    
    if (modalId === 'modal-orders' && state.ordersInterval) {
        clearInterval(state.ordersInterval);
        state.ordersInterval = null;
    }
};

/**
 * ==========================================
 *   GESTIÓN DE DATOS (REFRESH)
 * ==========================================
 */

async function refreshData() {
    try {
        const [categories, products, payments] = await Promise.all([
            api.getCategories(), 
            api.getAllProducts(),
            api.getPaymentMethods()
        ]);

        state.allCategories = categories || [];
        state.allProducts = products || [];
        state.allPayments = payments || [];

        renderCategories();
        renderPaymentMethods();
        if (state.currentCategoryId) renderProducts();
    } catch (e) { 
        console.error("Error al sincronizar:", e);
        showToast("Error al sincronizar datos", "error"); 
    }
}

/**
 * ==========================================
 *   MÓDULO: CATEGORÍAS Y PRODUCTOS
 * ==========================================
 */

function renderCategories() {
    const list = document.getElementById('categories-list');
    if (!list) return;

    list.innerHTML = state.allCategories.map(cat => `
        <li class="list-item">
            <div class="item-info">
                <img class="item-img" src="${cat.image_url || 'https://via.placeholder.com/50'}" alt="${cat.name}">
                <p style="font-weight:700;">${cat.name}</p>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-primary-glass" 
                        onclick="showCategoryProducts('${cat.id}', '${cat.name}')">Ver Productos</button>
                <button class="btn btn-delete" onclick="handleDeleteCategory('${cat.id}')">🗑️</button>
            </div>
        </li>
    `).join('');
}

function renderProducts() {
    const list = document.getElementById('products-list');
    if (!list) return;

    const filtered = state.allProducts.filter(p => String(p.category_id) === String(state.currentCategoryId));
    
    list.innerHTML = filtered.map(p => `
        <li class="list-item ${!p.active ? 'is-inactive' : ''}">
            <div class="item-info">
                <img class="item-img" src="${p.image_url || 'https://via.placeholder.com/50'}" onerror="this.src='https://via.placeholder.com/50'">
                <div>
                    <p style="font-weight:700;">${p.name}</p>
                    <p style="color:var(--success); font-weight:700;">$${parseFloat(p.price).toFixed(2)}</p>
                    <span style="color:${p.stock <= 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-size:0.8rem;">
                        📦 Stock: ${p.stock || 0}
                    </span>
                </div>
            </div>
            <div style="display:flex; gap:8px;">
                <button class="btn ${p.active ? 'btn-toggle-on' : 'btn-toggle-off'}" 
                        onclick="handleToggleProductStatus('${p.id}', ${p.active})">
                    ${p.active ? 'Visible' : 'Oculto'}
                </button>
                <button class="btn btn-edit" onclick="openEditProduct('${p.id}')">✏️</button>
                <button class="btn btn-delete" onclick="handleDeleteProduct('${p.id}')">🗑️</button>
            </div>
        </li>
    `).join('');
}

window.handleAddProduct = async () => {
    const nameInp = document.getElementById('new-prod-name');
    const priceInp = document.getElementById('new-prod-price');
    const stockInp = document.getElementById('new-prod-stock');
    const costInp = document.getElementById('new-prod-cost');
    const file = document.getElementById('new-prod-img').files[0];
    
    if (!nameInp.value || !priceInp.value) {
        showToast("Nombre y precio son obligatorios", "error");
        return;
    }

    try {
        let url = file ? await api.uploadImage('products', file) : null;
        await api.createProduct({ 
            name: nameInp.value, 
            price: parseFloat(priceInp.value), 
            stock: parseInt(stockInp.value) || 0, 
            cost: parseFloat(costInp.value) || 0,
            image_url: url, 
            category_id: state.currentCategoryId 
        });

        refreshData();
        showToast("Producto añadido", "success");
        nameInp.value = ""; priceInp.value = ""; stockInp.value = "0"; costInp.value = "";
    } catch (e) { showToast("Error al añadir producto", "error"); }
};

/**
 * ==========================================
 *   GESTIÓN DE PRODUCTOS (CORRECCIONES)
 * ==========================================
 */

window.handleToggleProductStatus = async (id, currentStatus) => {
    try {
        await api.updateProduct(id, { active: !currentStatus });
        await refreshData();
        showToast("Estado actualizado", "success");
    } catch (e) { 
        showToast("Error al cambiar estado", "error"); 
    }
};

window.openEditProduct = (id) => {
    const prod = state.allProducts.find(p => String(p.id) === String(id));
    if (!prod) return;

    document.getElementById('edit-prod-id').value = prod.id;
    document.getElementById('edit-prod-name').value = prod.name;
    document.getElementById('edit-prod-price').value = prod.price;
    document.getElementById('edit-prod-stock').value = prod.stock || 0;
    document.getElementById('edit-prod-cost').value = prod.cost || 0;

    openModal('modal-edit-product');
};

window.handleUpdateProduct = async () => {
    const id = document.getElementById('edit-prod-id').value;
    const name = document.getElementById('edit-prod-name').value;
    const price = parseFloat(document.getElementById('edit-prod-price').value);
    const stock = parseInt(document.getElementById('edit-prod-stock').value);
    const cost = parseFloat(document.getElementById('edit-prod-cost').value);
    const file = document.getElementById('edit-prod-img').files[0];

    try {
        let fields = { name, price, stock, cost };
        if (file) {
            fields.image_url = await api.uploadImage('products', file);
        }
        await api.updateProduct(id, fields);
        closeModal('modal-edit-product');
        await refreshData();
        showToast("Producto actualizado", "success");
    } catch (e) {
        showToast("Error al actualizar", "error");
    }
};

window.handleDeleteProduct = async (id) => {
    const confirm = await customConfirm("¿Eliminar producto?", "Esta acción borrará el producto permanentemente.");
    if (!confirm) return;

    try {
        const prod = state.allProducts.find(p => String(p.id) === String(id));
        await api.deleteProduct(id, prod?.image_url);
        await refreshData();
        showToast("Producto eliminado", "success");
    } catch (e) {
        showToast("Error al eliminar", "error");
    }
};

/**
 * ==========================================
 *   MÓDULO: PAGOS
 * ==========================================
 */

function renderPaymentMethods() {
    const list = document.getElementById('payments-list');
    if (!list) return;

    list.innerHTML = state.allPayments.map(pay => `
        <li class="list-item ${!pay.active ? 'is-inactive' : ''}">
            <div class="item-info">
                <div>
                    <p style="font-weight:700;">${pay.name}</p>
                    <small style="color:var(--text-muted)">
                        ${pay.mode === 'none' ? 'Precio directo' : pay.mode === 'percent' ? `Recargo: ${pay.value}%` : `Tasa: ${pay.value}`}
                    </small>
                </div>
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn ${pay.active ? 'btn-toggle-on' : 'btn-toggle-off'}" 
                        onclick="handleTogglePaymentStatus('${pay.id}', ${pay.active})">
                    ${pay.active ? 'Activo' : 'Inactivo'}
                </button>
                <button class="btn btn-delete" onclick="handleDeletePayment('${pay.id}')">🗑️</button>
            </div>
        </li>
    `).join('');
}

/**
 * ==========================================
 *   MÓDULO: REPORTES Y VENTAS
 * ==========================================
 */

window.loadOrdersSummary = async () => {
    const container = document.getElementById('orders-detailed-list');
    const deductionInput = document.getElementById('setting-deduction');
    
    try {
        const [orders, deductionValue] = await Promise.all([
            api.getOrders(),
            api.getDeductionPercent()
        ]);

        const percentage = parseFloat(deductionValue) || 0;
        if (deductionInput) deductionInput.value = percentage;
        
        let stats = { totalRev: 0, totalProfit: 0, totalTra: 0, totalZelle: 0, totalUsd: 0 };
        
        if (!orders || orders.length === 0) {
            container.innerHTML = `<p style="text-align:center; padding:40px; color:var(--text-muted);">No hay pedidos.</p>`;
            updateStatsUI(stats, 0); 
            return;
        }

        // --- RENDERIZADO DE ÓRDENES ---
        container.innerHTML = orders.map(order => {
            const price = parseFloat(String(order.total_text || "0").replace(/[^0-9.]/g, "")) || 0;
            const method = (order.payment_method || "").toLowerCase();
            const myProfit = price * (percentage / 100);

            const isReceiptMethod = method.includes("zelle") || method.includes("mlc") || method.includes("tra") || method.includes("cup");
            const receiptUrl = order.receipt_url;

            stats.totalRev += price; 
            stats.totalProfit += myProfit; 

            if (method.includes("zelle") || method.includes("mlc")) stats.totalZelle += price;
            else if (method.includes("tra") || method.includes("cup")) stats.totalTra += price;
            else stats.totalUsd += price;

            // Retornamos el HTML de la tarjeta
            return `
                <div class="order-card">
                    <div class="order-header">
                        <span style="font-size: 0.7rem;">ID: ${String(order.id).slice(-5)}</span>
                        <span class="order-total">$${price.toFixed(2)}</span>
                    </div>
                    <p>👤 ${order.customer_name}</p>
                    <div style="display:flex; justify-content:space-between; margin-top:10px; align-items: center;">
                        <span class="badge">💳 ${order.payment_method}</span>
                        <span style="color:var(--accent); font-weight:bold;">+$${myProfit.toFixed(2)}</span>
                    </div>
                    
                    ${isReceiptMethod && receiptUrl ? `
                        <div class="receipt-actions" style="margin-top:15px; display:grid; grid-template-columns: repeat(3, 1fr); gap:5px;">
                            <button class="btn btn-primary-glass" style="font-size:0.65rem; padding:5px;" onclick="window.viewReceipt('${receiptUrl}')">
                                👁️ Ver
                            </button>
                            <button class="btn btn-edit" style="font-size:0.65rem; padding:5px;" onclick="window.downloadReceipt('${receiptUrl}', '${order.id}')">
                                📥 Bajar
                            </button>
                            <button class="btn btn-add" style="font-size:0.65rem; padding:5px; background: #6366f1; color: white;" onclick="window.runOCR('${receiptUrl}', '${order.id}')">
                                🔍 OCR
                            </button>
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');

        updateStatsUI(stats, orders.length);

    } catch (e) {
        console.error("Error al cargar reportes:", e);
        showToast("Error al cargar reportes", "error");
    }
};

function updateStatsUI(stats, count) {
    const mapping = {
        'total-revenue': stats.totalRev,
        'total-tra': stats.totalTra,
        'total-zelle': stats.totalZelle,
        'total-usd': stats.totalUsd,
        'total-net': stats.totalProfit
    };
    
    Object.keys(mapping).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerText = `$${mapping[id].toFixed(2)}`;
    });

    const countEl = document.getElementById('total-orders-count');
    if (countEl) countEl.innerText = count;
}

/**
 * ==========================================
 *   MÓDULO: INVERSIÓN (ANÁLISIS REAL)
 * ==========================================
 */
async function renderInvestmentAnalysis() {
    try {
        const [products, orders, deductionValue] = await Promise.all([
            api.getAllProducts(),
            api.getOrders(),
            api.getDeductionPercent()
        ]);

        const tableBody = document.getElementById('investment-products-list');
        const percentage = parseFloat(deductionValue) || 0;
        
        let globalInvTotal = 0;
        let globalGananciaPotencial = 0;
        let totalRevenuePotencial = 0;
        let globalRealProfit = 0;

        const completedOrders = orders.filter(o => o.status === 'completed');
        completedOrders.forEach(order => {
            const price = parseFloat(String(order.total_text || "0").replace(/[^0-9.]/g, "")) || 0;
            globalRealProfit += (price * (percentage / 100));
        });

        tableBody.innerHTML = '';
        products.forEach(p => {
            const costo = parseFloat(p.cost || 0);
            const precioVenta = parseFloat(p.price || 0);
            const stock = parseInt(p.stock || 0);

            const invTotalProducto = costo * stock;
            const gananciaUnitaria = precioVenta - costo;
            const gananciaTotalProducto = gananciaUnitaria * stock;
            const ventaTotalProducto = precioVenta * stock;
            
            globalInvTotal += invTotalProducto;
            globalGananciaPotencial += gananciaTotalProducto;
            totalRevenuePotencial += ventaTotalProducto;

            const margenProducto = costo > 0 ? (gananciaUnitaria / costo) * 100 : 0;

            tableBody.innerHTML += `
                <tr style="border-bottom: 1px solid var(--glass-border); font-size: 0.85rem;">
                    <td style="padding:12px; font-weight:500;">${p.name}</td>
                    <td style="padding:12px;">$${costo.toFixed(2)}</td>
                    <td style="padding:12px;">$${precioVenta.toFixed(2)}</td>
                    <td style="padding:12px; text-align:center;">${stock}</td>
                    <td style="padding:12px; color:#ef4444;">$${invTotalProducto.toFixed(2)}</td>
                    <td style="padding:12px; color:#10b981;">$${gananciaTotalProducto.toFixed(2)}</td>
                    <td style="padding:12px; color:var(--accent);">${margenProducto.toFixed(2)}%</td>
                </tr>
            `;
        });

        const deficit = globalInvTotal - globalRealProfit;
        const breakEvenStatusEl = document.getElementById('break-even-status');
        const progressEl = document.getElementById('recovery-progress');
        
        const avgMarginDecimal = totalRevenuePotencial > 0 ? (globalGananciaPotencial / totalRevenuePotencial) : 0;
        const totalStockUnits = products.reduce((a, b) => a + (b.stock || 0), 0);
        const avgPrice = totalStockUnits > 0 ? (totalRevenuePotencial / totalStockUnits) : 0;
        const avgProfitPerUnit = avgPrice * avgMarginDecimal;

        if (deficit <= 0) {
            breakEvenStatusEl.innerHTML = `<span style="color:#10b981;">✅ INVERSIÓN RECUPERADA</span>`;
            progressEl.value = 100;
        } else {
            const ventasFaltantes = avgProfitPerUnit > 0 ? Math.ceil(deficit / avgProfitPerUnit) : '---';
            const porcentajeRecuperado = (globalRealProfit / globalInvTotal) * 100;
            
            breakEvenStatusEl.innerHTML = `
                <span style="color:#ef4444;">Faltan ~$${deficit.toFixed(2)}</span>
                <div style="font-size:0.7rem; color:var(--text-muted); font-weight:400;">
                    Aprox. ${ventasFaltantes} ventas más
                </div>
            `;
            progressEl.value = porcentajeRecuperado;
        }

        const format = (val) => `$${val.toLocaleString('en-US', {minimumFractionDigits: 2})}`;
        document.getElementById('total-investment').innerText = format(globalInvTotal);
        document.getElementById('total-profit').innerText = format(globalGananciaPotencial);
        document.getElementById('total-real-profit').innerText = format(globalRealProfit);

    } catch (error) {
        console.error("Error en análisis financiero:", error);
        showToast('Error al calcular finanzas', 'error');
    }
}

/**
 * ==========================================
 *   UTILIDADES Y NAVEGACIÓN
 * ==========================================
 */

window.showToast = (msg, type = 'info') => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

window.customConfirm = (title, text) => {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerText = text;
    document.getElementById('modal-confirm').classList.add('active');
    return new Promise(resolve => { state.confirmResolver = resolve; });
};

window.closeConfirm = (val) => {
    document.getElementById('modal-confirm').classList.remove('active');
    if (state.confirmResolver) state.confirmResolver(val);
};

window.showCategoryProducts = (id, name) => {
    state.currentCategoryId = id;
    document.getElementById('section-categories').classList.add('hidden');
    document.getElementById('section-products').classList.remove('hidden');
    document.getElementById('current-cat-title').innerText = `📦 ${name}`;
    renderProducts();
};

window.showMainPanel = () => {
    state.currentCategoryId = null;
    document.getElementById('section-products').classList.add('hidden');
    document.getElementById('section-categories').classList.remove('hidden');
};

document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('admin_token') === 'active_session') {
        showDashboard();
    }
});

window.handleAddCategory = async () => {
    const name = document.getElementById('new-cat-name').value;
    const file = document.getElementById('new-cat-img').files[0];
    if (!name) return showToast("Nombre requerido", "error");

    try {
        const url = file ? await api.uploadImage('categories', file) : null;
        await api.createCategory(name, url);
        document.getElementById('new-cat-name').value = "";
        refreshData();
        showToast("Categoría creada", "success");
    } catch (e) { showToast("Error al crear categoría", "error"); }
};

window.handleDeleteCategory = async (id) => {
    const confirm = await customConfirm("¿Eliminar categoría?", "Se borrarán también los productos asociados.");
    if (!confirm) return;
    try {
        const cat = state.allCategories.find(c => String(c.id) === String(id));
        await api.deleteCategory(id, cat?.image_url);
        refreshData();
        showToast("Categoría eliminada", "success");
    } catch (e) { showToast("Error al eliminar", "error"); }
};

window.saveDeductionSetting = async (val) => {
    try {
        await api.updateDeductionPercent(parseFloat(val));
        loadOrdersSummary();
        showToast("Comisión actualizada", "success");
    } catch (e) { showToast("Error al guardar configuración", "error"); }
};

window.handleClearAllOrders = async () => {
    const ok = await customConfirm("¿Vaciar historial?", "Se borrarán todos los pedidos y fotos de comprobantes.");
    if (!ok) return;
    try {
        await api.deleteAllOrdersData();
        loadOrdersSummary();
        showToast("Historial vaciado", "success");
    } catch (e) { showToast("Error al vaciar", "error"); }
};

/**
 * ==========================================
 *   UTILIDADES DE COMPROBANTES
 * ==========================================
 */

window.viewReceipt = (url) => {
    window.open(url, '_blank');
};

window.downloadReceipt = async (url, orderId) => {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `comprobante_orden_${String(orderId).slice(-5)}.jpg`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(blobUrl);
    } catch (e) {
        showToast("Error al descargar la imagen", "error");
    }
};

window.runOCR = async (imageUrl, orderId) => {
    // Verificamos si la librería está cargada
    if (typeof Tesseract === 'undefined') {
        showToast("Error: Librería OCR no cargada", "error");
        return;
    }

    showToast("⏳ Analizando imagen...", "info");

    try {
        const worker = await Tesseract.createWorker('spa'); // Idioma español
        const ret = await worker.recognize(imageUrl);
        const text = ret.data.text;
        await worker.terminate();

        console.log("Texto extraído de orden " + orderId + ":", text);

        // Intentar buscar un número de referencia (ejemplo 6 a 12 dígitos)
        const refMatch = text.match(/\b\d{6,12}\b/);
        const referencia = refMatch ? refMatch[0] : "No encontrada";

        // Mostrar resultado
        alert(`--- Análisis OCR ---\nID Orden: ${orderId.slice(-5)}\nReferencia detectada: ${referencia}\n\nTexto completo:\n${text.substring(0, 300)}...`);
        
    } catch (error) {
        console.error("Error OCR:", error);
        showToast("No se pudo leer la imagen", "error");
    }
};

window.handleApplyMassPriceUpdate = async () => {
    const type = document.getElementById('mass-adj-type').value;
    const percentInput = document.getElementById('mass-adj-percent').value;
    const percentage = parseFloat(percentInput);

    if (!percentage || percentage <= 0) {
        showToast("Ingresa un porcentaje válido", "error");
        return;
    }

    // Si es disminución, el porcentaje debe ser negativo para la fórmula
    const finalPercentage = type === 'decrease' ? (percentage * -1) : percentage;

    // Confirmación de seguridad
    const confirmText = type === 'increase' ? `aumentar un ${percentage}%` : `disminuir un ${percentage}%`;
    const ok = await customConfirm(
        "¿Confirmar cambio masivo?", 
        `Se va a ${confirmText} el precio de TODOS los productos en esta categoría. Esta acción es irreversible.`
    );

    if (!ok) return;

    try {
        const btn = document.querySelector('#modal-mass-prices .btn-add');
        const originalText = btn.innerText;
        btn.innerText = "Procesando...";
        btn.disabled = true;

        await api.updatePricesByCategory(state.currentCategoryId, finalPercentage);

        showToast("Precios actualizados correctamente", "success");
        closeModal('modal-mass-prices');
        
        // Limpiar input y recargar datos
        document.getElementById('mass-adj-percent').value = "";
        await refreshData(); 
        
    } catch (e) {
        console.error(e);
        showToast("Error al actualizar precios", "error");
    } finally {
        const btn = document.querySelector('#modal-mass-prices .btn-add');
        btn.innerText = "Aplicar Cambio Masivo";
        btn.disabled = false;
    }
};