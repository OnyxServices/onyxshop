import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL = "https://cgjpjnekolqfdxnangca.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNnanBqbmVrb2xxZmR4bmFuZ2NhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5MTk1MTIsImV4cCI6MjA4MzQ5NTUxMn0.rSTaIfj67gSGKiInEZDyaNyroPio1bXhVL4a1YFXfl0";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* === UTILIDADES AUXILIARES === */

// Extrae el nombre del archivo de una URL pública de Supabase
function getFileNameFromUrl(url) {
  if (!url || !url.includes('/storage/v1/object/public/')) return null;
  return url.split('/').pop();
}

// Borra físicamente un archivo del Storage
async function deletePhysicalFile(bucket, url) {
  const fileName = getFileNameFromUrl(url);
  if (!fileName) return;

  const { error } = await supabase.storage.from(bucket).remove([fileName]);
  if (error) console.error(`Error borrando archivo ${fileName}:`, error);
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

/* === PRODUCTOS === */

export async function getAllProducts() {
  const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createProduct(productData) {
  const { error } = await supabase.from("products").insert([{ ...productData, active: true }]);
  if (error) throw error;
}

export async function updateProduct(id, fields) {
  const { data, error } = await supabase.from("products").update(fields).eq("id", id);
  if (error) throw error;
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