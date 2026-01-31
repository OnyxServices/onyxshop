import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://cgjpjnekolqfdxnangca.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnanBqbmVrb2xxZmR4bmFuZ2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MTk1MTIsImV4cCI6MjA4MzQ5NTUxMn0.rSTaIfj67gSGKiInEZDyaNyroPio1bXhVL4a1YFXfl0";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === UTILIDADES AUXILIARES === */

function getPathFromPublicUrl(url) {
  // Busca '/storage/v1/object/public/{bucket}/' y devuelve lo que viene después
  const marker = '/storage/v1/object/public/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.substring(idx + marker.length).split('/').slice(1).join('/'); // elimina el bucket
}

async function deletePhysicalFile(bucket, url) {
  const path = getPathFromPublicUrl(url);
  if (!path) return;
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.error(`Error borrando archivo ${path}:`, error);
}


/* === CATEGORÍAS === */

export async function getCategories() {
  const { data, error } = await supabase.from("categories").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function createCategory(name, image_url) {
  const { error } = await supabase.from("categories").insert([{ name, image_url }]);
  if (error) throw error;
}

export async function updateCategory(id, fields) {
  const { error } = await supabase.from("categories").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deleteCategory(id, imageUrl) {
  if (imageUrl) await deletePhysicalFile('categories', imageUrl);
  const { error } = await supabase.from("categories").delete().eq("id", id);
  if (error) throw error;
}

export async function createProduct(productData) {
  const { error } = await supabase.from("products").insert([{ ...productData, active: true }]);
  if (error) throw error;
}

export async function updateProduct(id, fields) {
  // Añadimos .select() para confirmar que los datos se actualizaron
  const { data, error } = await supabase
    .from("products")
    .update(fields)
    .eq("id", id)
    .select();
    
  if (error) {
    console.error("Error en updateProduct:", error.message);
    throw error;
  }
  return data;
}

export async function deleteProduct(id, imageUrl) {
  if (imageUrl) await deletePhysicalFile('products', imageUrl);
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
}

/* === STORAGE (SUBIDA) === */

export async function uploadImage(bucket, file) {
  const cleanName = file.name.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
  const fileName = `${Date.now()}_${cleanName}`;
  
  const { data, error } = await supabase.storage.from(bucket).upload(fileName, file);
  if (error) throw error;
  
  const { data: { publicUrl } } = supabase.storage.from(bucket).getPublicUrl(fileName);
  return publicUrl;
}

/* === MÉTODOS DE PAGO (SISTEMA DINÁMICO) === */

export async function getPaymentMethods() {
  const { data, error } = await supabase
    .from("payment_methods")
    .select("*")
    .order("created_at", { ascending: true });
    
  if (error) throw error;
  return data;
}

export async function updatePaymentMethod(id, fields) {
  const { error } = await supabase
    .from("payment_methods")
    .update(fields)
    .eq("id", id);
  if (error) throw error;
}

export async function createPaymentMethod(paymentData) {
  const { data, error } = await supabase.from("payment_methods").insert([paymentData]);
  if (error) throw error;
  return data;
}

export async function deletePaymentMethod(id) {
  const { error } = await supabase.from("payment_methods").delete().eq("id", id);
  if (error) throw error;
}

/* === GESTIÓN DE PEDIDOS Y COMPROBANTES (Zelle y Transferencia) === */

/**
 * Sube un comprobante de pago al Storage de Supabase.
 */
export async function uploadReceiptToSupabase(file, orderId) {
  try {
    const extension = file.name.split('.').pop();
    const filePath = `orders/${orderId}/${Date.now()}.${extension}`;
    
    const { data, error } = await supabase.storage
      .from('comprobantes') // Asegúrate de que este bucket exista en Supabase
      .upload(filePath, file);
      
    if (error) throw error;
    
    const { data: urlData } = supabase.storage
      .from('comprobantes')
      .getPublicUrl(filePath);
    
    return urlData.publicUrl;
  } catch (error) {
    console.error("Error subiendo comprobante:", error);
    throw error;
  }
}

/**
 * Guarda el pedido oficial en la base de datos.
 */
export async function createOrderInSupabase(orderData) {
  const { data, error } = await supabase
    .from("orders")
    .insert([orderData]);
    
  if (error) {
    console.error("Error creando orden en DB:", error);
    throw error;
  }
  return data;
}

/**
 * Obtiene el historial de pedidos
 */
export async function getOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/**
 * Elimina todos los registros de la DB y limpia los archivos en el Storage
 */
export const deleteAllOrdersData = async () => {
    try {
        // 1. Eliminar registros de la base de datos
        const { error: dbError } = await supabase
            .from('orders')
            .delete()
            .not('id', 'is', null); 

        if (dbError) throw dbError;

        // 2. Listar carpetas dentro de 'orders' en el bucket 'comprobantes'
        const { data: folderList, error: listError } = await supabase
            .storage
            .from('comprobantes')
            .list('orders');

        if (listError) {
            console.warn("No se pudo listar la carpeta (puede estar vacía):", listError.message);
            return true;
        } 

        if (folderList && folderList.length > 0) {
            // Iterar sobre cada carpeta de pedido para borrar sus archivos internos
            for (const item of folderList) {
                if (item.name === '.emptyFolderPlaceholder') continue;

                // Listar archivos dentro de la subcarpeta (ej: orders/123/)
                const { data: files } = await supabase
                    .storage
                    .from('comprobantes')
                    .list(`orders/${item.name}`);

                if (files && files.length > 0) {
                    const filesToRemove = files.map(f => `orders/${item.name}/${f.name}`);
                    await supabase.storage.from('comprobantes').remove(filesToRemove);
                }
            }
        }
        
        return true;
    } catch (err) {
        console.error("Error en deleteAllOrdersData:", err);
        throw err;
    }

};

// Reemplaza el final de api.js con esto:
export async function getAllProducts() {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, price, image_url, category_id, active, created_at, stock, cost')
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error cargando productos:", error.message);
    throw error;
  }
  return data || []; // Importante: retornar los datos o un array vacío
}

export async function subtractProductStock(productId, quantityToSubtract) {
  // Primero obtenemos el stock actual
  const { data: product, error: fetchError } = await supabase
    .from('products')
    .select('stock')
    .eq('id', productId)
    .single();

  if (fetchError) throw fetchError;

  // Calculamos el nuevo stock (sin bajar de 0)
  const newStock = Math.max(0, product.stock - quantityToSubtract);

  // Actualizamos en la base de datos
  const { error: updateError } = await supabase
    .from('products')
    .update({ stock: newStock })
    .eq('id', productId);

  if (updateError) throw updateError;
}

/* === SISTEMA DE LOGIN === */
export async function loginAdmin(username, password) {
  const { data, error } = await supabase
    .from("admin_users")
    .select("*")
    .ilike("username", username) // .ilike no distingue entre oto, Oto u OTO
    .eq("password", password)
    .single();

  if (error || !data) {
    throw new Error("Credenciales inválidas");
  }
  return data;
}
/* === CONFIGURACIONES (SETTINGS) === */
export async function getDeductionPercent() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "deduction_percent")
    .single();
  if (error) return 0.7; // Valor por defecto si falla
  return parseFloat(data.value);
}

export async function updateDeductionPercent(newValue) {
  // upsert intenta actualizar; si no existe la llave, la inserta.
  const { error } = await supabase
    .from("settings")
    .upsert({ key: "deduction_percent", value: String(newValue) }, { onConflict: 'key' });
    
  if (error) throw error;
}

/**
 * Actualiza los precios de todos los productos de una categoría por un porcentaje.
 */
export async function updatePricesByCategory(categoryId, percentage) {
  // 1. Obtenemos todos los productos de esa categoría
  const { data: products, error: fetchError } = await supabase
    .from("products")
    .select("id, price")
    .eq("category_id", categoryId);

  if (fetchError) throw fetchError;

  // 2. Preparamos las promesas de actualización
  const updates = products.map(p => {
    const currentPrice = parseFloat(p.price);
    const newPrice = currentPrice * (1 + (percentage / 100));
    
    return supabase
      .from("products")
      .update({ price: parseFloat(newPrice.toFixed(2)) })
      .eq("id", p.id);
  });

  // 3. Ejecutamos todas las actualizaciones
  const results = await Promise.all(updates);
  
  // Revisamos si alguna falló
  const error = results.find(r => r.error);
  if (error) throw error.error;

  return true;
}