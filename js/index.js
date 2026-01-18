import { 
  getCategories, 
  getAllProducts, 
  getPaymentMethods, 
  createOrderInSupabase, 
  uploadReceiptToSupabase
} from './api.js';

// --- ESTADO GLOBAL ---
let DB = { categories: [], products: [], paymentMethods: [] };
let knownProductIds = new Set(); 
let cart = [];
let currentPaymentMethodCode = "$"; 
let currentView = { type: 'categories', catId: null, catName: null };
let filteredProducts = [];
let itemsPerPage = 8;
let currentPage = 1;
let observer = null;
let zelleReceiptFile = null;
let zelleReceiptUrl = null;
let traReceiptFile = null;
let mlcReceiptFile = null;
let currentZelleOrderData = null;

//          --- Funciones de Google Analitic---

function trackCategoryView(categoryName, products) {
  if (typeof gtag !== "function") return;
  if (!categoryName || !products || products.length === 0) return;

 gtag('event', 'view_item_list', {
  item_list_name: categoryName,
  items: products ? products.slice(0, 20).map(p => ({ // Añade validación aquí
    item_id: String(p.id),
    item_name: p.name,
    item_category: categoryName,
    // Sugerencia extra: Añade el precio si lo tienes
    price: p.price, 
    currency: currentPaymentMethodCode === '$' ? 'USD' : 'CUP' // O la moneda por defecto
  })) : []
});

  console.log('[GA4] Vista de categoría:', categoryName);
}




// --- Sonidos ---
const soundAddCart = new Audio('https://onyxservices.github.io/cubanstore/sound/agregado.mp3');
const soundNewProduct = new Audio('https://onyxservices.github.io/cubanstore/sound/new.mp3');

function isProductNew(dateString) {
  if (!dateString) return false;

  const dateCreated = new Date(dateString);
  const now = new Date();
  
  // Calculamos la diferencia en milisegundos
  const diffInMs = now - dateCreated;
  
  // Convertimos milisegundos a horas
  // (1000ms * 60s * 60min = 1 hora)
  const diffInHours = diffInMs / (1000 * 60 * 60);

  // Retorna true solo si tiene 12 horas o menos de creado
  return diffInHours <= 12;
}

function setupPaymentListener() {
  const sel = document.getElementById('payment-selector');
  if (!sel) return;

  sel.addEventListener('change', (e) => {
    // 1. Actualizamos el código de moneda global (ej: "CUP", "MLC", "USD")
    currentPaymentMethodCode = e.target.value;    
    // 2. Refrescamos los productos que están en pantalla para que cambien de precio
    if (currentView.type === 'products') {
      softRefreshProducts();
    }    
    // 3. Refrescamos el carrito para que el total se recalcule
    updateCartUI();    
    console.log("Moneda cambiada a:", currentPaymentMethodCode);
  });
}

//-----------------------------INICIALIZACIÓN-------------------------------------------------------
async function init() {
  lucide.createIcons();
  loadCartFromStorage();
  setTimeout(showCurrencyHint, 2500);

  const splash = document.getElementById('splash-screen');  
  // Si en 6 segundos no ha cargado la base de datos, quita el splash de todos modos
  const forceHide = setTimeout(() => {
    console.warn("La base de datos tarda demasiado. Iniciando app con datos locales...");
    ocultarSplash(splash);
  }, 6000);

  try {
    // Intentamos cargar los datos
    await refreshData(true);
  } catch (error) {
    // Si la tabla no existe o hay error de red, lo capturamos aquí
    console.error("Error crítico cargando datos de Supabase:", error);
  } finally {
    // Pase lo que pase (éxito o error), quitamos el temporizador y ocultamos splash
    clearTimeout(forceHide);
    
    const hasSeenSplash = sessionStorage.getItem('cuban_store_splash_seen');
    if (!hasSeenSplash) {
      setTimeout(() => {
        ocultarSplash(splash);
        sessionStorage.setItem('cuban_store_splash_seen', 'true');
      }, 3000);
    } else {
      ocultarSplash(splash);
    }
  }

  setupPaymentListener();
  updateCartUI();
  setupFormValidation();
  setupInfiniteScroll();
  lucide.createIcons();
  startBackgroundSync();
}

/*** NOTIFICACIÓN DE PRODUCTO NUEVO (Derecha a Izquierda)*/
function notifyNewProduct(categoryName) {
  // Reproducir sonido
  soundNewProduct.currentTime = 0;
  soundNewProduct.play().catch(e => console.log("Audio esperando interacción"));

  const notif = document.createElement('div');
  notif.className = 'product-notification';
  notif.innerHTML = `
    <div class="product-notif-icon"><i data-lucide="sparkles"></i></div>
    <div>
      <div style="font-size: 0.7rem; opacity: 0.8; text-transform: uppercase;">¡Recién llegado!</div>
      <div style="font-size: 0.9rem;">Nuevo producto en ${categoryName}</div>
    </div>
  `;
  document.body.appendChild(notif);
  lucide.createIcons();

  // Animación entrada
  setTimeout(() => notif.classList.add('active'), 100);

  // Animación salida y borrado
  setTimeout(() => {
    notif.classList.remove('active');
    setTimeout(() => notif.remove(), 600);
  }, 8000);
}

/*** CARGA Y ACTUALIZACIÓN DE DATOS CON DETECCIÓN DE NOVEDADES***/
async function refreshData(isFirstLoad = false) {
  try {
    const [newCats, newProds, newPays] = await Promise.all([
      getCategories(),
      getAllProducts(),
      getPaymentMethods()
    ]);

    const categories = newCats || [];
    const products = newProds || [];

    // Lógica de detección: Solo si no es la primera carga y hay productos nuevos
    if (!isFirstLoad && products.length > 0) {
      products.forEach(prod => {
        if (!knownProductIds.has(String(prod.id))) {
          const cat = categories.find(c => String(c.id) === String(prod.category_id));
          const catName = cat ? cat.name : "una categoría";
          notifyNewProduct(catName);
        }
      });
    }

    // Actualizar conjunto de IDs conocidos
    knownProductIds = new Set(products.map(p => String(p.id)));

    // Actualizar DB global
    DB.categories = categories;
    DB.products = products;
    DB.paymentMethods = newPays || [];

    if (DB.paymentMethods.length > 0) renderPaymentSelector();

    // Refrescar vistas
    if (currentView.type === 'categories') {
      renderCategories();
    } else if (currentView.type === 'products') {
      filteredProducts = DB.products.filter(p => String(p.category_id) === String(currentView.catId));
      softRefreshProducts();
    }
  } catch (err) {
    console.error("Error al refrescar datos:", err);
  }
}

function startBackgroundSync() {
  setTimeout(async function sync() {
    await refreshData(false);
    setTimeout(sync, 15000); 
  }, 15000);
}

function startCurrencySync() {
  setInterval(async () => {
    try {
      const newPays = await getPaymentMethods();
      // Solo actualizamos el DOM si los datos han cambiado para evitar parpadeos
      if (newPays && JSON.stringify(newPays) !== JSON.stringify(DB.paymentMethods)) {
        DB.paymentMethods = newPays;
        renderPaymentSelector();
        
        // Refrescar precios en la vista actual si es necesario
        if (currentView.type === 'products') {
          softRefreshProducts();
        }
        updateCartUI();
      }
    } catch (err) {
      console.error("Error al actualizar monedas en segundo plano:", err);
    }
  }, 5000); // 5000ms = 5 segundos
}

/**
 * UI / RENDERIZADO
 */
function ocultarSplash(el) {
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => {
    el.style.display = 'none';
    el.classList.add('splash-hidden');
  }, 300);
}

function getFinalPrice(basePrice) {
  const method = DB.paymentMethods.find(m => m.code === currentPaymentMethodCode) || 
                 { name: "Efectivo", mode: "none", value: 1, code: "$" };
  
  let final = parseFloat(basePrice);
  // Si el código es $, usamos el símbolo, si es otra cosa (MLC, CUP), usamos el texto
  let prefix = method.code === "$" ? "$" : method.code + " ";

  if (method.mode === 'percent') {
    final = basePrice * (1 + (method.value / 100));
  } else if (method.mode === 'divide') {
    final = basePrice / method.value;
  }

  return { 
    text: `${prefix}${final.toLocaleString(undefined, { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    })}`, 
    methodName: method.name 
  };
}
function renderPaymentSelector() {
  const sel = document.getElementById('payment-selector');
  if (!sel) return;

  // FILTRO: Solo tomamos los métodos donde active sea true
  const activeMethods = DB.paymentMethods.filter(m => m.active === true);

  sel.innerHTML = activeMethods.map(m =>
    `<option value="${m.code}" ${m.code === currentPaymentMethodCode ? 'selected' : ''}>${m.name}</option>`
  ).join('');
  
  // Opcional: Si el método seleccionado actualmente se desactivó, 
  // podrías querer resetearlo al primero disponible ($)
  if (activeMethods.length > 0 && !activeMethods.find(m => m.code === currentPaymentMethodCode)) {
      currentPaymentMethodCode = activeMethods[0].code;
  }
}
function showCurrencyHint() {
  // Verificar si ya se mostró en esta sesión
  if (sessionStorage.getItem("currency_hint_seen")) return;

  const hint = document.getElementById("currency-hint");
  if (!hint) return;

  // Aparecer después de 1.5 segundos de carga para que el usuario lo note
  setTimeout(() => {
    hint.classList.add("show");
  }, 1500);

  // Desaparecer después de 5 segundos de estar visible
  setTimeout(() => {
    hint.classList.remove("show");
    // Guardar en sesión para que no vuelva a salir hasta que cierre el navegador
    sessionStorage.setItem("currency_hint_seen", "true");
  }, 6500); // 1.5s delay + 5s visible
}


window.showCategories = () => {
  currentView = { type: 'categories', catId: null, catName: null };
  document.getElementById('products-view').style.display = 'none';
  document.getElementById('categories-view').style.display = 'block';
  renderCategories();
};

window.showProducts = (catId, catName) => {
  currentView = { type: 'products', catId: catId, catName: catName };
  document.getElementById('categories-view').style.display = 'none';
  document.getElementById('products-view').style.display = 'block';
  document.getElementById('current-cat-name').innerText = catName;

  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';
  currentPage = 1;
  filteredProducts = DB.products.filter(p => 
    String(p.category_id) === String(catId) && p.active === true
  );

  // 🔥 GA4 - Vista de categoría
trackCategoryView(catName, filteredProducts);

  renderNextChunk();
  window.scrollTo(0, 0);
};

function renderCategories() {
  const grid = document.getElementById('categories-grid');
  if (!grid) return;
  grid.innerHTML = DB.categories.map(cat => `
    <div class="card" onclick="showProducts('${cat.id}', '${cat.name}')" style="cursor:pointer">
      <div class="card-media"><img src="${cat.image_url || 'https://via.placeholder.com/300'}" onerror="this.src='https://via.placeholder.com/300'"></div>
      <div class="card-body" style="text-align:center;">
        <div class="card-title" style="height:auto; font-size:0.9rem; font-weight:700;">${cat.name}</div>
      </div>
    </div>
  `).join('');
  lucide.createIcons();
}

function renderNextChunk() {
  const grid = document.getElementById('products-grid');
  const sentinel = document.getElementById('infinite-sentinel');
  const start = (currentPage - 1) * itemsPerPage;
  const end = start + itemsPerPage;
  const chunk = filteredProducts.slice(start, end);

  if (chunk.length === 0) {
    sentinel.classList.remove('active');
    return;
  }

  sentinel.classList.add('active');
  const html = chunk.map(p => productCardHTML(p)).join('');
  grid.insertAdjacentHTML('beforeend', html);
  lucide.createIcons();
  currentPage++;

  if (end >= filteredProducts.length) sentinel.classList.remove('active');
}

function softRefreshProducts() {
  const grid = document.getElementById('products-grid');
  if (!grid || currentView.type !== 'products') return;
  const limit = (currentPage - 1) * itemsPerPage;
  const visibleSet = filteredProducts.slice(0, Math.max(limit, itemsPerPage));
  grid.innerHTML = visibleSet.map(p => productCardHTML(p)).join('');
  lucide.createIcons();
}

function productCardHTML(p) {
  const priceObj = getFinalPrice(p.price);
  const isNew = isProductNew(p.created_at);
  const outOfStock = p.stock <= 0;
  
  // Lógica de visualización de stock
  let stockBadge = "";
  if (outOfStock) {
    stockBadge = `<span class="stock-badge oos">Agotado</span>`;
  } else if (p.stock <= 5) {
    stockBadge = `<span class="stock-badge low">¡Solo ${p.stock} disp.!</span>`;
  } else {
    stockBadge = `<span class="stock-badge in-stock">${p.stock} disponibles</span>`;
  }

  const newBadge = isNew ? `
    <div class="ribbon-wrapper">
      <div class="ribbon-new">NUEVO</div>
    </div>` : '';

  return `
    <div class="card" style="${outOfStock ? 'opacity: 0.8;' : ''}">
      <div class="card-media">
        ${newBadge} 
        <img src="${p.image_url || 'https://via.placeholder.com/300'}" loading="lazy" onerror="this.src='https://via.placeholder.com/300'" style="${outOfStock ? 'filter: grayscale(1);' : ''}">
        ${outOfStock ? '<div class="sold-out-overlay">AGOTADO</div>' : ''}
      </div>
      <div class="card-body">
        <div class="card-header-info">
          <div class="card-title">${p.name}</div>
          ${stockBadge}
        </div>
        <div class="card-price">${priceObj.text}</div>
        <button class="btn-action" 
                ${outOfStock ? 'disabled style="background: #444; cursor: not-allowed;"' : `onclick="addToCart('${p.id}', event)"`}>
          <i data-lucide="${outOfStock ? 'slash' : 'shopping-cart'}" style="width:14px"></i> 
          ${outOfStock ? 'SIN STOCK' : 'AGREGAR'}
        </button>
      </div>
    </div>
  `;
}

/**
 * CARRITO
 */
window.addToCart = (id, event) => {
  const product = DB.products.find(p => String(p.id) === String(id));
  if (!product || product.stock <= 0) return;

  const existing = cart.find(item => String(item.id) === String(id));
  
  if (existing) {
    if (existing.qty >= product.stock) {
      showTopError(`Solo quedan ${product.stock} disponibles`);
      return;
    }
    existing.qty += 1;
  } else {
    cart.push({ ...product, qty: 1 });
  }
  // ... (aquí sigue tu código de analíticas, sonidos y flyers que ya tienes)
  saveCartToStorage();
  updateCartUI();
  showToast("Producto añadido");
};

async function processStockDeduction() {
  try {
    const promises = cart.map(item => subtractProductStock(item.id, item.qty));
    await Promise.all(promises);
    return true;
  } catch (err) {
    console.error("Error descontando stock:", err);
    return false;
  }
}

window.updateQty = (index, delta) => {
  if (!cart[index]) return;
  const product = DB.products.find(p => String(p.id) === String(cart[index].id));
  
  if (delta > 0 && cart[index].qty >= product.stock) {
    showTopError("Límite de stock alcanzado");
    return;
  }

  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCartToStorage();
  updateCartUI();
};

window.updateQty = (index, delta) => {
  if (!cart[index]) return;
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  saveCartToStorage();
  updateCartUI();
};

window.removeFromCart = (index) => {
  cart.splice(index, 1);
  saveCartToStorage();
  updateCartUI();
};

function updateCartUI() {
  const list = document.getElementById('cart-list');
  const totalEl = document.getElementById('cart-total');
  let totalBase = 0, totalItems = 0;

  if (cart.length === 0) {
    list.innerHTML = `<p style="text-align:center; color:var(--text-muted); margin-top:40px;">Tu carrito está vacío</p>`;
    totalEl.innerText = "$0";
    document.getElementById('cart-count').innerText = "0";
    return;
  }

  list.innerHTML = cart.map((item, i) => {
    totalBase += (parseFloat(item.price) * item.qty);
    totalItems += item.qty;
    const pObj = getFinalPrice(item.price);
    return `
      <div class="cart-item">
        <img src="${item.image_url}" style="width:50px; height:50px; border-radius:6px; object-fit:cover" onerror="this.src='https://via.placeholder.com/300'">
        <div class="cart-item-info" style="flex:1">
          <h4 style="margin:0; font-size:0.85rem">${item.name}</h4>
          <span style="color:var(--accent); font-weight:700">${pObj.text}</span>
          <div class="qty-controls">
            <button class="qty-btn" onclick="updateQty(${i}, -1)"><i data-lucide="minus" style="width:14px"></i></button>
            <span>${item.qty}</span>
            <button class="qty-btn" onclick="updateQty(${i}, 1)"><i data-lucide="plus" style="width:14px"></i></button>
          </div>
        </div>
        <button class="delete-btn" onclick="removeFromCart(${i})">
          <i data-lucide="trash-2" style="width:16px"></i>
        </button>
      </div>
    `;
  }).join('');

  const finalTotal = getFinalPrice(totalBase);
  totalEl.innerText = finalTotal.text;
  document.getElementById('cart-count').innerText = totalItems;
  lucide.createIcons();
}

// En la función sendOrder original, asegúrate de cerrar el carrito cuando se procese Zelle

/**
 * UTILIDADES
 */
function setupInfiniteScroll() {
  const sentinel = document.getElementById('infinite-sentinel');
  if (!sentinel) return;
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && filteredProducts.length > 0 && currentView.type === 'products') {
      renderNextChunk();
    }
  }, { rootMargin: '200px' });
  observer.observe(sentinel);
}

function setupFormValidation() {
  document.querySelectorAll('.cart-form input').forEach(input => {
    input.addEventListener('input', () => input.classList.remove('invalid'));
  });
}

window.toggleCart = (open) => document.getElementById('cart-overlay').classList.toggle('active', open);
window.toggleCoffeeModal = (open) => {
  document.getElementById('coffee-overlay').classList.toggle('active', open);
  if(open) setTimeout(() => lucide.createIcons(), 100);
};

function saveCartToStorage() { localStorage.setItem('cuban_store_cart', JSON.stringify(cart)); }
function loadCartFromStorage() { 
  const s = localStorage.getItem('cuban_store_cart'); 
  if (s) { try { cart = JSON.parse(s); } catch (e) { cart = []; } } 
}

function showTopError(m) {
  const r = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast-error';
  t.innerHTML = `<i data-lucide="alert-circle"></i> <span>${m}</span>`;
  r.appendChild(t);
  lucide.createIcons();
  setTimeout(() => t.remove(), 3000);
}

function showToast(m) {
  const r = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerText = m;
  r.appendChild(t);
  setTimeout(() => t.remove(), 2000);
}

window.onBackPressed = function() {
  if (document.getElementById('cart-overlay').classList.contains('active')) { toggleCart(false); return; }
  if (document.getElementById('coffee-overlay').classList.contains('active')) { toggleCoffeeModal(false); return; }
  if (currentView.type === 'products') { showCategories(); return; }
  if (window.AppInventor) window.AppInventor.setWebViewString("salir");
};

window.copyToClipboard = function(text) {
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => showToast("✅ ¡Copiado!")).catch(() => fallbackCopy(text));
  } else { fallbackCopy(text); }
};

function fallbackCopy(text) {
  const ta = document.createElement("textarea"); ta.value = text;
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); showToast("✅ ¡Copiado!"); } catch (e) { showTopError("Error al copiar"); }
  document.body.removeChild(ta);
}

/**
 * MODAL Y FLUJO ZELLE
 */
/**
 * MODAL Y FLUJO ZELLE - VERSIÓN CORREGIDA
 */
window.openZelleModal = () => {
  // 1. CERRAR EL CARRITO SI ESTÁ ABIERTO
  toggleCart(false);
  
  // 2. Calcular resumen
  let totalBase = 0;
  let totalItems = 0;
  
  cart.forEach(item => {
    totalBase += (parseFloat(item.price) * item.qty);
    totalItems += item.qty;
  });
  
  const finalTotal = getFinalPrice(totalBase);
  
  // 3. Actualizar resumen en modal
  document.getElementById('zelle-summary-items').textContent = totalItems;
  document.getElementById('zelle-summary-total').textContent = finalTotal.text;
  
  // 4. Resetear estado COMPLETO (eliminar vista previa)
  resetZelleModalState();
  
  // 5. Mostrar modal
  toggleZelleModal(true);
  lucide.createIcons();
};

// Función para resetear completamente el estado del modal Zelle
function resetZelleModalState() {
  zelleReceiptFile = null;
  zelleReceiptUrl = null;
  
  // Limpiar vista previa si existe
  const preview = document.getElementById('receipt-preview');
  if (preview && preview.src && preview.src.startsWith('blob:')) {
    URL.revokeObjectURL(preview.src);
    preview.src = '';
  }
  
  // Resetear UI
  document.getElementById('receipt-preview-container').style.display = 'none';
  document.getElementById('upload-progress').style.display = 'none';
  document.getElementById('file-error').style.display = 'none';
  document.getElementById('file-error').textContent = '';
  document.getElementById('confirm-zelle-btn').disabled = true;
  document.getElementById('select-receipt-btn').innerHTML = '<i data-lucide="upload"></i> SELECCIONAR IMAGEN';
  document.getElementById('select-receipt-btn').disabled = false;
  document.getElementById('receipt-file').value = '';
  document.getElementById('file-info').textContent = '';
}

window.toggleZelleModal = (open) => {
  const overlay = document.getElementById('zelle-overlay');
  overlay.classList.toggle('active', open);
  
  // Si se está cerrando, limpiar completamente
  if (!open) {
    resetZelleModalState();
  } else {
    setTimeout(() => lucide.createIcons(), 100);
  }
};

window.handleReceiptFileInput = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  // Limpiar estado previo si existe
  if (zelleReceiptFile && document.getElementById('receipt-preview').src) {
    URL.revokeObjectURL(document.getElementById('receipt-preview').src);
  }
  
  // Validaciones
  const validTypes = ['image/png', 'image/jpeg'];
  const maxSize = 5 * 1024 * 1024; // 5MB
  
  if (!validTypes.includes(file.type)) {
    showFileError('Solo se permiten imágenes PNG o JPEG');
    document.getElementById('receipt-file').value = '';
    return;
  }
  
  if (file.size > maxSize) {
    showFileError('La imagen no debe superar 5 MB');
    document.getElementById('receipt-file').value = '';
    return;
  }
  
  // Mostrar vista previa
  zelleReceiptFile = file;
  const previewUrl = URL.createObjectURL(file);
  const preview = document.getElementById('receipt-preview');
  const container = document.getElementById('receipt-preview-container');
  const fileInfo = document.getElementById('file-info');
  
  preview.src = previewUrl;
  container.style.display = 'block';
  fileInfo.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
  
  // Configurar botón eliminar (nueva función mejorada)
  const removeBtn = document.getElementById('remove-receipt');
  removeBtn.onclick = () => {
    if (preview.src && preview.src.startsWith('blob:')) {
      URL.revokeObjectURL(preview.src);
    }
    zelleReceiptFile = null;
    preview.src = '';
    container.style.display = 'none';
    document.getElementById('receipt-file').value = '';
    document.getElementById('confirm-zelle-btn').disabled = true;
    document.getElementById('file-error').style.display = 'none';
    document.getElementById('file-error').textContent = '';
    lucide.createIcons();
  };
  
  // Habilitar confirmación
  document.getElementById('confirm-zelle-btn').disabled = false;
  document.getElementById('file-error').style.display = 'none';
  
  lucide.createIcons();
};

window.removeReceiptPreview = function() {
  // Liberar URL del blob si existe
  const preview = document.getElementById('receipt-preview');
  if (preview && preview.src && preview.src.startsWith('blob:')) {
    URL.revokeObjectURL(preview.src);
    preview.src = '';
  }
  
  // Resetear variables
  zelleReceiptFile = null;
  zelleReceiptUrl = null;
  
  // Ocultar vista previa
  document.getElementById('receipt-preview-container').style.display = 'none';
  
  // Limpiar input file
  document.getElementById('receipt-file').value = '';
  
  // Deshabilitar botón confirmar
  document.getElementById('confirm-zelle-btn').disabled = true;
  
  // Ocultar errores
  document.getElementById('file-error').style.display = 'none';
  document.getElementById('file-error').textContent = '';
  
  // Actualizar iconos
  lucide.createIcons();
};

function showFileError(message) {
  const errorEl = document.getElementById('file-error');
  errorEl.textContent = message;
  errorEl.style.display = 'block';
  document.getElementById('confirm-zelle-btn').disabled = true;
}

// --- FUNCIÓN PARA PROCESAR EL PAGO DE ZELLE ---
window.confirmZellePayment = async () => {
  if (!zelleReceiptFile) {
    showTopError("Por favor, sube el comprobante de Zelle");
    return;
  }

  const btn = document.getElementById('confirm-zelle-btn');
  const loader = document.getElementById('upload-progress');
  const errorMsg = document.getElementById('file-error');

  // Bloquear botón y mostrar cargando
  btn.disabled = true;
  loader.style.display = 'block';
  errorMsg.style.display = 'none';

  try {
    // 1. Generar un ID de orden único
    const orderId = `CS-Z-${Date.now().toString().slice(-6)}`;
    
    // 2. Subir el comprobante a Supabase
    const uploadedUrl = await uploadReceiptToSupabase(zelleReceiptFile, orderId);
    
    // 3. Obtener datos del formulario
    const name = document.getElementById('order-name').value.trim();
    const phone = document.getElementById('order-phone').value.trim();
    const addr = document.getElementById('order-address').value.trim();
    const ref = document.getElementById('order-reference').value.trim();

    // 4. Calcular totales y lista de productos
    let totalBase = 0;
    const itemsList = cart.map(item => {
      totalBase += (parseFloat(item.price) * item.qty);
      const pObj = getFinalPrice(item.price);
      return `• *${item.qty}x* ${item.name} _(${pObj.text})_`;
    }).join('\n');
    
    const finalTotal = getFinalPrice(totalBase);

    // 5. Registrar el pedido en la base de datos
    await createOrderInSupabase({
      order_id: orderId,
      customer_name: name,
      phone: phone,
      address: addr,
      reference: ref,
      items: cart,
      total_text: finalTotal.text,
      payment_method: 'Zelle',
      receipt_url: uploadedUrl,
      status: 'pending'
    });

    // 6. Construir mensaje de WhatsApp
    const text = encodeURIComponent(
      `👑 *NUEVO PAGO POR ZELLE*\nPedido: #${orderId}\n\n` +
      `👤 *Cliente:* ${name}\n` +
      `📍 *Dirección:* ${addr}\n` +
      (ref ? `🏠 *Ref:* ${ref}\n` : '') +
      `📞 *Tel:* +53${phone}\n` +
      `📸 *Comprobante:* ${uploadedUrl}\n\n` +
      `🛍️ *PRODUCTOS:*\n${itemsList}\n\n` +
      `💰 *TOTAL:* ${finalTotal.text}`
    );

    // Redirigir a WhatsApp
    setTimeout(() => {
      window.location.href = `https://wa.me/+5353910527?text=${text}`;
    }, 100);

    // 7. Limpieza total y cierre
    cart = [];
    clearOrderForm();
    saveCartToStorage();
    updateCartUI();
    toggleZelleModal(false);
    toggleCart(false);

  } catch (e) {
    console.error('Error al procesar el pago Zelle:', e);
    errorMsg.textContent = "Error al enviar el pago. Reintente.";
    errorMsg.style.display = 'block';
    btn.disabled = false;
    loader.style.display = 'none';
  }
};

window.openMlcModal = () => {
  toggleCart(false);
  let totalBase = 0, totalItems = 0;
  cart.forEach(item => { totalBase += (parseFloat(item.price) * item.qty); totalItems += item.qty; });
  const finalTotal = getFinalPrice(totalBase);
  document.getElementById('mlc-summary-items').textContent = totalItems;
  document.getElementById('mlc-summary-total').textContent = finalTotal.text;
  resetMlcModalState();
  toggleMlcModal(true);
};

window.toggleMlcModal = (open) => {
  document.getElementById('mlc-overlay').classList.toggle('active', open);
  if(open) setTimeout(() => lucide.createIcons(), 100);
};

function resetMlcModalState() {
  mlcReceiptFile = null;
  document.getElementById('mlc-preview-container').style.display = 'none';
  document.getElementById('mlc-upload-progress').style.display = 'none';
  document.getElementById('confirm-mlc-btn').disabled = true;
  document.getElementById('mlc-receipt-file').value = '';
}

window.handleMlcReceiptFileInput = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  mlcReceiptFile = file;
  document.getElementById('mlc-preview').src = URL.createObjectURL(file);
  document.getElementById('mlc-preview-container').style.display = 'block';
  document.getElementById('confirm-mlc-btn').disabled = false;
  lucide.createIcons();
};

window.removeMlcReceiptPreview = () => { resetMlcModalState(); };

window.confirmMlcPayment = async () => {
  if (!mlcReceiptFile) return;

  const btn = document.getElementById('confirm-mlc-btn');
  const loader = document.getElementById('mlc-upload-progress');
  btn.disabled = true;
  loader.style.display = 'block';

  try {
    const orderId = `CS-MLC-${Date.now().toString().slice(-6)}`;
    const uploadedUrl = await uploadReceiptToSupabase(mlcReceiptFile, orderId);
    
    // Capturamos los datos del formulario incluyendo la Referencia
    const name = document.getElementById('order-name').value.trim();
    const phone = document.getElementById('order-phone').value.trim();
    const addr = document.getElementById('order-address').value.trim();
    const ref = document.getElementById('order-reference').value.trim(); // <--- Referencia

    let totalBase = 0;
    const itemsList = cart.map(item => {
      totalBase += (parseFloat(item.price) * item.qty);
      return `• *${item.qty}x* ${item.name}`;
    }).join('\n');
    
    const finalTotal = getFinalPrice(totalBase);

    await createOrderInSupabase({
      order_id: orderId,
      customer_name: name,
      phone: phone,
      address: addr,
      reference: ref,
      items: cart,
      total_text: finalTotal.text,
      payment_method: 'MLC',
      receipt_url: uploadedUrl,
      status: 'pending'
    });

    // CONSTRUCCIÓN DEL MENSAJE CORREGIDA (Incluyendo Referencia)
    const text = encodeURIComponent(
      `👑 *NUEVO PAGO MLC*\nPedido: #${orderId}\n\n` +
      `👤 *Cliente:* ${name}\n` +
      `📍 *Dirección:* ${addr}\n` +
      (ref ? `🏠 *Referencia:* ${ref}\n` : '') + // <--- Se añade esta línea al mensaje
      `📞 *Tel:* +53${phone}\n` +
      `📸 *Comprobante:* ${uploadedUrl}\n\n` +
      `🛍️ *PRODUCTOS:*\n${itemsList}\n\n` +
      `💰 *TOTAL:* ${finalTotal.text}`
    );

    setTimeout(() => { window.location.href = `https://wa.me/+5353910527?text=${text}`; }, 100);

    // Limpieza total
    cart = [];
    clearOrderForm(); // <--- Limpia el formulario (Nombre, Dir, Ref, Tel)
    saveCartToStorage();
    updateCartUI();
    toggleMlcModal(false);
    toggleCart(false); // <--- Cierra el carrito también
  } catch (e) {
    console.error(e);
    alert("Error al enviar el pago");
    btn.disabled = false;
    loader.style.display = 'none';
  }
};

window.openTraModal = () => {
  toggleCart(false);
  let totalBase = 0, totalItems = 0;
  cart.forEach(item => { totalBase += (parseFloat(item.price) * item.qty); totalItems += item.qty; });
  const finalTotal = getFinalPrice(totalBase);
  document.getElementById('tra-summary-items').textContent = totalItems;
  document.getElementById('tra-summary-total').textContent = finalTotal.text;
  resetTraModalState();
  toggleTraModal(true);
};

window.toggleTraModal = (open) => {
  document.getElementById('tra-overlay').classList.toggle('active', open);
  if(open) setTimeout(() => lucide.createIcons(), 100);
};

function resetTraModalState() {
  traReceiptFile = null;
  document.getElementById('tra-preview-container').style.display = 'none';
  document.getElementById('tra-upload-progress').style.display = 'none';
  document.getElementById('confirm-tra-btn').disabled = true;
  document.getElementById('tra-receipt-file').value = '';
}

window.handleTraReceiptFileInput = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  traReceiptFile = file;
  document.getElementById('tra-preview').src = URL.createObjectURL(file);
  document.getElementById('tra-preview-container').style.display = 'block';
  document.getElementById('confirm-tra-btn').disabled = false;
  lucide.createIcons();
};

window.removeTraReceiptPreview = () => { resetTraModalState(); };

window.confirmTraPayment = async () => {
  if (!traReceiptFile) {
    showTopError("Falta el comprobante de transferencia");
    return;
  }

  const btn = document.getElementById('confirm-tra-btn');
  const loader = document.getElementById('tra-upload-progress');
  const errorMsg = document.getElementById('tra-file-error');

  btn.disabled = true;
  loader.style.display = 'block';
  errorMsg.style.display = 'none';

  try {
    // 1. Generar ID único para la transferencia
    const orderId = `CS-TR-${Date.now().toString().slice(-6)}`;
    
    // 2. Subir imagen a Supabase
    const uploadedUrl = await uploadReceiptToSupabase(traReceiptFile, orderId);
    
    // 3. Capturar datos del formulario
    const name = document.getElementById('order-name').value.trim();
    const phone = document.getElementById('order-phone').value.trim();
    const addr = document.getElementById('order-address').value.trim();
    const ref = document.getElementById('order-reference').value.trim();

    // 4. Calcular totales y lista de productos
    let totalBase = 0;
    const itemsList = cart.map(item => {
      totalBase += (parseFloat(item.price) * item.qty);
      const pObj = getFinalPrice(item.price); // Obtiene el precio formateado según moneda
      return `• *${item.qty}x* ${item.name} _(${pObj.text})_`;
    }).join('\n');
    
    const finalTotal = getFinalPrice(totalBase);

    // 5. Registrar pedido en la base de datos
    await createOrderInSupabase({
      order_id: orderId,
      customer_name: name,
      phone: phone,
      address: addr,
      reference: ref,
      items: cart,
      total_text: finalTotal.text,
      payment_method: 'Transferencia',
      receipt_url: uploadedUrl,
      status: 'pending'
    });

    // 6. Estructura de WhatsApp idéntica a Zelle
    const text = encodeURIComponent(
      `👑 *NUEVA TRANSFERENCIA*\nPedido: #${orderId}\n\n` +
      `👤 *Cliente:* ${name}\n` +
      `📍 *Dirección:* ${addr}\n` +
      (ref ? `🏠 *Ref:* ${ref}\n` : '') +
      `📞 *Tel:* +53${phone}\n` +
      `📸 *Comprobante:* ${uploadedUrl}\n\n` +
      `🛍️ *PRODUCTOS:*\n${itemsList}\n\n` +
      `💰 *TOTAL:* ${finalTotal.text}`
    );

    // 7. Redirección a WhatsApp
    setTimeout(() => {
      window.location.href = `https://wa.me/+5353910527?text=${text}`;
    }, 100);

    // Limpiar carrito y cerrar modales
    cart = [];
    clearOrderForm();
    saveCartToStorage();
    updateCartUI();
    toggleTraModal(false);
    toggleCart(false);

  } catch (e) {
    console.error('Error en transferencia:', e);
    errorMsg.textContent = "Error al procesar el pago. Reintente.";
    errorMsg.style.display = 'block';
    btn.disabled = false;
    loader.style.display = 'none';
  }
};


// Modificar la función sendOrder existente para incluir flujo Zelle
window.sendOrder = async () => {
  const nameInput = document.getElementById('order-name');
  const addrInput = document.getElementById('order-address');
  const refInput = document.getElementById('order-reference');
  const phoneInput = document.getElementById('order-phone');

  const name = nameInput.value.trim();
  const addr = addrInput.value.trim();
  const ref = refInput.value.trim();
  const phone = phoneInput.value.trim();

  if (cart.length === 0) { showTopError("El carrito está vacío"); return; }
  
  showToast("Confirmando stock...");
  const ok = await processStockDeduction();
  if (!ok) { showTopError("Error al procesar inventario"); return; }

  let hasError = false;
  if (name.length < 3) { nameInput.classList.add('invalid'); hasError = true; }
  if (addr.length < 5) { addrInput.classList.add('invalid'); hasError = true; }
  if (!/^[56]\d{7}$/.test(phone)) { phoneInput.classList.add('invalid'); hasError = true; }

  if (hasError) { showTopError("Revisa los datos marcados"); return; }

  // Si el método de pago es Zelle, abrir modal en lugar de enviar directamente
  if (currentPaymentMethodCode === 'Z') {
    openZelleModal();
    return;
  }

   if (currentPaymentMethodCode === 'Tra') {
    openTraModal();
    return;
  }

  if (currentPaymentMethodCode === 'mlc') {
    openMlcModal();
    return;
  }

  // Flujo normal para otros métodos de pago (copiar código existente aquí)
  let totalBase = 0;
  const itemsList = cart.map(item => {
    totalBase += (parseFloat(item.price) * item.qty);
    const pObj = getFinalPrice(item.price);
    return `• *${item.qty}x* ${item.name} _(${pObj.text})_`;
  }).join('\n');

  const finalTotalObj = getFinalPrice(totalBase);
  const text = encodeURIComponent(
    `👑 *NUEVO PEDIDO | CUBAN STORE*\n\n` +
    `👤 *Cliente:* ${name}\n` +
    `📍 *Dirección:* ${addr}\n` +
    (ref ? `🏠 *Referencia:* ${ref}\n` : '') +
    `📞 *Teléfono:* +53${phone}\n` +
    `💳 *Método de Pago:* ${finalTotalObj.methodName}\n\n` +
    `🛍️ *PRODUCTOS:*\n${itemsList}\n\n` +
    `💰 *TOTAL A PAGAR:* ${finalTotalObj.text}\n\n` +
    `✅ _Espere su confirmación, gracias..._`
  );

  window.open(`https://wa.me/+5353910527?text=${text}`, '_blank');
  
  cart = [];
  document.querySelectorAll('#order-form input').forEach(i => { i.value = ''; i.classList.remove('invalid'); });
  saveCartToStorage();
  updateCartUI();
  toggleCart(false);
  showToast("¡Pedido enviado!");
};

function clearOrderForm() {
  const inputs = document.querySelectorAll('#order-form input');
  inputs.forEach(i => {
    i.value = '';
    i.classList.remove('invalid');
  });
}


// Función para abrir/cerrar el menú de soporte
window.toggleSupportMenu = (e) => {
  e.stopPropagation(); // Evita que el clic cierre el menú inmediatamente
  const menu = document.getElementById('support-menu');
  menu.classList.toggle('active');
  
  // Refrescar iconos por si acaso
  if(menu.classList.contains('active')) {
    lucide.createIcons();
  }
};

// Cerrar el menú si el usuario hace clic en cualquier otra parte de la pantalla
document.addEventListener('click', () => {
  const menu = document.getElementById('support-menu');
  if (menu) menu.classList.remove('active');
});

// ... código anterior ...

window.openSmsApp = (phone) => {
  // Verificamos si la app se está ejecutando dentro de Kodular/App Inventor
  if (window.AppInventor) {
    // Enviamos una señal a Kodular con el prefijo "SMS:"
    window.AppInventor.setWebViewString("SMS:" + phone);
  } else {
    // Si se abre en un navegador normal, usamos el método estándar
    window.location.href = "sms:" + phone;
  }
};

// Iniciar app
init();