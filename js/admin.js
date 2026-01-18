import * as api from './api.js';

    let allProducts = [];
    let allCategories = [];
    let allPayments = [];
    let currentCategoryId = null;
    let editingId = null;
    let confirmResolver = null;

    // --- FUNCIONES DE MODALES ---
    window.openModal = (modalId) => {
  document.getElementById(modalId).classList.add('active');
  document.body.style.overflow = 'hidden';
  
  if (modalId === 'modal-store') { refreshData(); showMainPanel(); }
  if (modalId === 'modal-payments') { refreshData(); }
  
  if (modalId === 'modal-orders') { 
    loadOrdersSummary(); // Carga inmediata al abrir
    
    // Inicia el contador de 15 segundos (15000 ms)
    if (ordersInterval) clearInterval(ordersInterval); // Limpiar si existía uno previo
    ordersInterval = setInterval(() => {
        console.log("Auto-recargando pedidos...");
        loadOrdersSummary();
    }, 15000); 
  }
};

    window.closeModal = (modalId) => {
  document.getElementById(modalId).classList.remove('active');
  document.body.style.overflow = 'auto';
  
  // Detener la recarga automática si se cierra el modal de órdenes
  if (modalId === 'modal-orders') {
    if (ordersInterval) {
      clearInterval(ordersInterval);
      ordersInterval = null;
      console.log("Recarga automática detenida");
    }
  }
};

    // --- UTILIDADES ---
    window.showToast = (msg, type = 'info') => {
      const container = document.getElementById('toast-container');
      const toast = document.createElement('div');
      toast.className = `toast`;
      if(type === 'error') toast.style.borderLeftColor = 'var(--danger)';
      toast.innerText = msg;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    };

    window.customConfirm = (title, text) => {
      document.getElementById('modal-title').innerText = title;
      document.getElementById('modal-text').innerText = text;
      document.getElementById('modal-confirm').classList.add('active');
      return new Promise(resolve => { confirmResolver = resolve; });
    };

    window.closeConfirm = (val) => {
      document.getElementById('modal-confirm').classList.remove('active');
      if(confirmResolver) confirmResolver(val);
    };

    // --- REFRESH DATA (Mantenido) ---
    async function refreshData() {
      try {
        const [categories, products, payments] = await Promise.all([
            api.getCategories(), 
            api.getAllProducts(),
            api.getPaymentMethods()
        ]);
        allCategories = categories;
        allProducts = products;
        allPayments = payments;
        renderCategories();
        renderPaymentMethods();
        if (currentCategoryId) renderProducts();
      } catch (e) { showToast("Error de conexión", "error"); }
    }

    function renderPaymentMethods() {
  const list = document.getElementById('payments-list');
  list.innerHTML = allPayments.map(pay => `
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
         <!-- Botón Activar/Desactivar -->
         <button class="btn ${pay.active ? 'btn-toggle-on' : 'btn-toggle-off'}" 
                 onclick="handleTogglePaymentStatus('${pay.id}', ${pay.active})">
           ${pay.active ? 'Activo' : 'Inactivo'}
         </button>
         
         <!-- Botón Editar -->
         <button class="btn btn-edit" style="padding:5px 10px" onclick="openEditPayment('${pay.id}')">✏️</button>
         
         <!-- Botón Eliminar -->
         <button class="btn btn-delete" style="padding:5px 10px" onclick="handleDeletePayment('${pay.id}')">🗑️</button>
      </div>
    </li>
  `).join('');
}

    function renderCategories() {
      const list = document.getElementById('categories-list');
      list.innerHTML = allCategories.map(cat => `
        <li class="list-item">
          <div class="item-info">
            <img class="item-img" src="${cat.image_url || 'https://via.placeholder.com/50'}">
            <p style="font-weight:700;">${cat.name}</p>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="btn" style="background:var(--primary); color:white; font-size:12px;" onclick="showCategoryProducts('${cat.id}', '${cat.name}')">Ver Productos</button>
            <button class="btn btn-delete" onclick="handleDeleteCategory('${cat.id}')">🗑️</button>
          </div>
        </li>
      `).join('');
    }

    // --- NUEVO RENDER DE PRODUCTOS ---
function renderProducts() {
  const list = document.getElementById('products-list');
  // Filtramos por categoría pero MOSTRARMOS todos (activos e inactivos)
  const filtered = allProducts.filter(p => String(p.category_id) === String(currentCategoryId));
  
  list.innerHTML = filtered.map(p => `
    <li class="list-item ${!p.active ? 'is-inactive' : ''}">
      <div class="item-info">
        <img class="item-img" src="${p.image_url || 'https://via.placeholder.com/50'}" onerror="this.src='https://via.placeholder.com/50'">
        <div>
          <p style="font-weight:700;">${p.name}</p>
          <p style="color:var(--success); font-weight:700;">$${p.price}</p>
         <span style="margin-left:10px; color:${p.stock <= 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-size:0.8rem;">
              📦 Stock: ${p.stock || 0}
         </span>

        </div>
      </div>
      <div style="display:flex; gap:8px;">
        <!-- Botón Switch Activar/Desactivar -->
        <button class="btn ${p.active ? 'btn-toggle-on' : 'btn-toggle-off'}" 
                onclick="handleToggleProductStatus('${p.id}', ${p.active})" 
                title="${p.active ? 'Desactivar' : 'Activar'}">
          ${p.active ? 'Visible' : 'Oculto'}
        </button>
        
        <!-- Botón Editar -->
        <button class="btn btn-edit" onclick="openEditProduct('${p.id}')">✏️</button>
        
        <!-- Botón Eliminar -->
        <button class="btn btn-delete" onclick="handleDeleteProduct('${p.id}')">🗑️</button>
      </div>
    </li>
  `).join('');
}

// --- LÓGICA DE ACTIVACIÓN/DESACTIVACIÓN ---
window.handleToggleProductStatus = async (id, currentStatus) => {
    try {
        await api.updateProduct(id, { active: !currentStatus });
        showToast(currentStatus ? "Producto ocultado" : "Producto visible");
        refreshData();
    } catch (e) {
        showToast("Error al cambiar estado", "error");
    }
};

// --- LÓGICA DE MÉTODOS DE PAGO ---

// 1. Activar / Desactivar Moneda
// 1. Cambiar estado Activo/Inactivo
window.handleTogglePaymentStatus = async (id, currentStatus) => {
    try {
        await api.updatePaymentMethod(id, { active: !currentStatus });
        showToast(!currentStatus ? "Moneda Activada" : "Moneda Desactivada");
        refreshData(); // Recarga la lista
    } catch (e) {
        showToast("Error al cambiar estado", "error");
    }
};

// 2. Abrir Modal de Edición y Cargar Datos
window.openEditPayment = (id) => {
    const pay = allPayments.find(p => String(p.id) === String(id));
    if (!pay) return;

    // Llenar los campos del modal de edición
    document.getElementById('edit-pay-id').value = pay.id;
    document.getElementById('edit-pay-name').value = pay.name;
    document.getElementById('edit-pay-mode').value = pay.mode;
    document.getElementById('edit-pay-value').value = pay.value;
    
    openModal('modal-edit-payment');
};

// 3. Guardar cambios en el servidor
window.handleUpdatePayment = async () => {
    const id = document.getElementById('edit-pay-id').value;
    const name = document.getElementById('edit-pay-name').value;
    const mode = document.getElementById('edit-pay-mode').value;
    const value = document.getElementById('edit-pay-value').value;

    if (!name) return showToast("El nombre es obligatorio", "error");

    try {
        await api.updatePaymentMethod(id, {
            name: name,
            mode: mode,
            value: parseFloat(value)
        });
        
        closeModal('modal-edit-payment');
        showToast("Método de pago actualizado");
        refreshData();
    } catch (e) {
        showToast("Error al actualizar", "error");
    }
};
// 4. Eliminar Método de Pago
window.handleDeletePayment = async (id) => {
    if (await customConfirm("¿Eliminar moneda?", "Esto afectará los precios calculados en la tienda.")) {
        try {
            await api.deletePaymentMethod(id);
            showToast("Método eliminado");
            refreshData();
        } catch (e) {
            showToast("Error al eliminar", "error");
        }
    }
};

// --- LÓGICA DE EDICIÓN ---
window.openEditProduct = (id) => {
    const prod = allProducts.find(p => String(p.id) === String(id));
    if (!prod) return;

    document.getElementById('edit-prod-id').value = prod.id;
    document.getElementById('edit-prod-name').value = prod.name;
    document.getElementById('edit-prod-price').value = prod.price;
    document.getElementById('edit-prod-stock').value = prod.stock || 0; // Carga el stock actual
    document.getElementById('edit-prod-img').value = ""; 
    
    openModal('modal-edit-product');
};

window.handleUpdateProduct = async () => {
    const id = document.getElementById('edit-prod-id').value;
    const name = document.getElementById('edit-prod-name').value;
    const price = document.getElementById('edit-prod-price').value;
    const stock = document.getElementById('edit-prod-stock').value; // Captura stock editado
    const file = document.getElementById('edit-prod-img').files[0];

    if (!name || !price) return showToast("Nombre y precio son obligatorios", "error");

    try {
        let updateData = {
            name: name,
            price: parseFloat(price),
            stock: parseInt(stock) || 0 // Actualiza stock
        };

        if (file) {
            showToast("Subiendo nueva imagen...");
            const newUrl = await api.uploadImage('products', file);
            updateData.image_url = newUrl;
        }

        await api.updateProduct(id, updateData);
        
        closeModal('modal-edit-product');
        showToast("Producto actualizado con éxito", "success");
        refreshData();
    } catch (e) {
        console.error(e);
        showToast("Error al actualizar. ¿Creaste la columna 'stock' en Supabase?", "error");
    }
};

    // --- ACCIONES LOGICAS (Llamadas a tu api.js) ---
    window.handleAddPayment = async () => {
        const name = document.getElementById('pay-name').value;
        const mode = document.getElementById('pay-mode').value;
        const value = document.getElementById('pay-value').value;
        if(!name) return showToast("Nombre requerido", "error");
        await api.createPaymentMethod({ name, code: name.toLowerCase().replace(" ", ""), mode, value: parseFloat(value), active: true });
        refreshData();
        showToast("Método añadido");
    };

    window.handleAddCategory = async () => {
        const input = document.getElementById('new-cat-name');
        const file = document.getElementById('new-cat-img').files[0];
        if(!input.value) return showToast("Nombre requerido", "error");
        let url = file ? await api.uploadImage('categories', file) : null;
        await api.createCategory(input.value, url);
        refreshData();
        input.value = "";
        showToast("Categoría creada");
    };

    window.handleAddProduct = async () => {
    const nameInp = document.getElementById('new-prod-name');
    const priceInp = document.getElementById('new-prod-price');
    const stockInp = document.getElementById('new-prod-stock'); // Captura stock
    const file = document.getElementById('new-prod-img').files[0];

    if(!nameInp.value || !priceInp.value) return showToast("Datos incompletos", "error");

    try {
        let url = file ? await api.uploadImage('products', file) : null;
        await api.createProduct({ 
            name: nameInp.value, 
            price: parseFloat(priceInp.value), 
            stock: parseInt(stockInp.value) || 0, // Envía stock
            image_url: url, 
            category_id: currentCategoryId 
        });
        refreshData();
        // Limpiar campos
        nameInp.value = ""; priceInp.value = ""; stockInp.value = "0";
        showToast("Producto añadido");
    } catch (e) {
        showToast("Error al crear producto", "error");
    }
};

    window.handleDeleteCategory = async (id) => {
        if(await customConfirm("¿Eliminar?", "Se borrarán todos sus productos.")) {
            await api.deleteCategory(id);
            refreshData();
        }
    };

    window.handleDeleteProduct = async (id) => {
        if(await customConfirm("¿Borrar producto?", "")) {
            await api.deleteProduct(id);
            refreshData();
        }
    };

    window.showCategoryProducts = (id, name) => {
        currentCategoryId = id;
        document.getElementById('section-categories').classList.add('hidden');
        document.getElementById('section-products').classList.remove('hidden');
        document.getElementById('current-cat-title').innerText = `📦 ${name}`;
        renderProducts();
    };

    window.showMainPanel = () => {
        document.getElementById('section-products').classList.add('hidden');
        document.getElementById('section-categories').classList.remove('hidden');
    };

    window.loadOrdersSummary = async () => {
    const container = document.getElementById('orders-detailed-list');
    if (!container) return; // Seguridad

    try {
        const orders = await api.getOrders();
        
        let totalRev = 0;
        let totalTra = 0;
        let totalZelle = 0;
        let totalUsd = 0;
        
        // Si no hay órdenes, limpiar y salir
        if (!orders || orders.length === 0) {
            container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">No hay pedidos registrados aún.</p>`;
            updateStatsUI(0, 0, 0, 0, 0);
            return;
        }

        container.innerHTML = orders.map(order => {
            // 1. Limpieza de precio: Extraer solo el número
            // Maneja casos como "$ 10.00", "10,00", "Total: 10.00"
            const rawPrice = String(order.total_text || "0")
                .replace(',', '.') // Cambiar comas por puntos
                .replace(/[^0-9.]/g, ""); // Quitar todo lo que no sea número o punto
            
            const price = parseFloat(rawPrice) || 0;
            const method = (order.payment_method || "").toLowerCase();

            // 2. Acumulación de totales
            totalRev += price;

            // Clasificación inteligente
            if (method.includes("zelle")) {
                totalZelle += price;
            } else if (
                method.includes("transferencia") || 
                method.includes("pago movil") || 
                method.includes("pago móvil") || 
                method.includes("tra") ||
                method.includes("bs")
            ) {
                totalTra += price;
            } else {
                // Por defecto: Efectivo / Divisas
                totalUsd += price;
            }

            // 3. Renderizado de la tarjeta del pedido
            return `
                <div class="order-card" style="margin-bottom:0;">
                    <div class="order-header">
                        <span style="color:var(--text-muted); font-size: 0.7rem;">ID: #${String(order.id).slice(-6)}</span>
                        <span class="order-total">$${price.toFixed(2)}</span>
                    </div>
                    <div style="margin-top: 8px;">
                        <p style="font-size: 0.9rem; font-weight: 600;">👤 ${order.customer_name || 'Cliente Anónimo'}</p>
                        <p style="font-size:0.75rem; color: var(--text-muted); margin-top: 4px;">
                            <span style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">💳 ${order.payment_method}</span>
                        </p>
                    </div>
                </div>
            `;
        }).reverse().join(''); 
        
        // 4. Actualizar UI
        updateStatsUI(totalRev, totalTra, totalZelle, totalUsd, orders.length);

    } catch (e) {
        console.error("Error cargando reporte:", e);
        showToast("Error al procesar datos de ventas", "error");
    }
};

// Función auxiliar para actualizar los números en pantalla
function updateStatsUI(rev, tra, zelle, usd, count) {
    document.getElementById('total-revenue').innerText = `$${rev.toFixed(2)}`;
    document.getElementById('total-tra').innerText = `$${tra.toFixed(2)}`;
    document.getElementById('total-zelle').innerText = `$${zelle.toFixed(2)}`;
    document.getElementById('total-usd').innerText = `$${usd.toFixed(2)}`;
    document.getElementById('total-orders-count').innerText = count;
}

window.handleClearAllOrders = async () => {
    const confirm = await customConfirm(
        "¿ELIMINAR TODO EL HISTORIAL?", 
        "Se borrarán todos los pedidos de la base de datos y todas las imágenes de la carpeta 'comprobantes/orders'. Esta acción es irreversible."
    );

    if (!confirm) return;

    try {
        showToast("Iniciando limpieza profunda...");
        
        await api.deleteAllOrdersData();
        
        showToast("Historial y Storage limpiados", "success");
        
        // Actualizar la interfaz manualmente para que aparezca vacía
        document.getElementById('orders-detailed-list').innerHTML = "<p style='text-align:center; padding:20px; color:gray;'>No hay pedidos registrados.</p>";
        document.getElementById('total-revenue').innerText = "$0.00";
        document.getElementById('total-orders-count').innerText = "0";
        
    } catch (e) {
        console.error("Error al limpiar:", e);
        showToast("Error al eliminar archivos o datos", "error");
    }
};

    refreshData();