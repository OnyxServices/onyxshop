/**
 * index.js - Lógica Principal de Onyx Shop
 * Organizado por módulos: Estado, Datos, UI, Carrito, Pagos y Utilidades.
 */

import { 
  getCategories, 
  getAllProducts, 
  getPaymentMethods, 
  createOrderInSupabase, 
  uploadReceiptToSupabase,
  subtractProductStock 
} from './api.js';

// ==========================================
// 1. ESTADO GLOBAL Y CONFIGURACIÓN
// ==========================================

let DB = { 
  categories: [], 
  products: [], 
  paymentMethods: [] 
};

let AppState = {
  cart: [],
  knownProductIds: new Set(),
  currentCurrency: "$", // Código de moneda actual ($, CUP, MLC, etc)
  currentView: { type: 'categories', catId: null, catName: null },
  filteredProducts: [],
  pagination: {
    itemsPerPage: 8,
    currentPage: 1
  },
  files: {
    zelle: null,
    tra: null,
    mlc: null
  }
};

const SOUNDS = {
  notification: new Audio('https://onyxservices.github.io/onyxshop/sound/new.mp3')
};

// ==========================================
// 2. ANALÍTICA Y NOTIFICACIONES
// ==========================================

/**
 * Registra el evento de visualización de lista en Google Analytics.
 */
function trackCategoryView(categoryName, products) {
  if (typeof gtag !== "function" || !products?.length) return;

  gtag('event', 'view_item_list', {
    item_list_name: categoryName,
    items: products.slice(0, 20).map(p => ({
      item_id: String(p.id),
      item_name: p.name,
      item_category: categoryName,
      price: p.price, 
      currency: AppState.currentCurrency === '$' ? 'USD' : 'CUP'
    }))
  });
  console.log('[GA4] Evento view_item_list enviado:', categoryName);
}

/**
 * Muestra una notificación visual y sonora de producto nuevo.
 */
function notifyNewProduct(categoryName) {
  SOUNDS.notification.currentTime = 0;
  SOUNDS.notification.play().catch(() => console.warn("Esperando interacción para audio"));

  const notif = document.createElement('div');
  notif.className = 'product-notification';
  notif.innerHTML = `
    <div class="product-notif-icon"><i data-lucide="sparkles"></i></div>
    <div>
      <div style="font-size: 0.7rem; opacity: 0.8; text-transform: uppercase;">¡Recién llegado!</div>
      <div style="font-size: 0.9rem;">Nuevo producto en ${categoryName} 🏃🏽</div>
    </div>
  `;
  document.body.appendChild(notif);
  lucide.createIcons();

  setTimeout(() => notif.classList.add('active'), 100);
  setTimeout(() => {
    notif.classList.remove('active');
    setTimeout(() => notif.remove(), 600);
  }, 8000);
}

function showToast(message) {
  // Intentar usar toast-root si existe, si no, al body
  const container = document.getElementById('toast-root') || document.body;
  const toast = document.createElement('div');
  toast.className = 'toast-message'; 
  toast.innerHTML = message;
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 100);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 500);
  }, 3000);
}

/**
 * Muestra un error visual
 */
function showTopError(message) {
  showToast(`❌ ${message}`);
}

// ==========================================
// 3. GESTIÓN DE DATOS (API & SYNC)
// ==========================================

/**
 * Refresca todos los datos desde Supabase y gestiona novedades.
 * @param {boolean} isFirstLoad - Indica si es la carga inicial de la app.
 */
async function refreshData(isFirstLoad = false) {
  try {
    const [categories, products, payments] = await Promise.all([
      getCategories(),
      getAllProducts(),
      getPaymentMethods()
    ]);

    // Detección de productos nuevos (solo si no es la primera carga)
    if (!isFirstLoad && products?.length > 0) {
      products.forEach(prod => {
        if (!AppState.knownProductIds.has(String(prod.id))) {
          const cat = categories.find(c => String(c.id) === String(prod.category_id));
          notifyNewProduct(cat ? cat.name : "una categoría");
        }
      });
    }

    // Actualización del Estado
    AppState.knownProductIds = new Set(products.map(p => String(p.id)));
    DB.categories = categories || [];
    DB.products = products || [];
    DB.paymentMethods = payments || [];

    // Actualizar UI
    renderPaymentSelector();
    if (AppState.currentView.type === 'categories') {
      renderCategories();
    } else {
      updateFilteredProducts();
      softRefreshProductGrid();
    }
  } catch (err) {
    console.error("Error al refrescar datos:", err);
  }
}

/**
 * Inicia el ciclo de sincronización en segundo plano.
 */
function startSyncTimers() {
  // Sincronización general cada 15s
  setInterval(() => refreshData(false), 15000);
}

// ==========================================
// 4. LÓGICA DE PRECIOS Y MONEDA
// ==========================================

/**
 * Calcula el precio final basado en el método de pago seleccionado.
 */
function getCalculatedPrice(basePrice) {
  const method = DB.paymentMethods.find(m => m.code === AppState.currentCurrency) || 
                 { name: "Efectivo", mode: "none", value: 1, code: "$" };
  
  let final = parseFloat(basePrice);
  const prefix = method.code === "$" ? "$" : `${method.code} `;

  if (method.mode === 'percent') final *= (1 + (method.value / 100));
  else if (method.mode === 'divide') final /= method.value;

  return { 
    text: `${prefix}${final.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 
    methodName: method.name,
    raw: final
  };
}

/**
 * Renderiza el selector de moneda basado en los métodos activos.
 */
function renderPaymentSelector() {
  const sel = document.getElementById('payment-selector');
  if (!sel) return;

  const activeMethods = DB.paymentMethods.filter(m => m.active);
  sel.innerHTML = activeMethods.map(m =>
    `<option value="${m.code}" ${m.code === AppState.currentCurrency ? 'selected' : ''}>${m.name}</option>`
  ).join('');
}

// ==========================================
// 5. RENDERIZADO DE UI (VISTAS)
// ==========================================

/**
 * Muestra la vista de categorías.
 */
window.showCategories = () => {
  AppState.currentView = { type: 'categories', catId: null, catName: null };
  document.getElementById('products-view').style.display = 'none';
  document.getElementById('categories-view').style.display = 'block';
  renderCategories();
};

/**
 * Muestra la vista de productos de una categoría específica.
 */
window.showProducts = (catId, catName) => {
  AppState.currentView = { type: 'products', catId, catName };
  document.getElementById('categories-view').style.display = 'none';
  document.getElementById('products-view').style.display = 'block';
  document.getElementById('current-cat-name').innerText = catName;

  AppState.pagination.currentPage = 1;
  updateFilteredProducts();
  
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';
  
  trackCategoryView(catName, AppState.filteredProducts);
  renderNextChunk();
  window.scrollTo(0, 0);
};

function updateFilteredProducts() {
  AppState.filteredProducts = DB.products.filter(p => 
    String(p.category_id) === String(AppState.currentView.catId) && p.active
  );
}

function renderCategories() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  grid.innerHTML = DB.categories.map(cat => `
    <div class="card" onclick="showProducts('${cat.id}', '${cat.name}')" style="cursor:pointer">
      <div class="card-media"><img src="${cat.image_url || 'https://picsum.photos/300'}" loading="lazy"></div>
      <div class="card-body" style="text-align:center;">
        <div class="card-title" style="height:auto; font-size:0.9rem; font-weight:700;">${cat.name}</div>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

/**
 * Carga el siguiente bloque de productos (Infinite Scroll).
 */
function renderNextChunk() {
  const grid = document.getElementById('products-grid');
  const sentinel = document.getElementById('infinite-sentinel');
  const { currentPage, itemsPerPage } = AppState.pagination;

  const start = (currentPage - 1) * itemsPerPage;
  const chunk = AppState.filteredProducts.slice(start, start + itemsPerPage);

  if (chunk.length === 0) {
    sentinel.classList.remove('active');
    return;
  }

  sentinel.classList.add('active');
  grid.insertAdjacentHTML('beforeend', chunk.map(p => productCardHTML(p)).join(''));
  lucide.createIcons();
  AppState.pagination.currentPage++;

  if (start + itemsPerPage >= AppState.filteredProducts.length) sentinel.classList.remove('active');
}

/**
 * Refresca la vista de productos actual sin reiniciar el scroll.
 */
function softRefreshProductGrid() {
  const grid = document.getElementById('products-grid');
  if (!grid || AppState.currentView.type !== 'products') return;
  
  const limit = (AppState.pagination.currentPage - 1) * AppState.pagination.itemsPerPage;
  const visibleItems = AppState.filteredProducts.slice(0, Math.max(limit, AppState.pagination.itemsPerPage));
  grid.innerHTML = visibleItems.map(p => productCardHTML(p)).join('');
  lucide.createIcons();
}

/**
 * Genera el HTML de una tarjeta de producto.
 */
function productCardHTML(p) {
  const priceObj = getCalculatedPrice(p.price);
  const isNew = (new Date() - new Date(p.created_at)) / (1000 * 60 * 60) <= 12;
  const outOfStock = p.stock <= 0;
  
  let stockBadge = outOfStock 
    ? `<span class="stock-badge oos">Agotado</span>` 
    : (p.stock <= 5 ? `<span class="stock-badge low">¡Solo ${p.stock}!</span>` : `<span class="stock-badge in-stock">${p.stock} disponibles</span>`);

  return `
    <div class="card" style="${outOfStock ? 'opacity: 0.8;' : ''}">
      <div class="card-media">
        ${isNew ? '<div class="ribbon-wrapper"><div class="ribbon-new">NUEVO</div></div>' : ''} 
        <img src="${p.image_url || 'https://picsum.photos/300'}" loading="lazy" style="${outOfStock ? 'filter: grayscale(1);' : ''}">
        ${outOfStock ? '<div class="sold-out-overlay">AGOTADO</div>' : ''}
      </div>
      <div class="card-body">
        <div class="card-header-info">
          <div class="card-title">${p.name}</div>
          ${stockBadge}
        </div>
        <div class="card-price">${priceObj.text}</div>
        <button class="btn-action" ${outOfStock ? 'disabled' : `onclick="addToCart('${p.id}', event)"`}>
          <i data-lucide="${outOfStock ? 'slash' : 'shopping-cart'}" style="width:14px"></i> 
          ${outOfStock ? 'SIN STOCK' : 'AGREGAR'}
        </button>
      </div>
    </div>
  `;
}

// ==========================================
// 6. GESTIÓN DEL CARRITO
// ==========================================

window.addToCart = (id, event) => {
  const product = DB.products.find(p => String(p.id) === String(id));
  if (!product || product.stock <= 0) return;

  const existing = AppState.cart.find(item => String(item.id) === String(id));
  if (existing) {
    if (existing.qty >= product.stock) return showTopError("Stock máximo alcanzado");
    existing.qty++;
  } else {
    AppState.cart.push({ ...product, qty: 1 });
  }

  playCartAnimation(event);
  saveAndRefreshCart();
  showToast("✅ Producto añadido");
};

window.updateQty = (index, delta) => {
  const item = AppState.cart[index];
  const prod = DB.products.find(p => String(p.id) === String(item.id));

  if (delta > 0 && item.qty >= prod.stock) return showTopError("Límite de stock alcanzado");
  
  item.qty += delta;
  if (item.qty <= 0) AppState.cart.splice(index, 1);
  saveAndRefreshCart();
};

window.removeFromCart = (index) => {
  AppState.cart.splice(index, 1);
  saveAndRefreshCart();
};

function saveAndRefreshCart() {
  localStorage.setItem('cuban_store_cart', JSON.stringify(AppState.cart));
  updateCartUI();
}

function updateCartUI() {
  const list = document.getElementById('cart-list');
  const totalEl = document.getElementById('cart-total');
  const countEl = document.getElementById('cart-count');
  
  if (AppState.cart.length === 0) {
    list.innerHTML = `<p class="empty-msg">Tu carrito está vacío</p>`;
    totalEl.innerText = "$0.00";
    countEl.innerText = "0";
    return;
  }

  let totalBase = 0;
  list.innerHTML = AppState.cart.map((item, i) => {
    const live = DB.products.find(p => String(p.id) === String(item.id)) || item;
    totalBase += (parseFloat(live.price) * item.qty);
    const pObj = getCalculatedPrice(live.price);

    return `
      <div class="cart-item">
        <img src="${live.image_url}" class="cart-img">
        <div class="cart-item-info">
          <h4>${live.name}</h4>
          <span class="price-tag">${pObj.text}</span>
          <div class="qty-controls">
            <button onclick="updateQty(${i}, -1)"><i data-lucide="minus"></i></button>
            <span>${item.qty}</span>
            <button onclick="updateQty(${i}, 1)"><i data-lucide="plus"></i></button>
          </div>
        </div>
        <button class="delete-btn" onclick="removeFromCart(${i})"><i data-lucide="trash-2"></i></button>
      </div>
    `;
  }).join('');

  totalEl.innerText = getCalculatedPrice(totalBase).text;
  countEl.innerText = AppState.cart.reduce((acc, curr) => acc + curr.qty, 0);
  lucide.createIcons();
}

// ==========================================
// 7. PROCESO DE PAGO Y FINALIZACIÓN
// ==========================================

/**
 * Valida stock y lo descuenta de Supabase antes de finalizar.
 */
async function validateAndSubtractStock() {
  if (AppState.cart.length === 0) return false;
  try {
    await Promise.all(AppState.cart.map(item => subtractProductStock(item.id, item.qty)));
    return true;
  } catch (err) {
    console.error("Error stock:", err);
    return false;
  }
}

/**
 * Función central de envío de orden.
 */
window.sendOrder = async () => {
  const form = {
    name: document.getElementById('order-name'),
    phone: document.getElementById('order-phone'),
    address: document.getElementById('order-address'),
    ref: document.getElementById('order-reference')
  };

  // Validación básica
  let isValid = true;
  if (form.name.value.trim().length < 3) { form.name.classList.add('invalid'); isValid = false; }
  if (!/^[56]\d{7}$/.test(form.phone.value.trim())) { form.phone.classList.add('invalid'); isValid = false; }
  if (form.address.value.trim().length < 5) { form.address.classList.add('invalid'); isValid = false; }

  if (!isValid) return showTopError("Revisa los datos del formulario");

  // Flujo según moneda
  const currency = AppState.currentCurrency;
  if (currency === 'Z') return openPaymentModal('zelle');
  if (currency === 'Tra') return openPaymentModal('tra');
  if (currency === 'mlc') return openPaymentModal('mlc');

  // Pago en Efectivo / Estándar
  await processStandardOrder(form);
};

async function processStandardOrder(form) {
  showToast("⏳ Procesando pedido...");
  const stockOk = await validateAndSubtractStock();
  if (!stockOk) return showTopError("Se agotó el stock de un producto");

  const orderId = `CS-EF-${Date.now().toString().slice(-6)}`;
  const totalBase = AppState.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const totalObj = getCalculatedPrice(totalBase);

  try {
    await createOrderInSupabase({
      order_id: orderId,
      customer_name: form.name.value,
      phone: form.phone.value,
      address: form.address.value,
      reference: form.ref.value,
      items: AppState.cart,
      total_text: totalObj.text,
      payment_method: totalObj.methodName,
      status: 'completed'
    });

    // Pasamos el objeto del formulario y el nombre del método de pago
    const waText = formatWhatsAppMessage(orderId, form, totalObj.text, totalObj.methodName);
    const waUrl = `https://wa.me/+5353910527?text=${encodeURIComponent(waText)}`;
    
    window.open(waUrl, '_blank');
    finalizeOrder();

  } catch (e) {
    console.error(e);
    showTopError("Error al registrar pedido");
  }
}

// ==========================================
// 8. MODALES DE PAGO (ZELLE, MLC, TRANSFERENCIA)
// ==========================================

function openPaymentModal(type) {
  toggleCart(false);
  const totalBase = AppState.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
  const totalObj = getCalculatedPrice(totalBase);

  // Actualizar resumen en el modal correspondiente
  document.getElementById(`${type}-summary-total`).textContent = totalObj.text;
  document.getElementById(`${type}-summary-items`).textContent = AppState.cart.length;

  // Resetear el input y mostrar
  resetModalState(type);
  document.getElementById(`${type}-overlay`).classList.add('active');
  lucide.createIcons();
}

function resetModalState(type) {
  AppState.files[type] = null;
  document.getElementById(`${type}-preview-container`).style.display = 'none';
  document.getElementById(`${type}-receipt-file`).value = '';
  document.getElementById(`confirm-${type}-btn`).disabled = true;
}

window.handleReceiptInput = (type, event) => {
  const file = event.target.files[0];
  if (!file) return;

  AppState.files[type] = file;
  const preview = document.getElementById(`${type}-preview`);
  preview.src = URL.createObjectURL(file);
  document.getElementById(`${type}-preview-container`).style.display = 'block';
  document.getElementById(`confirm-${type}-btn`).disabled = false;
};

/**
 * Confirmación genérica para pagos con comprobante.
 */
window.toggleZelleModal = (open) => open ? openPaymentModal('zelle') : closeModal('zelle-overlay');
window.toggleTraModal = (open) => open ? openPaymentModal('tra') : closeModal('tra-overlay');
window.toggleMlcModal = (open) => open ? openPaymentModal('mlc') : closeModal('mlc-overlay');
window.toggleCoffeeModal = (open) => open ? document.getElementById('coffee-overlay').classList.add('active') : closeModal('coffee-overlay');

window.confirmReceiptPayment = async (type) => {
  const file = AppState.files[type];
  const btn = document.getElementById(`confirm-${type}-btn`);
  const loader = document.getElementById(`${type}-upload-progress`);

  const form = {
    name: document.getElementById('order-name'),
    phone: document.getElementById('order-phone'),
    address: document.getElementById('order-address'),
    ref: document.getElementById('order-reference')
  };

  btn.disabled = true;
  if(loader) loader.style.display = 'block';

  try {
    const stockOk = await validateAndSubtractStock();
    if (!stockOk) throw new Error("Stock insuficiente");

    const orderId = `CS-${type.toUpperCase()}-${Date.now().toString().slice(-6)}`;
    const uploadedUrl = await uploadReceiptToSupabase(file, orderId);
    
    const totalBase = AppState.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
    const totalObj = getCalculatedPrice(totalBase);

    await createOrderInSupabase({
      order_id: orderId,
      customer_name: form.name.value,
      phone: form.phone.value,
      address: form.address.value,
      reference: form.ref.value,
      items: AppState.cart,
      total_text: totalObj.text,
      payment_method: type.toUpperCase(),
      receipt_url: uploadedUrl,
      status: 'pending'
    });

    const bodyText = formatWhatsAppMessage(orderId, form, totalObj.text, type.toUpperCase());
    const waText = `🖼️ *PAGO CON COMPROBANTE*\n\n${bodyText}\n\n🔗 *Recibo:* ${uploadedUrl}`;
    
    window.location.href = `https://wa.me/+5353910527?text=${encodeURIComponent(waText)}`;

    finalizeOrder();
    closeModal(`${type}-overlay`);
  } catch (e) {
    showTopError(e.message);
    btn.disabled = false;
    if(loader) loader.style.display = 'none';
  }
};

// ==========================================
// 9. UTILIDADES Y ANIMACIONES
// ==========================================

function playCartAnimation(event) {
  SOUNDS.notification.currentTime = 0;
  SOUNDS.notification.play().catch(() => {});

  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();
  const cartBtn = document.getElementById('cart-btn-anchor').getBoundingClientRect();

  const flyer = document.createElement('div');
  flyer.className = 'flying-icon';
  flyer.innerHTML = '<i data-lucide="shopping-cart"></i>';
  flyer.style.left = `${rect.left + rect.width / 2}px`;
  flyer.style.top = `${rect.top + rect.height / 2}px`;
  document.body.appendChild(flyer);
  lucide.createIcons();

  requestAnimationFrame(() => {
    flyer.style.left = `${cartBtn.left + cartBtn.width / 2}px`;
    flyer.style.top = `${cartBtn.top + cartBtn.height / 2}px`;
    flyer.style.transform = 'scale(0.3) rotate(360deg)';
    flyer.style.opacity = '0';
  });

  setTimeout(() => flyer.remove(), 800);
}

function finalizeOrder() {
  AppState.cart = [];
  saveAndRefreshCart();
  document.querySelectorAll('.cart-form input').forEach(i => i.value = '');
  toggleCart(false);
  showToast("¡Pedido procesado con éxito!");
}

function formatWhatsAppMessage(orderId, form, totalText, paymentMethod = "Efectivo") {
  const items = AppState.cart.map(i => `┃ 📦 *${i.qty}x* ${i.name}`).join('\n');
  const date = new Date().toLocaleDateString();

  return `✨ *NUEVA ORDEN - ONYX SHOP* ✨
┏━━━━━━━━━━━━━━━━━━━━━┓
┃ 🆔 *ID:* #${orderId}
┃ 📅 *FECHA:* ${date}
┃ 💳 *PAGO:* ${paymentMethod}
┗━━━━━━━━━━━━━━━━━━━━━┛

👤 *DATOS DEL CLIENTE*
┃ *Nombre:* ${form.name.value.trim()}
┃ *Teléfono:* +53 ${form.phone.value.trim()}

📍 *ENTREGA*
┃ *Dirección:* ${form.address.value.trim()}
┃ *Referencia:* ${form.ref.value.trim() || 'No especificada'}

🛍️ *PRODUCTOS SELECCIONADOS*
${items}

──────────────────────
💰 *TOTAL A PAGAR:* *${totalText}*
──────────────────────

🚀 _Por favor, confirme que ha recibido este pedido para comenzar a procesarlo._`;
}

// Globales para HTML
window.toggleCart = (open) => document.getElementById('cart-overlay').classList.toggle('active', open);
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

// ==========================================
// 10. INICIALIZACIÓN
// ==========================================

async function init() {
  // Cargar carrito local
  const saved = localStorage.getItem('cuban_store_cart');
  if (saved) AppState.cart = JSON.parse(saved);

  // UI Inicial
  lucide.createIcons();
  updateCartUI();
  
  // Listener de Moneda
  document.getElementById('payment-selector')?.addEventListener('change', (e) => {
    AppState.currentCurrency = e.target.value;
    softRefreshProductGrid();
    updateCartUI();
  });


  // ==========================================
// 11. INTEGRACIÓN CON KODULAR / APP INVENTOR
// ==========================================

/**
 * Gestiona el botón atrás físico del teléfono.
 */
window.onBackPressed = function() {
  // 1. Si el carrito está abierto, cerrarlo
  if (document.getElementById('cart-overlay').classList.contains('active')) {
    toggleCart(false);
    return;
  }

  // 2. Si hay algún modal de pago abierto, cerrarlo
  const overlays = ['zelle-overlay', 'mlc-overlay', 'tra-overlay', 'coffee-overlay'];
  for (let id of overlays) {
    const el = document.getElementById(id);
    if (el && el.classList.contains('active')) {
      el.classList.remove('active');
      return;
    }
  }

  // 3. Si estamos viendo productos, volver a categorías
  if (AppState.currentView.type === 'products') {
    window.showCategories();
    return;
  }

  // 4. Si estamos en el home (categorías), enviar señal de salida a Kodular
  if (window.AppInventor) {
    window.AppInventor.setWebViewString("salir");
  }
};

/**
 * Abre la app de SMS o envía el comando a Kodular.
 */
window.openSmsApp = (phone) => {
  if (window.AppInventor) {
    // Señal para que Kodular use el componente SMS interno
    window.AppInventor.setWebViewString("SMS:" + phone);
  } else {
    // Navegador estándar
    window.location.href = "sms:+53" + phone;
  }
};

/**
 * Copia texto al portapapeles con soporte para WebView antiguos.
 */
window.copyToClipboard = function(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text)
      .then(() => showToast("✅ ¡Copiado!"))
      .catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
};

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast("✅ ¡Copiado!");
  } catch (e) {
    showTopError("Error al copiar");
  }
  document.body.removeChild(ta);
}

/**
 * Menú de soporte flotante
 */
window.toggleSupportMenu = (e) => {
  if (e) e.stopPropagation();
  const menu = document.getElementById('support-menu');
  if (menu) {
    menu.classList.toggle('active');
    if (menu.classList.contains('active')) lucide.createIcons();
  }
};

// Cerrar menús al tocar fuera
document.addEventListener('click', () => {
  const menu = document.getElementById('support-menu');
  if (menu) menu.classList.remove('active');
});

  // Carga de Datos
  const splash = document.getElementById('splash-screen');
  try {
    await refreshData(true);
  } finally {
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.style.display = 'none', 500);
    }
  }

  // Infinite Scroll Observer
  const sentinel = document.getElementById('infinite-sentinel');
  if (sentinel) {
    new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && AppState.currentView.type === 'products') renderNextChunk();
    }).observe(sentinel);
  }

  startSyncTimers();
}

document.addEventListener('DOMContentLoaded', init);